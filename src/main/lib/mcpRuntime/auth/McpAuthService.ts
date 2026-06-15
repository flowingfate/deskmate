import * as msal from '@azure/msal-node';
import { BrowserWindow, shell } from 'electron';
import { log } from '@main/log';
import { pickAuthUiWindow } from './authWindowSelector';
import { APP_NAME } from '../../../../shared/constants/branding';
import { mcpAuthMainToRender } from '@shared/ipc/mcp';
import type { McpResolvedAuthMetadata } from './types';
import {
  createMcpAuthCancelledError,
  isMcpAuthCancelledError,
  isMcpDcrRequiresUserClientIdError,
} from './errors';
import { DeskmateOAuthProvider, PROACTIVE_REFRESH_WINDOW_SEC } from './DeskmateOAuthProvider';
import { performOAuthFlow, runRefreshOnly } from './performOAuthFlow';
import { getCallbackServer } from './CallbackServer';
import { getProviderHelp } from './dcrFallbackInstructions';
import { isKnownToNotSupportDcr } from './wellKnownOAuthProviders';
import { getMcpOAuthServerKey } from './serverKey';
import { mcpAuthPromptRegistry, type McpAuthConsentDecision } from './mcpAuthPromptRegistry';
import type { McpServerConfig } from '@shared/types/profileTypes';
import type { OAuthClientInformation } from '@modelcontextprotocol/sdk/shared/auth.js';
import type {
  McpAuthClientIdRequestPayload,
  McpAuthClientIdResponse,
} from '../../../../shared/types/mcpAuth';

const logger = log;
const BUILTIN_MICROSOFT_PUBLIC_CLIENT_ID = 'aebc6443-996d-45c2-90f0-388ff96faa56';
const CLIENT_ID_SCOPE_PREFIX = 'VSCODE_CLIENT_ID:';
/** Renderer-prompt timeout matches `CallbackServer.waitForCode`. On
 *  timeout/abort we resolve as cancelled so the transport surfaces a
 *  clean "needs sign-in" rather than hanging the connection. */
const MCP_AUTH_PROMPT_TIMEOUT_MS = 5 * 60_000;

type McpAuthInteractionListener = (event: {
  serverName: string;
  providerLabel: string;
  phase: 'consent-requested';
}) => void;

type PublicClientAppEntry = {
  app: msal.PublicClientApplication;
};

type InMemoryTokenEntry = {
  accessToken: string;
  expiresAt: number;
};

function summarizeClientId(clientId: string): string {
  if (clientId.length <= 8) {
    return clientId;
  }
  return `${clientId.slice(0, 4)}...${clientId.slice(-4)}`;
}

function resolveClientId(metadata: McpResolvedAuthMetadata): { clientId: string; source: 'challenge-scope' | 'builtin-default' } {
  const hintedClientId = metadata.scopes.find((scope) => scope.startsWith(CLIENT_ID_SCOPE_PREFIX))?.slice(CLIENT_ID_SCOPE_PREFIX.length)?.trim();
  if (hintedClientId) {
    return {
      clientId: hintedClientId,
      source: 'challenge-scope',
    };
  }

  return {
    clientId: BUILTIN_MICROSOFT_PUBLIC_CLIENT_ID,
    source: 'builtin-default',
  };
}

function resolveScopesToSend(metadata: McpResolvedAuthMetadata): string[] {
  const scopes = metadata.scopes.filter((scope) => !scope.startsWith('VSCODE_'));
  const nonOidcScopes = scopes.filter((scope) => !['openid', 'email', 'profile', 'offline_access'].includes(scope));
  if (nonOidcScopes.length === 0) {
    return [...scopes, 'User.Read'];
  }
  return scopes;
}

function isMicrosoftAuthority(metadata: McpResolvedAuthMetadata): boolean {
  const haystack = `${metadata.authorizationServerUrl} ${metadata.authorizationServerMetadata.issuer || ''}`.toLowerCase();
  return haystack.includes('login.microsoftonline.com')
    || haystack.includes('login.windows.net')
    || haystack.includes('microsoftonline.com')
    || haystack.includes('microsoft.com');
}

export class McpAuthService {
  private static instance: McpAuthService | null = null;
  private static interactionListeners = new Set<McpAuthInteractionListener>();
  private readonly apps = new Map<string, Promise<PublicClientAppEntry>>();
  private readonly inMemoryTokens = new Map<string, InMemoryTokenEntry>();
  private readonly tokenRequests = new Map<string, Promise<string | undefined>>();
  /**
   * Concurrent callers for the same server-key reuse one in-flight promise
   * so we never pop two consent dialogs / open two browser tabs.
   */
  private readonly genericTokenRequests = new Map<string, Promise<string | undefined>>();

  static getInstance(): McpAuthService {
    if (!McpAuthService.instance) {
      McpAuthService.instance = new McpAuthService();
    }
    return McpAuthService.instance;
  }

  static onInteraction(listener: McpAuthInteractionListener): () => void {
    McpAuthService.interactionListeners.add(listener);
    return () => {
      McpAuthService.interactionListeners.delete(listener);
    };
  }

  private static emitInteraction(event: {
    serverName: string;
    providerLabel: string;
    phase: 'consent-requested';
  }): void {
    for (const listener of McpAuthService.interactionListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.warn({ msg: `[McpAuthService] Interaction listener failed: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }

  /**
   * Acquire an access token for an MCP server. Routes Microsoft authorities
   * to the MSAL path and everything else to `_performGenericOAuth`
   * (PKCE + DCR via the SDK, persisted in `DeskmateTokenCache.mcpOAuth`).
   */
  async getTokenForServer(
    serverName: string,
    metadata: McpResolvedAuthMetadata,
    options?: { forceRefresh?: boolean; cfg?: McpServerConfig; signal?: AbortSignal },
  ): Promise<string | undefined> {
    if (isMicrosoftAuthority(metadata)) {
      return this.getTokenForMicrosoft(serverName, metadata, options);
    }
    return this.getTokenForGenericOAuth(serverName, metadata, options);
  }

  // ────────────────── Generic OAuth (non-Microsoft) ──────────────────

  /** SDK-based PKCE flow with persistence in `DeskmateTokenCache.mcpOAuth`. */
  private async getTokenForGenericOAuth(
    serverName: string,
    metadata: McpResolvedAuthMetadata,
    options?: { forceRefresh?: boolean; cfg?: McpServerConfig; signal?: AbortSignal },
  ): Promise<string | undefined> {
    const cfg = options?.cfg;
    if (!cfg) {
      // Without cfg we can't compute a stable serverKey; surface a controlled
      // skip rather than throwing so the transport keeps using whatever
      // Authorization header was already on the request.
      logger.warn({ msg: `[McpAuthService] Generic OAuth requested for ${serverName} but cfg was not threaded through transport — returning undefined` });
      return undefined;
    }

    // Dedupe concurrent requests for the same server (parallel transports
    // hitting 401 at startup) so we don't open two browser tabs. forceRefresh
    // latecomers join too — the in-flight flow produces fresh tokens either way.
    const dedupKey = getMcpOAuthServerKey(serverName, cfg);
    const inflight = this.genericTokenRequests.get(dedupKey);
    if (inflight) {
      logger.info({ msg: `[McpAuthService] Joining in-flight generic OAuth flow for ${serverName}` });
      return inflight;
    }

    const promise = this._performGenericOAuth(serverName, metadata, cfg, options).finally(() => {
      this.genericTokenRequests.delete(dedupKey);
    });
    this.genericTokenRequests.set(dedupKey, promise);
    return promise;
  }

  private async _performGenericOAuth(
    serverName: string,
    metadata: McpResolvedAuthMetadata,
    cfg: McpServerConfig,
    options?: { forceRefresh?: boolean; signal?: AbortSignal },
  ): Promise<string | undefined> {
    const provider = new DeskmateOAuthProvider(serverName, cfg);

    // Fast path / proactive refresh.
    if (!options?.forceRefresh) {
      const cachedTokens = await provider.tokens();
      if (cachedTokens?.access_token) {
        const expiresIn = cachedTokens.expires_in ?? Number.POSITIVE_INFINITY;
        if (expiresIn > PROACTIVE_REFRESH_WINDOW_SEC) {
          return cachedTokens.access_token;
        }
        // Inside the proactive refresh window: try refresh-token grant
        // directly. `runRefreshOnly` wraps the provider so the SDK's
        // would-redirect path throws instead of opening a browser — we
        // need this because the SDK silently falls through to redirect
        // on any non-OAuthError (transient 5xx, DNS hiccup, AbortSignal).
        // On any failure, fall through to the gated interactive flow.
        if (cachedTokens.refresh_token) {
          try {
            await runRefreshOnly(provider, serverName, cfg.url, {
              signal: options?.signal,
            });
            const refreshed = await provider.tokens();
            if (refreshed?.access_token) {
              return refreshed.access_token;
            }
          } catch (e) {
            if (isMcpAuthCancelledError(e instanceof Error ? e : null)) {
              throw e;
            }
            logger.info({ msg: `[McpAuthService] Proactive refresh failed for ${serverName} — falling through to interactive flow`, mod: '_performGenericOAuth', err: e });
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

    // Skip the doomed sdkAuth() call for known-no-DCR providers and
    // surface the fallback dialog up front.
    const hasClientInfo = !!(await provider.clientInformation());
    if (!hasClientInfo && isKnownToNotSupportDcr(metadata)) {
      logger.info({ msg: `[McpAuthService] ${serverName}: provider known to not support DCR, prompting user up front` });
      const port = provider.pinnedCallbackPort;
      try {
        await getCallbackServer(port).ensureRunning(port);
      } catch (e) {
        logger.warn({ msg: `[McpAuthService] CallbackServer ensureRunning failed: ${e instanceof Error ? e.message : String(e)}` });
        throw e;
      }
      const provided = await this.requestClientIdFromUser({
        serverName,
        metadata,
        cfg,
        redirectUri: getCallbackServer(port).getRedirectUri(),
      }, { signal: options?.signal });
      if ('cancelled' in provided && provided.cancelled) {
        throw createMcpAuthCancelledError(serverName);
      }
      if (!('clientId' in provided)) {
        throw createMcpAuthCancelledError(serverName);
      }
      await provider.saveClientInformation({
        client_id: provided.clientId,
        client_secret: provided.clientSecret,
      });
    }

    const consent = await this.requestConsent(serverName, metadata.providerLabel, { signal: options?.signal });
    if (consent === 'cancel') {
      throw createMcpAuthCancelledError(serverName);
    }

    try {
      await performOAuthFlow(provider, serverName, cfg.url, {
        signal: options?.signal,
      });
    } catch (e) {
      const err = e instanceof Error ? e : null;
      if (isMcpAuthCancelledError(err)) {
        throw e;
      }
      if (isMcpDcrRequiresUserClientIdError(err)) {
        // DCR not supported and no clientId pre-configured: prompt the user.
        const port = provider.pinnedCallbackPort;
        const provided = await this.requestClientIdFromUser({
          serverName,
          metadata,
          cfg,
          redirectUri: getCallbackServer(port).getRedirectUri(),
        }, { signal: options?.signal });
        if ('cancelled' in provided && provided.cancelled) {
          throw createMcpAuthCancelledError(serverName);
        }
        if (!('clientId' in provided)) {
          throw createMcpAuthCancelledError(serverName);
        }

        await provider.saveClientInformation({
          client_id: provided.clientId,
          client_secret: provided.clientSecret,
        });

        try {
          await performOAuthFlow(provider, serverName, cfg.url, {
            signal: options?.signal,
          });
        } catch (e2) {
          const err2 = e2 instanceof Error ? e2 : null;
          if (isMcpAuthCancelledError(err2)) {
            throw e2;
          }
          logger.warn({ msg: `[McpAuthService] OAuth flow retry failed after user-supplied clientId for ${serverName}: ${err2?.message ?? String(e2)}` });
          throw e2;
        }
      } else {
        logger.warn({ msg: `[McpAuthService] Generic OAuth flow failed for ${serverName}: ${err?.message ?? String(e)}` });
        throw e;
      }
    }

    const tokens = await provider.tokens();
    return tokens?.access_token;
  }

  /**
   * Clear stored OAuth credentials for a single MCP server.
   *   - `'tokens'` (default): drop access+refresh+scope, keep clientId/secret.
   *   - `'all'`: drop everything including DCR clientId/secret.
   *
   * Microsoft (MSAL) servers are out of scope here; their tokens live in
   * MSAL's own per-account cache.
   */
  async clearOAuthForServer(
    serverName: string,
    cfg: McpServerConfig,
    scope: 'tokens' | 'all' = 'tokens',
  ): Promise<void> {
    const provider = new DeskmateOAuthProvider(serverName, cfg);
    await provider.invalidateCredentials(scope);

    // Best-effort: also flush any in-memory MSAL token cache entries for
    // this server, in case it was previously a Microsoft-protected server.
    for (const key of Array.from(this.inMemoryTokens.keys())) {
      if (key.includes(serverName)) {
        this.inMemoryTokens.delete(key);
      }
    }

    logger.info({ msg: `[McpAuthService] Cleared OAuth credentials for "${serverName}" (scope=${scope})` });
  }

  /**
   * Show the renderer-side "paste a client_id" dialog when the AS doesn't
   * support DCR. Honors signal + a 5-min timeout — without these the
   * promise can hang forever if the renderer crashes or the user walks away.
   */
  private async requestClientIdFromUser(
    args: {
      serverName: string;
      metadata: McpResolvedAuthMetadata;
      cfg: McpServerConfig;
      redirectUri: string;
    },
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<McpAuthClientIdResponse> {
    const { serverName, metadata, cfg, redirectUri } = args;
    const signal = options?.signal;
    const timeoutMs = options?.timeoutMs ?? MCP_AUTH_PROMPT_TIMEOUT_MS;

    const instructions = getProviderHelp(metadata, cfg);
    const requestId = `mcp-clientid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<McpAuthClientIdResponse>((resolve) => {
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
        mcpAuthPromptRegistry.cancelClientId(requestId);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        logger.warn({ msg: `[McpAuthService] Client-id dialog for "${serverName}" timed out after ${timeoutMs}ms — treating as cancel` });
        resolve({ cancelled: true });
      }, timeoutMs);
      timer.unref?.();

      const abortHandler = () => {
        if (settled) return;
        cleanup();
        resolve({ cancelled: true });
      };
      if (signal) {
        if (signal.aborted) {
          abortHandler();
          return;
        }
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      mcpAuthPromptRegistry.registerClientId(requestId, (response) => {
        if (settled) return;
        cleanup();
        resolve(response);
      });

      try {
        const targetWindow = pickAuthUiWindow(BrowserWindow.getAllWindows());
        if (!targetWindow?.webContents) {
          cleanup();
          resolve({ cancelled: true });
          return;
        }

        const payload: McpAuthClientIdRequestPayload = {
          requestId,
          serverName,
          providerLabel: instructions.label ?? metadata.providerLabel,
          redirectUri,
          instructions,
        };

        mcpAuthMainToRender.bindWebContents(targetWindow.webContents).requestClientId(payload);
      } catch (error) {
        logger.warn({ msg: `[McpAuthService] Failed to dispatch MCP client-id request: ${error instanceof Error ? error.message : String(error)}` });
        cleanup();
        resolve({ cancelled: true });
      }
    });
  }

  // ────────────────── Microsoft (MSAL) ──────────────────

  /** MSAL-based flow for Microsoft authorities. */
  private async getTokenForMicrosoft(
    serverName: string,
    metadata: McpResolvedAuthMetadata,
    options?: { forceRefresh?: boolean },
  ): Promise<string | undefined> {
    if (!metadata.scopes.length) {
      logger.warn({ msg: `[McpAuthService] No scopes resolved for ${serverName}` });
      return undefined;
    }

    const resolvedClient = resolveClientId(metadata);
    const scopesToSend = resolveScopesToSend(metadata);
    const hintedClientId = metadata.scopes.find((scope) => scope.startsWith(CLIENT_ID_SCOPE_PREFIX))?.slice(CLIENT_ID_SCOPE_PREFIX.length)?.trim();

    const authority = metadata.authorizationServerMetadata.issuer || metadata.authorizationServerUrl;
    logger.info({ msg: `[McpAuthService] Auth decision for ${serverName}: `
                + `provider=${metadata.providerLabel}, `
                + `authority=${authority}, `
                + `clientSource=${resolvedClient.source}, `
                + `clientId=${summarizeClientId(resolvedClient.clientId)}, `
                + `challengeHint=${hintedClientId ? summarizeClientId(hintedClientId) : 'none'}, `
                + `scopes=${JSON.stringify(scopesToSend)}, `
                + `forceRefresh=${options?.forceRefresh ? 'true' : 'false'}` });

    const tokenCacheKey = this.buildTokenCacheKey(resolvedClient.clientId, authority, scopesToSend);
    if (!options?.forceRefresh) {
      const cachedToken = this.getCachedInMemoryToken(tokenCacheKey);
      if (cachedToken) {
        logger.info({ msg: `[McpAuthService] Reusing in-memory token for ${serverName}` });
        return cachedToken;
      }

      const inflightRequest = this.tokenRequests.get(tokenCacheKey);
      if (inflightRequest) {
        logger.info({ msg: `[McpAuthService] Waiting for in-flight token acquisition for ${serverName}` });
        return inflightRequest;
      }
    }

    const tokenPromise = this.acquireTokenForServer(serverName, metadata, {
      forceRefresh: options?.forceRefresh,
      authority,
      clientId: resolvedClient.clientId,
      scopesToSend,
      tokenCacheKey,
    });

    if (!options?.forceRefresh) {
      this.tokenRequests.set(tokenCacheKey, tokenPromise);
    }

    try {
      return await tokenPromise;
    } finally {
      if (!options?.forceRefresh) {
        const inflightRequest = this.tokenRequests.get(tokenCacheKey);
        if (inflightRequest === tokenPromise) {
          this.tokenRequests.delete(tokenCacheKey);
        }
      }
    }
  }

  private async acquireTokenForServer(
    serverName: string,
    metadata: McpResolvedAuthMetadata,
    context: {
      forceRefresh?: boolean;
      authority: string;
      clientId: string;
      scopesToSend: string[];
      tokenCacheKey: string;
    }
  ): Promise<string | undefined> {
    const { app } = await this.getPublicClientApplication(context.clientId, context.authority);

    try {
      const accounts = await app.getTokenCache().getAllAccounts();
      logger.info({ msg: `[McpAuthService] Cached account count for ${serverName}: ${accounts.length}` });
      if (accounts.length > 0) {
        const silentResult = await app.acquireTokenSilent({
          account: accounts[0],
          scopes: context.scopesToSend,
          forceRefresh: context.forceRefresh ?? false,
        });
        if (silentResult?.accessToken) {
          logger.info({ msg: `[McpAuthService] Silent token acquisition succeeded for ${serverName}` });
          this.storeInMemoryToken(context.tokenCacheKey, silentResult);
          return silentResult.accessToken;
        }
      }
    } catch (error) {
      logger.info({ msg: `[McpAuthService] Silent token acquisition failed for ${serverName}: ${error instanceof Error ? error.message : String(error)}` });
    }

    const consent = await this.requestConsent(serverName, metadata.providerLabel);
    if (consent === 'cancel') {
      throw createMcpAuthCancelledError(serverName);
    }

    logger.info({ msg: `[McpAuthService] Falling back to interactive token acquisition for ${serverName}` });
    logger.info({ msg: `[McpAuthService] Interactive auth mode for ${serverName}: external-browser` });
    const interactiveResult = await app.acquireTokenInteractive({
      scopes: context.scopesToSend,
      openBrowser: async (url: string) => {
        await shell.openExternal(url);
      },
      successTemplate: `<html><body><h2>Authentication complete</h2><p>You can close this window and return to ${APP_NAME}.</p></body></html>`,
      errorTemplate: `<html><body><h2>Authentication failed</h2><p>You can close this window and return to ${APP_NAME}.</p></body></html>`,
    });

    logger.info({ msg: `[McpAuthService] Interactive token acquisition ${interactiveResult?.accessToken ? 'succeeded' : 'returned no token'} for ${serverName}` });

    this.storeInMemoryToken(context.tokenCacheKey, interactiveResult);

    return interactiveResult?.accessToken || undefined;
  }

  private buildTokenCacheKey(clientId: string, authority: string, scopes: string[]): string {
    return `${clientId}::${authority}::${[...scopes].sort().join(' ')}`;
  }

  private getCachedInMemoryToken(key: string): string | undefined {
    const entry = this.inMemoryTokens.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.inMemoryTokens.delete(key);
      return undefined;
    }

    return entry.accessToken;
  }

  private storeInMemoryToken(key: string, result: Pick<msal.AuthenticationResult, 'accessToken' | 'expiresOn'> | null | undefined): void {
    if (!result?.accessToken) {
      return;
    }

    const expiresAt = result.expiresOn?.getTime() ?? Date.now() + 5 * 60 * 1000;
    this.inMemoryTokens.set(key, {
      accessToken: result.accessToken,
      expiresAt,
    });
  }

  private async getPublicClientApplication(clientId: string, authority: string): Promise<PublicClientAppEntry> {
    const key = `${clientId}::${authority}`;
    const existing = this.apps.get(key);
    if (existing) {
      return existing;
    }

    const appPromise = this.createPublicClientApplication(clientId, authority);
    this.apps.set(key, appPromise);

    try {
      return await appPromise;
    } catch (error) {
      this.apps.delete(key);
      throw error;
    }
  }

  private async createPublicClientApplication(clientId: string, authority: string): Promise<PublicClientAppEntry> {
    const app = new msal.PublicClientApplication({
      auth: {
        clientId,
        authority,
      },
      system: {
        loggerOptions: {
          logLevel: msal.LogLevel.Warning,
          loggerCallback: (level, message) => {
            if (level === msal.LogLevel.Error) {
              logger.error({ msg: `[McpAuthService] ${message}` });
            } else if (level === msal.LogLevel.Warning) {
              logger.warn({ msg: `[McpAuthService] ${message}` });
            }
          },
        },
      },
    });

    logger.info({ msg: `[McpAuthService] Created MSAL client (external-browser-first) for authority ${authority}` });
    return { app };
  }

  private async requestConsent(
    serverName: string,
    providerLabel: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<McpAuthConsentDecision> {
    const signal = options?.signal;
    const timeoutMs = options?.timeoutMs ?? MCP_AUTH_PROMPT_TIMEOUT_MS;
    const requestId = `mcp-consent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<McpAuthConsentDecision>((resolve) => {
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
        mcpAuthPromptRegistry.cancelConsent(requestId);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        logger.warn({ msg: `[McpAuthService] Consent dialog for "${serverName}" timed out after ${timeoutMs}ms — treating as cancel` });
        resolve('cancel');
      }, timeoutMs);
      timer.unref?.();

      const abortHandler = () => {
        if (settled) return;
        cleanup();
        resolve('cancel');
      };
      if (signal) {
        if (signal.aborted) {
          abortHandler();
          return;
        }
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      mcpAuthPromptRegistry.registerConsent(requestId, (decision) => {
        if (settled) return;
        cleanup();
        resolve(decision);
      });

      try {
        const targetWindow = pickAuthUiWindow(BrowserWindow.getAllWindows());
        if (!targetWindow?.webContents) {
          cleanup();
          resolve('cancel');
          return;
        }

        McpAuthService.emitInteraction({
          serverName,
          providerLabel,
          phase: 'consent-requested',
        });

        mcpAuthMainToRender.bindWebContents(targetWindow.webContents).showConsent({
          requestId,
          serverName,
          providerLabel,
        });
      } catch (error) {
        logger.warn({ msg: `[McpAuthService] Failed to dispatch MCP auth consent: ${error instanceof Error ? error.message : String(error)}` });
        cleanup();
        resolve('cancel');
      }
    });
  }
}
