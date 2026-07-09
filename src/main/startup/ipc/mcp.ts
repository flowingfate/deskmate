import { ipcMain } from 'electron';

import { Profiles } from '../../persist/profiles';
import { log } from '@main/log';
import type { Context } from './shared';
import { mcpClientManager } from "../../lib/mcpRuntime"
import { mcpAuthPromptRegistry, mcpAuthService } from "../../lib/mcpRuntime/auth";
import { mcpRenderToMain, mcpAuthRenderToMain } from '@shared/ipc/mcp';

export default function(ctx: Context) {
  const handleMcp = mcpRenderToMain.bindMain(ipcMain);
  const handleMcpAuth = mcpAuthRenderToMain.bindMain(ipcMain);

  // MCP Status Operations - AUTHORIZED
  // 🆕 Refactor: get runtime status directly from mcpClientManager
  handleMcp.getServerStatus(async () => {
    try {
      // 🆕 Dynamically import mcpClientManager

      // Get runtime status from mcpClientManager
      const runtimeStates = mcpClientManager.getAllMcpServerRuntimeStates();

      // Serialize error objects for IPC transmission
      const serverStatus = runtimeStates.map(state => ({
        serverName: state.serverName,
        status: state.status,
        tools: state.tools,
        lastError: state.lastError ? state.lastError.message : null
      }));

      return { success: true, data: serverStatus };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });





  handleMcpAuth.respondConsent(async (
    event,
    requestId,
    decision,
  ) => {
    const logger = log;
    if (!['cancel', 'allow-this-time'].includes(decision)) {
      return { success: false, error: 'Invalid MCP auth consent decision' };
    }

    logger.info({ msg: '[MCP-AUTH-IPC] Consent response received', mod: 'mcpAuth:respondConsent', requestId, decision, senderUrl: event.sender?.getURL?.() || '' });

    const handler = mcpAuthPromptRegistry.takeConsent(requestId);
    if (handler) {
      handler(decision);
      return { success: true };
    }

    return { success: false, error: 'No pending MCP auth consent request' };
  });

  /**
   * Renderer's response to a `mcpAuth:requestClientId` prompt. Either the
   * user supplies a client_id (and optionally a client_secret), or they
   * cancel. The main-process orchestrator (DeskmateOAuthProvider flow)
   * registers a one-shot handler under `requestId` in
   * `__pendingMcpAuthClientIdRequest` before sending the prompt.
   */
  handleMcpAuth.respondClientId(async (
    event,
    requestId,
    response,
  ) => {
    const logger = log;

    const isCancel = !!response && 'cancelled' in response && response.cancelled === true;
    const isProvide = !!response
      && 'clientId' in response
      && typeof response.clientId === 'string'
      && response.clientId.trim().length > 0;
    if (!isCancel && !isProvide) {
      return { success: false, error: 'Invalid MCP auth client-id response' };
    }

    logger.info({ msg: '[MCP-AUTH-IPC] Client-id response received', mod: 'mcpAuth:respondClientId', requestId, kind: isCancel ? 'cancel' : 'provided', senderUrl: event.sender?.getURL?.() || '' });

    const handler = mcpAuthPromptRegistry.takeClientId(requestId);
    if (handler) {
      handler(response);
      return { success: true };
    }

    return { success: false, error: 'No pending MCP auth client-id request' };
  });

  /**
   * Reset stored OAuth credentials for a single MCP server.
   *
   * Intended primarily for development / testing flows where you need to
   * re-authenticate against a different account or rotate the OAuth app.
   * Disconnects the server first so the in-memory client drops its current
   * Bearer token; the next connect re-runs the OAuth flow.
   *
   * `scope`:
   *   - `'tokens'` (default): drop access + refresh token only. Re-runs
   *     PKCE against the same OAuth app — useful for switching accounts
   *     at the provider's own login page.
   *   - `'all'`: drop everything including the registered clientId.
   *     Next connect surfaces the DCR-fallback dialog again — useful for
   *     swapping to a different OAuth app entirely.
   */
  handleMcp.resetOAuth(async (
    _event,
    serverName,
    scope,
  ) => {
    const logger = log;
    try {
      const profile = await Profiles.get().active();
      const config = profile.mcp.get(serverName);
      if (!config) {
        return { success: false, error: `Server "${serverName}" not found` };
      }

      // Disconnect first so the live client stops using the about-to-be-cleared token.
      try {
        await mcpClientManager.disconnect(serverName);
      } catch (e) {
        logger.warn({ msg: '[MCP-IPC] Disconnect before OAuth reset failed (continuing)', mod: 'mcp:resetOAuth', serverName, err: e });
      }

      await mcpAuthService.clearOAuthForServer(
        serverName,
        config,
        scope,
      );

      logger.info({ msg: '[MCP-IPC] OAuth credentials reset', mod: 'mcp:resetOAuth', serverName, scope });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn({ msg: '[MCP-IPC] OAuth reset failed', mod: 'mcp:resetOAuth', serverName, err: message });
      return { success: false, error: message };
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Server CRUD（Step 7 PR-3 从老 profile 通道搬入；纯包装 mcpClientManager.*）
  // ─────────────────────────────────────────────────────────────

  const errMsg = (error: unknown): string =>
    error instanceof Error ? error.message : 'Unknown error';

  handleMcp.addServer(async (_event, serverName, serverConfig) => {
    try {
      await mcpClientManager.add(serverName, serverConfig);
      return { success: true };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  handleMcp.updateServer(async (_event, serverName, serverConfig) => {
    try {
      await mcpClientManager.update(serverName, serverConfig);
      return { success: true };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  handleMcp.deleteServer(async (_event, serverName) => {
    try {
      await mcpClientManager.delete(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  handleMcp.connectServer(async (_event, serverName) => {
    try {
      await mcpClientManager.connect(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  handleMcp.reconnectServer(async (_event, serverName) => {
    try {
      await mcpClientManager.reconnect(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  handleMcp.disconnectServer(async (_event, serverName) => {
    try {
      await mcpClientManager.disconnect(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });
}
