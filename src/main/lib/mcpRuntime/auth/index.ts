import { BrowserWindow } from 'electron';
import { log } from '@main/log';
import { pickAuthUiWindow } from './authWindowSelector';
import { mcpAuthMainToRender } from '@shared/ipc/mcp';
import type { McpResolvedAuthMetadata } from './types';
import { createMcpAuthCancelledError, isMcpAuthCancelledError, isMcpDcrRequiresUserClientIdError } from './errors';
import { DeskmateOAuthProvider, PROACTIVE_REFRESH_WINDOW_SEC } from './DeskmateOAuthProvider';
import { performOAuthFlow, runRefreshOnly } from './performOAuthFlow';
import { getCallbackServer } from './CallbackServer';
import { getProviderHelp } from './dcrFallbackInstructions';
import { isKnownToNotSupportDcr } from './wellKnownOAuthProviders';
import { getMcpOAuthServerKey } from './serverKey';
import {
  mcpAuthPromptRegistry,
  type ClientIdHandler,
  type ConsentHandler,
  type McpAuthConsentDecision,
} from './mcpAuthPromptRegistry';
import type { McpServerConfig } from '@shared/types/profileTypes';
import type { McpAuthClientIdRequestPayload, McpAuthClientIdResponse } from '@shared/types/mcpAuth';

/** Renderer-prompt timeout matches `CallbackServer.waitForCode`. On
 *  timeout/abort we resolve as cancelled so the transport surfaces a
 *  clean "needs sign-in" rather than hanging the connection. */
const MCP_AUTH_PROMPT_TIMEOUT_MS = 5 * 60_000;

type McpAuthInteractionListener = (event: {
  serverName: string;
  providerLabel: string;
  phase: 'consent-requested';
}) => void;

/**
 * Generic renderer-prompt driver.
 *
 * The consent + client-id flows both need: settled-flag, registry hook,
 * 5min timeout, AbortSignal wiring, `pickAuthUiWindow` dispatch. They differ
 * only in registry API and IPC payload — captured via `register` + `dispatch`.
 * `onCancelled` is the outcome the caller wants when we time out / abort /
 * fail to find a target window.
 */
function awaitRendererPrompt<H extends ConsentHandler | ClientIdHandler, R>(args: {
  requestId: string;
  serverName: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onCancelled: () => R;
  register: (requestId: string, handler: H) => void;
  cancel: (requestId: string) => void;
  makeHandler: (resolve: (value: R) => void) => H;
  dispatch: (webContents: Electron.WebContents) => void;
  timeoutLabel: string;
}): Promise<R> {
  const { requestId, serverName, timeoutMs, signal, onCancelled, register, cancel, makeHandler, dispatch, timeoutLabel } = args;

  return new Promise<R>((resolve) => {
    let settled = false;
    let abortHandler: (() => void) | undefined;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      cancel(requestId);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      log.warn({ msg: `[McpAuthService] ${timeoutLabel} for "${serverName}" timed out after ${timeoutMs}ms — treating as cancel`, mod: 'McpAuthService' });
      resolve(onCancelled());
    }, timeoutMs);
    timer.unref?.();

    if (signal) {
      if (signal.aborted) {
        cleanup();
        resolve(onCancelled());
        return;
      }
      abortHandler = () => {
        if (settled) return;
        cleanup();
        resolve(onCancelled());
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    register(requestId, makeHandler((value) => {
      if (settled) return;
      cleanup();
      resolve(value);
    }));

    try {
      const targetWindow = pickAuthUiWindow(BrowserWindow.getAllWindows());
      if (!targetWindow?.webContents) {
        cleanup();
        resolve(onCancelled());
        return;
      }
      dispatch(targetWindow.webContents);
    } catch (error) {
      log.warn({ msg: `[McpAuthService] Failed to dispatch renderer prompt for "${serverName}": ${error instanceof Error ? error.message : String(error)}`, mod: 'McpAuthService' });
      cleanup();
      resolve(onCancelled());
    }
  });
}

function makeRequestId(kind: 'consent' | 'clientid'): string {
  return `mcp-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class McpAuthService {
  private readonly interactionListeners = new Set<McpAuthInteractionListener>();
  /**
   * Concurrent callers for the same server-key reuse one in-flight promise
   * so we never pop two consent dialogs / open two browser tabs.
   */
  private readonly inflightTokenRequests = new Map<string, Promise<string | undefined>>();

  onInteraction(listener: McpAuthInteractionListener): () => void {
    this.interactionListeners.add(listener);
    return () => {
      this.interactionListeners.delete(listener);
    };
  }

  private emitInteraction(event: Parameters<McpAuthInteractionListener>[0]): void {
    for (const listener of this.interactionListeners) {
      try {
        listener(event);
      } catch (error) {
        log.warn({ msg: `[McpAuthService] Interaction listener failed: ${error instanceof Error ? error.message : String(error)}`, mod: 'McpAuthService' });
      }
    }
  }

  /**
   * Acquire an access token for an MCP server.
   *
   * SDK-based PKCE flow with persistence in `DeskmateTokenCache.mcpOAuth`.
   * Concurrent callers for the same server-key share one in-flight flow —
   * we never pop two consent dialogs or open two browser tabs even when
   * parallel transports hit 401 at startup. `forceRefresh` latecomers
   * join too; the flow produces fresh tokens either way.
   */
  async getTokenForServer(
    serverName: string,
    metadata: McpResolvedAuthMetadata,
    options?: { forceRefresh?: boolean; cfg?: McpServerConfig; signal?: AbortSignal },
  ): Promise<string | undefined> {
    const cfg = options?.cfg;
    if (!cfg) {
      // Without cfg we can't compute a stable serverKey; surface a controlled
      // skip rather than throwing so the transport keeps using whatever
      // Authorization header was already on the request.
      log.warn({ msg: `[McpAuthService] Generic OAuth requested for ${serverName} but cfg was not threaded through transport — returning undefined`, mod: 'McpAuthService' });
      return undefined;
    }

    const dedupKey = getMcpOAuthServerKey(serverName, cfg);
    const inflight = this.inflightTokenRequests.get(dedupKey);
    if (inflight) {
      log.info({ msg: `[McpAuthService] Joining in-flight generic OAuth flow for ${serverName}`, mod: 'McpAuthService' });
      return inflight;
    }

    const promise = this.runOAuthFlow(serverName, metadata, cfg, options).finally(() => {
      this.inflightTokenRequests.delete(dedupKey);
    });
    this.inflightTokenRequests.set(dedupKey, promise);
    return promise;
  }

  private async runOAuthFlow(
    serverName: string,
    metadata: McpResolvedAuthMetadata,
    cfg: McpServerConfig,
    options?: { forceRefresh?: boolean; signal?: AbortSignal },
  ): Promise<string | undefined> {
    const provider = new DeskmateOAuthProvider(serverName, cfg);
    const { signal, forceRefresh } = options ?? {};

    // ─── Fast path / proactive refresh ───
    if (!forceRefresh) {
      const cached = await provider.tokens();
      if (cached?.access_token) {
        const expiresIn = cached.expires_in ?? Number.POSITIVE_INFINITY;
        if (expiresIn > PROACTIVE_REFRESH_WINDOW_SEC) {
          return cached.access_token;
        }
        // Inside the proactive refresh window: try refresh-token grant
        // directly. `runRefreshOnly` wraps the provider so the SDK's
        // would-redirect path throws instead of opening a browser — we
        // need this because the SDK silently falls through to redirect
        // on any non-OAuthError (transient 5xx, DNS hiccup, AbortSignal).
        // On any failure, fall through to the gated interactive flow.
        if (cached.refresh_token) {
          try {
            await runRefreshOnly(provider, serverName, cfg.url, { signal });
            const refreshed = await provider.tokens();
            if (refreshed?.access_token) return refreshed.access_token;
          } catch (e) {
            if (isMcpAuthCancelledError(e instanceof Error ? e : null)) throw e;
            log.info({ msg: `[McpAuthService] Proactive refresh failed for ${serverName} — falling through to interactive flow`, mod: 'McpAuthService', err: e });
          }
        }
      }
    } else {
      // Force-refresh: zero only the access-token expiry so the SDK's
      // auth() switches to refresh-token grant. Don't use
      // invalidateCredentials('tokens') — that wipes the refresh token too
      // (per the SDK contract for that scope), defeating the whole point
      // for providers like Slack/Atlassian that issue refresh tokens.
      await provider.markAccessTokenExpired();
    }

    // ─── Skip doomed sdkAuth() for known-no-DCR providers ───
    if (!(await provider.clientInformation()) && isKnownToNotSupportDcr(metadata)) {
      log.info({ msg: `[McpAuthService] ${serverName}: provider known to not support DCR, prompting user up front`, mod: 'McpAuthService' });
      await this.ensureCallbackServer(provider.pinnedCallbackPort);
      await this.promptForClientId(provider, serverName, metadata, cfg, signal);
    }

    // ─── Consent gate ───
    const consent = await this.requestConsent(serverName, metadata.providerLabel, signal);
    if (consent === 'cancel') throw createMcpAuthCancelledError(serverName);

    // ─── Drive SDK flow; retry once if DCR turns out to be unsupported ───
    try {
      await performOAuthFlow(provider, serverName, cfg.url, { signal });
    } catch (e) {
      const err = e instanceof Error ? e : null;
      if (isMcpAuthCancelledError(err)) throw e;
      if (!isMcpDcrRequiresUserClientIdError(err)) {
        log.warn({ msg: `[McpAuthService] Generic OAuth flow failed for ${serverName}: ${err?.message ?? String(e)}`, mod: 'McpAuthService' });
        throw e;
      }

      // DCR not supported and no clientId pre-configured: prompt + retry.
      await this.promptForClientId(provider, serverName, metadata, cfg, signal);
      await performOAuthFlow(provider, serverName, cfg.url, { signal });
    }

    return (await provider.tokens())?.access_token;
  }

  private async ensureCallbackServer(port: number): Promise<void> {
    try {
      await getCallbackServer(port).ensureRunning(port);
    } catch (e) {
      log.warn({ msg: `[McpAuthService] CallbackServer ensureRunning failed: ${e instanceof Error ? e.message : String(e)}`, mod: 'McpAuthService' });
      throw e;
    }
  }

  /**
   * Prompt the user for a manually-registered clientId, persist it. Throws
   * `createMcpAuthCancelledError` on cancellation so callers just re-throw.
   */
  private async promptForClientId(
    provider: DeskmateOAuthProvider,
    serverName: string,
    metadata: McpResolvedAuthMetadata,
    cfg: McpServerConfig,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const redirectUri = getCallbackServer(provider.pinnedCallbackPort).getRedirectUri();
    const provided = await this.requestClientIdFromUser({ serverName, metadata, cfg, redirectUri }, signal);
    if ('cancelled' in provided || !('clientId' in provided)) {
      throw createMcpAuthCancelledError(serverName);
    }
    await provider.saveClientInformation({
      client_id: provided.clientId,
      client_secret: provided.clientSecret,
    });
  }

  /**
   * Clear stored OAuth credentials for a single MCP server.
   *   - `'tokens'` (default): drop access+refresh+scope, keep clientId/secret.
   *   - `'all'`: drop everything including DCR clientId/secret.
   */
  async clearOAuthForServer(
    serverName: string,
    cfg: McpServerConfig,
    scope: 'tokens' | 'all' = 'tokens',
  ): Promise<void> {
    const provider = new DeskmateOAuthProvider(serverName, cfg);
    await provider.invalidateCredentials(scope);
    log.info({ msg: `[McpAuthService] Cleared OAuth credentials for "${serverName}" (scope=${scope})`, mod: 'McpAuthService' });
  }

  /**
   * Show the renderer-side "paste a client_id" dialog when the AS doesn't
   * support DCR. Honors signal + a 5-min timeout — without these the
   * promise can hang forever if the renderer crashes or the user walks away.
   */
  private requestClientIdFromUser(
    args: {
      serverName: string;
      metadata: McpResolvedAuthMetadata;
      cfg: McpServerConfig;
      redirectUri: string;
    },
    signal?: AbortSignal,
  ): Promise<McpAuthClientIdResponse> {
    const { serverName, metadata, cfg, redirectUri } = args;
    const requestId = makeRequestId('clientid');
    const instructions = getProviderHelp(metadata, cfg);

    return awaitRendererPrompt<ClientIdHandler, McpAuthClientIdResponse>({
      requestId,
      serverName,
      timeoutMs: MCP_AUTH_PROMPT_TIMEOUT_MS,
      signal,
      onCancelled: () => ({ cancelled: true }),
      timeoutLabel: 'Client-id dialog',
      register: (id, h) => mcpAuthPromptRegistry.registerClientId(id, h),
      cancel: (id) => mcpAuthPromptRegistry.cancelClientId(id),
      makeHandler: (resolve) => (response) => resolve(response),
      dispatch: (webContents) => {
        const payload: McpAuthClientIdRequestPayload = {
          requestId,
          serverName,
          providerLabel: instructions.label ?? metadata.providerLabel,
          redirectUri,
          instructions,
        };
        mcpAuthMainToRender.bindWebContents(webContents).requestClientId(payload);
      },
    });
  }

  private requestConsent(
    serverName: string,
    providerLabel: string,
    signal?: AbortSignal,
  ): Promise<McpAuthConsentDecision> {
    const requestId = makeRequestId('consent');

    return awaitRendererPrompt<ConsentHandler, McpAuthConsentDecision>({
      requestId,
      serverName,
      timeoutMs: MCP_AUTH_PROMPT_TIMEOUT_MS,
      signal,
      onCancelled: () => 'cancel',
      timeoutLabel: 'Consent dialog',
      register: (id, h) => mcpAuthPromptRegistry.registerConsent(id, h),
      cancel: (id) => mcpAuthPromptRegistry.cancelConsent(id),
      makeHandler: (resolve) => (decision) => resolve(decision),
      dispatch: (webContents) => {
        this.emitInteraction({ serverName, providerLabel, phase: 'consent-requested' });
        mcpAuthMainToRender.bindWebContents(webContents).showConsent({ requestId, serverName, providerLabel });
      },
    });
  }
}

export const mcpAuthService = new McpAuthService();

// ────────────────── Barrel re-exports (auth 目录对外唯一出口) ──────────────────
// 外部消费者一律从 `.../auth` import；不要深入到具体文件。
export { McpAuthMetadataService } from './McpAuthMetadataService';
export { mcpAuthPromptRegistry } from './mcpAuthPromptRegistry';
export type { McpAuthConsentDecision } from './mcpAuthPromptRegistry';
export type {
  McpAuthChallengeInfo,
  McpResolvedAuthMetadata,
  OAuthAuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
} from './types';
