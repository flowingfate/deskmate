import { ipcMain } from 'electron';

import { log } from '@main/log';
import { mcpRenderToMain, mcpAuthRenderToMain } from '@shared/ipc/mcp';
import { requireProfileForSender } from './profileContext';

export default function() {
  const handleMcp = mcpRenderToMain.bindMain(ipcMain);
  const handleMcpAuth = mcpAuthRenderToMain.bindMain(ipcMain);

  // MCP Status Operations
  handleMcp.getServerStatus(async (event) => {
    try {
      const profile = requireProfileForSender(event);
      const runtimeStates = profile.mcpManager.getAllMcpServerRuntimeStates();
      return {
        success: true,
        data: runtimeStates.map((state) => ({
          serverName: state.serverName,
          status: state.status,
          tools: state.tools,
          lastError: state.lastError ? state.lastError.message : null,
        })),
      };
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

    if (requireProfileForSender(event).mcpManager.respondAuthConsent(requestId, decision)) {
      return { success: true };
    }

    return { success: false, error: 'No pending MCP auth consent request' };
  });

  /**
   * Renderer's response to a `mcpAuth:requestClientId` prompt. The sender's
   * profile-bound MCP manager resolves its own one-shot requestId handler;
   * another Profile cannot consume this response.
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

    if (requireProfileForSender(event).mcpManager.respondAuthClientId(requestId, response)) {
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
    event,
    serverName,
    scope,
  ) => {
    const logger = log;
    try {
      const profile = requireProfileForSender(event);
      const config = profile.store.mcp.get(serverName);
      if (!config) {
        return { success: false, error: `Server "${serverName}" not found` };
      }

      // Disconnect first so the live client stops using the about-to-be-cleared token.
      try {
        await profile.mcpManager.disconnect(serverName);
      } catch (e) {
        logger.warn({ msg: '[MCP-IPC] Disconnect before OAuth reset failed (continuing)', mod: 'mcp:resetOAuth', serverName, err: e });
      }

      await profile.mcpManager.clearOAuthForServer(serverName, config, scope);

      logger.info({ msg: '[MCP-IPC] OAuth credentials reset', mod: 'mcp:resetOAuth', serverName, scope });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn({ msg: '[MCP-IPC] OAuth reset failed', mod: 'mcp:resetOAuth', serverName, err: message });
      return { success: false, error: message };
    }
  });

  // Server CRUD：精确路由到 runtime Profile 的 MCP manager
  // ─────────────────────────────────────────────────────────────

  const errMsg = (error: unknown): string =>
    error instanceof Error ? error.message : 'Unknown error';

  handleMcp.addServer(async (event, serverName, serverConfig) => {
    try {
      await requireProfileForSender(event).mcpManager.add(serverName, serverConfig);
      return { success: true };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  handleMcp.updateServer(async (event, serverName, serverConfig) => {
    try {
      await requireProfileForSender(event).mcpManager.update(serverName, serverConfig);
      return { success: true };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  handleMcp.deleteServer(async (event, serverName) => {
    try {
      await requireProfileForSender(event).mcpManager.delete(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  handleMcp.connectServer(async (event, serverName) => {
    try {
      await requireProfileForSender(event).mcpManager.connect(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  handleMcp.reconnectServer(async (event, serverName) => {
    try {
      await requireProfileForSender(event).mcpManager.reconnect(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });

  handleMcp.disconnectServer(async (event, serverName) => {
    try {
      await requireProfileForSender(event).mcpManager.disconnect(serverName);
      return { success: true };
    } catch (error) {
      return { success: false, error: errMsg(error) };
    }
  });
}
