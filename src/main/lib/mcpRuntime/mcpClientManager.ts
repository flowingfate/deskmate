// import { MCPClient } from './mcpClient'; // 🚫 MCPClient (SDK) disabled
import { McpClient } from './mcpClient';

import { McpServerConfig } from '@shared/types/profileTypes';
import { mcpMainToRender } from '@shared/ipc/mcp';
import { log } from '@main/log';
import { McpAuthService } from './auth/McpAuthService';
import { eachWebContent } from '@main/startup/wins';
import { execSync } from 'child_process';
import { Profiles } from '../../persist';
import type { Mcp } from '../../persist';

/**
 * Client implementation type
 */
type ClientImplementation = 'sdk' | 'native';

/**
 * Unified client interface for both implementations
 */
interface IUnifiedMcpClient {
  connectToServer(): Promise<string | Error>;
  getTools(): Promise<{ name: string; description?: string; inputSchema: any }[]>;
  executeTool({ toolName, toolArgs, signal }: { toolName: string; toolArgs: { [key: string]: unknown }; signal?: AbortSignal }): Promise<string>;
  cleanup(): Promise<void>;
}

// Initialize console-only logger for MCP client manager
let advancedLogger: any;
(async () => {
  advancedLogger = await log;
})();


/**
 * MCP Server status enumeration
 */
export type MCPServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'disconnecting' | 'needs-user-interaction';

/**
 * Runtime state for MCP servers (memory-only, not persisted)
 * 🆕 Refactored: Directly managed by mcpClientManager, no longer delegated through profileCacheManager
 */
export interface MCPServerRuntimeState {
  serverName: string;
  status: MCPServerStatus;
  tools: { name: string; description?: string; inputSchema: any }[];
  lastError: Error | null;
}

/**
 * Operation lock interface
 */
interface OperationLock {
  operation: 'connect' | 'disconnect' | 'reconnect';
  promise: Promise<void>;
  timestamp: number;
  abortController?: AbortController; // Add abort controller
}

/**
 * Connection process interface for tracking ongoing connections
 */
interface ConnectionProcess {
  serverName: string;
  abortController: AbortController;
  client: IUnifiedMcpClient;
  startTime: number;
}

/**
 * Enhanced MCP client manager (Singleton). Owns the in-tree zero-dependency
 * MCP client instances, runtime state, and frontend notifications.
 *
 * Responsibilities:
 * - Manage MCP client runtime instances (Map<mcp name, unified client>)
 * - Use the in-tree zero-dependency MCP client for all transports (stdio / sse / streamablehttp)
 * - Manage tool to server mappings (Map<tool name, mcp name>)
 * - Handle connection/disconnection operations
 * - Directly manage MCP server runtime state (status, tools, error)
 * - Notify frontend mcpClientCacheManager of state changes via IPC
 *
 * Client Implementation Strategy:
 * - All transport types route through the in-tree McpClient adapter (which wraps
 *   `client/Client.ts` + transports). The legacy SDK client is permanently disabled
 *   because its HTTP transport leaks memory.
 *
 * Client Implementation Support:
 * - 'native': in-tree McpClient — for ALL transport types
 * - 'sdk': DISABLED — kept in the union only as a defensive rejection target
 *
 * Delegates to ProfileCacheManager:
 * - Server configuration management (config persistence only)
 */
export class MCPClientManager {
  private static instance: MCPClientManager | null = null;
  private mcpClients: Map<string, IUnifiedMcpClient> = new Map(); // serverName -> Unified Client
  private clientImplementations: Map<string, ClientImplementation> = new Map(); // serverName -> implementation type
  private operationLocks: Map<string, OperationLock> = new Map(); // serverName -> OperationLock
  private activeConnections: Map<string, ConnectionProcess> = new Map(); // serverName -> ConnectionProcess
  private instanceId: string = Math.random().toString(36).substr(2, 9);
  private currentProfileId: string | null = null;
  private defaultImplementation: ClientImplementation = 'native'; // All transports use the in-tree client

  // 🆕 Refactored: Runtime state directly managed by mcpClientManager
  private runtimeStates: Map<string, MCPServerRuntimeState> = new Map(); // serverName -> runtimeState

  // Batched notification mechanism
  private notificationTimeout: NodeJS.Timeout | null = null;
  private pendingNotification = false;

  private constructor() {
    McpAuthService.onInteraction(({ serverName, phase }) => {
      if (phase === 'consent-requested') {
        this._updateServerStatus(serverName, 'needs-user-interaction');
      }
    });
  }

  // ==================== 🆕 Runtime State Management Methods ====================

  /**
   * 🆕 Update MCP server status
   * @param serverName - Server name
   * @param status - New status
   */
  private _updateServerStatus(serverName: string, status: MCPServerStatus): void {
    let state = this.runtimeStates.get(serverName);
    if (!state) {
      state = {
        serverName,
        status: 'disconnected',
        tools: [],
        lastError: null
      };
      this.runtimeStates.set(serverName, state);
    }
    state.status = status;
    this._scheduleNotification();
  }

  /**
   * 🆕 Update MCP server tool list
   * @param serverName - Server name
   * @param tools - Tool list
   */
  private _updateServerTools(serverName: string, tools: { name: string; description?: string; inputSchema: any }[]): void {
    let state = this.runtimeStates.get(serverName);
    if (!state) {
      state = {
        serverName,
        status: 'disconnected',
        tools: [],
        lastError: null
      };
      this.runtimeStates.set(serverName, state);
    }
    state.tools = tools;
    this._scheduleNotification();
  }

  /**
   * 🆕 Update MCP server error
   * @param serverName - Server name
   * @param error - Error message
   */
  private _updateServerError(serverName: string, error: Error | null): void {
    let state = this.runtimeStates.get(serverName);
    if (!state) {
      state = {
        serverName,
        status: 'disconnected',
        tools: [],
        lastError: null
      };
      this.runtimeStates.set(serverName, state);
    }
    state.lastError = error;
    this._scheduleNotification();
  }

  private _resolveStatusForError(error: Error): MCPServerStatus {
    return 'error';
  }

  /**
   * 🆕 Clear MCP server runtime state
   * 🆕 Refactored: Changed from private to public to allow profileCacheManager to call
   * @param serverName - Server name
   */
  _clearServerRuntimeState(serverName: string): void {
    this.runtimeStates.delete(serverName);
    this._scheduleNotification();
  }

  /**
   * 🆕 Get all MCP server runtime states
   * @returns Runtime state array
   */
  getAllMcpServerRuntimeStates(): MCPServerRuntimeState[] {
    return Array.from(this.runtimeStates.values());
  }

  /** Currently-bound profile id, or null before initialize(). */
  getCurrentProfileId(): string | null {
    return this.currentProfileId;
  }

  /**
   * Resolve the persist `Mcp` of the active profile. Bootstrap has already loaded
   * `mcp.items`, so this is just a typed accessor — no extra I/O.
   */
  private async mcp(): Promise<Mcp> {
    const profile = await Profiles.get().active();
    return profile.mcp;
  }

  /** {config, runtime} shaped like the old profileCacheManager.getMcpServerInfo. */
  private async getServerInfo(serverName: string): Promise<{
    config: McpServerConfig | null;
    runtime: MCPServerRuntimeState | null;
  }> {
    const mcp = await this.mcp();
    const config = mcp.get(serverName) ?? null;
    const runtime = this.runtimeStates.get(serverName) ?? null;
    return { config, runtime };
  }

  /** Merge-update a server config (mirrors profileCacheManager.updateMcpServerConfig). */
  private async updateServerConfig(serverName: string, patch: Partial<McpServerConfig>): Promise<boolean> {
    const mcp = await this.mcp();
    const existing = mcp.get(serverName);
    if (!existing) return false;
    await mcp.upsert({ ...existing, ...patch, name: serverName });
    return true;
  }

  /**
   * 🆕 Get a single MCP server runtime state
   * @param serverName - Server name
   * @returns Runtime state or undefined
   */
  getMcpServerRuntimeState(serverName: string): MCPServerRuntimeState | undefined {
    return this.runtimeStates.get(serverName);
  }

  /**
   * 🆕 Schedule frontend notification (with debounce)
   */
  private _scheduleNotification(): void {
    this.pendingNotification = true;

    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout);
    }

    this.notificationTimeout = setTimeout(() => {
      if (this.pendingNotification) {
        this._notifyFrontend();
        this.pendingNotification = false;
      }
      this.notificationTimeout = null;
    }, 50); // 50ms debounce, fast response
  }

  /**
   * 🆕 Immediately notify frontend
   */
  private _notifyFrontend(): void {
    const states = this.getAllMcpServerRuntimeStates();

    // Serialize error objects for IPC transport
    const serializedStates = states.map(state => ({
      serverName: state.serverName,
      status: state.status,
      tools: state.tools,
      lastError: state.lastError ? state.lastError.message : null
    }));

    // Notify all renderer process windows
    eachWebContent((wc) => {
      mcpMainToRender.bindWebContents(wc).serverStatesUpdated(serializedStates);
    });
  }

  /**
   * Get singleton instance
   */
  static getInstance(): MCPClientManager {
    if (!MCPClientManager.instance) {
      MCPClientManager.instance = new MCPClientManager();
    }
    return MCPClientManager.instance;
  }

  /**
   * Initialize manager with user alias
   * 🔧 Core improvement: Ensures runtime state is fully synced with ProfileCacheManager baseline data
   *
   * @param profileId - User alias
   */
  private initialized = false;
  async initialize(profileId: string): Promise<void> {
    this.currentProfileId = profileId;
    if (this.initialized) return;
    this.initialized = true;

    try {
      // 🔧 Step 1: Clear existing runtime state, ensure starting from a clean state
      await this._syncWithProfileCacheManagerBaseline(profileId);


      // Step 2: Get ProfileCacheManager baseline configuration
      // 🆕 Use dynamic import to avoid circular dependency
      const serverInfos = (await this.mcp()).items.map((config) => ({ config }));

      // Step 3: Start connections based on baseline data
      let inUseCount = 0;
      for (const serverInfo of serverInfos) {
        if (serverInfo.config.in_use) {
          this._startConnectionAsync(serverInfo.config.name);
          inUseCount++;
        }
      }

    } catch (error) {
      throw error;
    }
  }

  /**
   * 🔧 Refactored: Sync with ProfileCacheManager baseline configuration
   * Clean up clients and runtime states not in the baseline configuration
   */
  private async _syncWithProfileCacheManagerBaseline(profileId: string): Promise<void> {
    const syncStart = Date.now();
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;


    try {
      // Phase 1: Get current runtime state
      const currentRuntimeClients = Array.from(this.mcpClients.keys());
      const currentRuntimeStates = this.getAllMcpServerRuntimeStates();
      // 🆕 Use dynamic import to avoid circular dependency
      const baselineConfigs = (await this.mcp()).items.map((config) => ({ config }));


      // Phase 2: Identify "ghost" runtime states not in baseline configuration
      // 🆕 Built-in server is not in baseline config but is not a ghost server
      const baselineServerNames = new Set(baselineConfigs.map(info => info.config.name));
      const ghostRuntimeClients = currentRuntimeClients.filter(name => !baselineServerNames.has(name));
      const ghostRuntimeStates = currentRuntimeStates.filter(state => !baselineServerNames.has(state.serverName));


      // Phase 3: Clean up "ghost" runtime clients
      if (ghostRuntimeClients.length > 0) {

        for (const ghostClientName of ghostRuntimeClients) {
          try {
            const ghostClient = this.mcpClients.get(ghostClientName);
            if (ghostClient) {
              await ghostClient.cleanup();
              this.mcpClients.delete(ghostClientName);
            }
          } catch (error) {
          }
        }
      }

      // Phase 4: Clean up "ghost" runtime states (using internal methods)
      if (ghostRuntimeStates.length > 0) {

        for (const ghostState of ghostRuntimeStates) {
          try {
            this._clearServerRuntimeState(ghostState.serverName);
          } catch (error) {
          }
        }
      }

      // Phase 5: Verify sync results
      const finalRuntimeClients = Array.from(this.mcpClients.keys());
      const finalRuntimeStates = this.getAllMcpServerRuntimeStates();

      const syncDuration = Date.now() - syncStart;

      // Ensure runtime state is fully consistent with baseline data
      const isFullySynced = finalRuntimeStates.every(state => baselineServerNames.has(state.serverName));
      if (isFullySynced) {
      } else {
      }

    } catch (error) {
      const syncDuration = Date.now() - syncStart;
      throw error;
    }
  }

  /**
   * Connect to specified MCP server
   *
   * Preconditions: Server must exist in configuration and have status 'disconnected'
   *
   * @param serverName - Server name
   */
  async connect(serverName: string): Promise<void> {

    if (!this.currentProfileId) {
      const error = 'Manager not initialized with profile id'
      throw new Error(error);
    }


    // Remove all status validation - handled by ProfileCacheManager
    await this._executeWithLock(serverName, 'connect', async () => {
      await this._performConnect(serverName);
    });
  }

  /**
   * Disconnect specified MCP server connection
   *
   * Preconditions: Server must exist in configuration and have status 'connected', 'connecting', or 'error'
   *
   * @param serverName - Server name
   */
  async disconnect(serverName: string): Promise<void> {

    if (!this.currentProfileId) {
      const error = 'Manager not initialized with profile id'
      throw new Error(error);
    }


    // Remove all status validation - handled by ProfileCacheManager
    await this._executeWithLock(serverName, 'disconnect', async () => {
      await this._performDisconnect(serverName);
    });
  }

  /**
   * Reconnect specified MCP server
   *
   * Preconditions: Server must exist in configuration and have status 'error'
   *
   * @param serverName - Server name
   */
  async reconnect(serverName: string): Promise<void> {

    if (!this.currentProfileId) {
      const error = 'Manager not initialized with profile id'
      throw new Error(error);
    }


    // Remove all status validation - handled by ProfileCacheManager
    await this._executeWithLock(serverName, 'reconnect', async () => {
      await this._performReconnect(serverName);
    });
  }

  /**
   * Get client by server name
   *
   * @param serverName - Server name
   */
  getClientByServerName(serverName: string): IUnifiedMcpClient | undefined {
    return this.mcpClients.get(serverName);
  }


  /**
   * Get client implementation type by server name
   *
   * @param serverName - Server name
   */
  getClientImplementation(serverName: string): ClientImplementation | undefined {
    return this.clientImplementations.get(serverName);
  }

  /**
   * Set default client implementation
   * Note: Actual implementation depends on transport type in hybrid mode
   *
   * @param implementation - Client implementation type (used as fallback)
   */
  setDefaultImplementation(implementation: ClientImplementation): void {
    this.defaultImplementation = implementation;
  }

  /**
   * Get current default implementation
   * Note: Actual implementation depends on transport type in hybrid mode
   */
  getDefaultImplementation(): ClientImplementation {
    return this.defaultImplementation;
  }

  /**
   * Get all available tools
   * 🆕 Refactored: Get from internal runtimeStates, no longer through profileCacheManager
   */
  async getAllTools(): Promise<{ name: string; description?: string; inputSchema: any; serverName: string; annotations?: any }[]> {
    const allTools: { name: string; description?: string; inputSchema: any; serverName: string; annotations?: any }[] = [];

    if (!this.currentProfileId) {
      return allTools;
    }

    // 🆕 Get from internal runtimeStates
    const runtimeStates = this.getAllMcpServerRuntimeStates();

    for (const runtimeState of runtimeStates) {
      if (runtimeState.status === 'connected') {
        for (const tool of runtimeState.tools) {
          allTools.push({
            ...tool,
            serverName: runtimeState.serverName
          });
        }
      }
    }

    return allTools;
  }


  /**
   * Server-scoped tool execution. Caller MUST supply the serverName resolved
   * from a ToolCatalog route — never look up by bare toolName again (see
   * task.md §1: same-named tools across MCP servers silently overwrote each
   * other in the legacy `toolToServerMap` path).
   */
  async executeToolOnServer(
    { serverName, toolName, toolArgs, signal }:
    { serverName: string; toolName: string; toolArgs: { [key: string]: unknown }; signal?: AbortSignal },
  ): Promise<string> {
    const client = this.mcpClients.get(serverName);
    if (!client) {
      throw new Error(`MCP server not connected: "${serverName}" (tool: ${toolName})`);
    }
    return client.executeTool({ toolName, toolArgs, signal });
  }

  /**
   * Add new MCP server
   * 🆕 Refactored: Config saved immediately, connection runs asynchronously in background, non-blocking UI
   *
   * @param serverName - Server name
   * @param newConfig - New server configuration
   */
  async add(serverName: string, newConfig: McpServerConfig): Promise<void> {

    if (!this.currentProfileId) {
      throw new Error('Manager not initialized with profile id');
    }


    // Validate input
    if (!serverName || !newConfig) {
      throw new Error('Server name and configuration are required');
    }

    if (newConfig.name !== serverName) {
      throw new Error('Server name must match configuration name');
    }

    // 🆕 Use dynamic import to avoid circular dependency

    // Check if server already exists
    const existingServerInfo = await this.getServerInfo(serverName);
    if (existingServerInfo.config) {
      throw new Error(`Server "${serverName}" already exists`);
    }

    // Set initial config with status=disconnected, in_use=true
    const configToAdd: McpServerConfig = {
      ...newConfig,
      in_use: true
    };

    // Add config to persist
    await (await this.mcp()).upsert(configToAdd);

    // 🆕 Refactored: Use internal methods to initialize runtime state as connecting
    this._updateServerStatus(serverName, 'connecting');
    this._updateServerTools(serverName, []);
    this._updateServerError(serverName, null);

    // 🆕 Config saved, return immediately to frontend; connection runs asynchronously in background
    // Use setImmediate to ensure execution after current event loop completes
    setImmediate(() => {
      this._performConnect(serverName).catch(error => {
        // Error already handled inside _performConnect and state updated
        advancedLogger?.error({ msg: '[MCPClientManager] Background connect failed for add', mod: 'add', serverName, err: error });
      });
    });
  }

  /**
   * Update existing MCP server configuration
   * 🆕 Refactored: Config saved immediately, reconnection runs asynchronously in background, non-blocking UI
   *
   * @param serverName - Server name
   * @param newConfig - Updated server configuration
   */
  async update(serverName: string, newConfig: McpServerConfig): Promise<void> {

    if (!this.currentProfileId) {
      throw new Error('Manager not initialized with profile id');
    }


    // Validate input
    if (!serverName || !newConfig) {
      throw new Error('Server name and configuration are required');
    }

    if (newConfig.name !== serverName) {
      throw new Error('Server name must match configuration name');
    }

    // 🆕 Use dynamic import to avoid circular dependency

    // Check if server exists
    const existingServerInfo = await this.getServerInfo(serverName);
    if (!existingServerInfo.config) {
      throw new Error(`Server "${serverName}" not found`);
    }

    // 🆕 Get current status for background async processing
    const currentStatus = existingServerInfo.runtime?.status || 'disconnected';

    // Update config with status=disconnected, in_use=true
    const configToUpdate: Partial<McpServerConfig> = {
      ...newConfig,
      in_use: true
    };

    // Update config in persist (merge-style upsert)
    const success = await this.updateServerConfig(serverName, configToUpdate);
    if (!success) {
      throw new Error(`Failed to update server configuration for "${serverName}"`);
    }

    // 🆕 Refactored: Use internal methods to update runtime state to connecting
    this._updateServerStatus(serverName, 'connecting');
    this._updateServerTools(serverName, []);
    this._updateServerError(serverName, null);

    // 🆕 Config saved, return immediately to frontend; background async disconnect + reconnect
    // Use setImmediate to ensure execution after current event loop completes
    setImmediate(async () => {
      try {
        // If server was connected, disconnect first
        if (currentStatus !== 'disconnected') {
          await this._performDisconnect(serverName);
        }

        // Connect to the server with new config
        await this._performConnect(serverName);
      } catch (error) {
        // Error already handled inside _performConnect/_performDisconnect and state updated
        advancedLogger?.error({ msg: '[MCPClientManager] Background update failed', mod: 'update', serverName, err: error });
      }
    });
  }

  /**
   * Delete MCP server
   *
   * @param serverName - Server name
   */
  async delete(serverName: string): Promise<void> {

    if (!this.currentProfileId) {
      throw new Error('Manager not initialized with profile id');
    }


    // Validate input
    if (!serverName) {
      throw new Error('Server name is required');
    }

    // 🆕 Use dynamic import to avoid circular dependency

    // Check if server exists
    const existingServerInfo = await this.getServerInfo(serverName);
    if (!existingServerInfo.config) {
      throw new Error(`Server "${serverName}" not found`);
    }

    // Snapshot cfg before any mutation: the OAuth slot key depends on
    // url/headers/oauth.* fields which are gone once the config is deleted.
    const cfgSnapshot = existingServerInfo.config;
    let configDeleted = false;

    try {
      // If server is connected, disconnect first
      const currentStatus = existingServerInfo.runtime?.status || 'disconnected';
      if (currentStatus !== 'disconnected') {
        await this.disconnect(serverName);
      }

      // Delete config from persist
      await (await this.mcp()).remove(serverName);
      configDeleted = true;

      // 🆕 Refactored: Use internal methods to clear runtime state
      this._clearServerRuntimeState(serverName);

    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to delete MCP server');
      throw err;
    } finally {
      // Wipe persisted OAuth credentials so re-adding the same server
      // later starts a clean flow. Runs in finally so a sync throw
      // between `deleteMcpServerConfig` and any later step doesn't leave
      // an orphan slot. Skip on stdio (no remote auth) and skip if the
      // config wasn't actually deleted (user can retry).
      if (configDeleted && cfgSnapshot && cfgSnapshot.transport !== 'stdio') {
        try {
          await McpAuthService.getInstance().clearOAuthForServer(serverName, cfgSnapshot, 'all');
        } catch (e) {
          advancedLogger?.warn({ msg: `[MCPClientManager] Failed to clear OAuth credentials for "${serverName}" during delete: ${e instanceof Error ? e.message : String(e)}`, mod: 'delete', serverName });
        }
      }
    }
  }

  /**
   * Clean up all resources with enhanced child process management
   */
  async cleanup(): Promise<void> {
    const cleanupStart = Date.now();
    const cleanupId = `cleanup_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;


    // Phase 1: Inventory current resources
    const resourceInventory = {
      mcpClientCount: this.mcpClients.size,
      clientNames: Array.from(this.mcpClients.keys()),
      operationLockCount: this.operationLocks.size,
      currentUser: this.currentProfileId,
      instanceId: this.instanceId
    };


    if (resourceInventory.mcpClientCount === 0) {
    } else {
      // Phase 2: Cleanup individual MCP clients with timeout and force termination

      const cleanupPromises = Array.from(this.mcpClients.entries()).map(async ([serverName, client], index) => {
        const clientCleanupStart = Date.now();
        try {

          // Set timeout for individual client cleanup to prevent hanging
          await Promise.race([
            client.cleanup(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Client cleanup timeout')), 10000) // 10 second timeout
            )
          ]);

          const clientCleanupDuration = Date.now() - clientCleanupStart;

          return { serverName, success: true, duration: clientCleanupDuration, error: null };
        } catch (error) {
          const clientCleanupDuration = Date.now() - clientCleanupStart;
          const errorMessage = error instanceof Error ? error.message : String(error);

          if (errorMessage.includes('timeout')) {
          } else {
          }
          return { serverName, success: false, duration: clientCleanupDuration, error: errorMessage };
        }
      });

      // Set overall timeout for all client cleanups
      try {
        await Promise.race([
          Promise.allSettled(cleanupPromises),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Overall cleanup timeout')), 15000) // 15 second overall timeout
          )
        ]);
      } catch (overallTimeoutError) {
      }

      const cleanupResults = await Promise.allSettled(cleanupPromises);

      // Analyze cleanup results
      const successfulCleanups = cleanupResults.filter(result =>
        result.status === 'fulfilled' && result.value.success
      ).length;
      const failedCleanups = cleanupResults.length - successfulCleanups;
      const timeoutCleanups = cleanupResults.filter(result =>
        result.status === 'fulfilled' && result.value.error?.includes('timeout')
      ).length;
      const totalClientCleanupTime = cleanupResults
        .filter(result => result.status === 'fulfilled')
        .reduce((sum, result) => sum + (result.value as any).duration, 0);


      if (failedCleanups > 0 || timeoutCleanups > 0) {
      }

      // Phase 2.5: Additional system-level child process cleanup if there were timeouts
      if (timeoutCleanups > 0) {
        await this.performSystemLevelCleanup(cleanupId);
      }
    }

    // Phase 3: Clear all internal data structures

    const structureClearStart = Date.now();

    // Clear maps and references
    const previousMcpClientSize = this.mcpClients.size;
    const previousOperationLockSize = this.operationLocks.size;
    const previousUserAlias = this.currentProfileId;

    this.mcpClients.clear();
    this.operationLocks.clear();
    this.runtimeStates.clear();  // 🆕 Clear runtime state
    this.currentProfileId = null;

    // 🆕 Clean up notification timer
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout);
      this.notificationTimeout = null;
    }
    this.pendingNotification = false;

    const structureClearDuration = Date.now() - structureClearStart;


    // Phase 4: Final verification

    const verificationPassed =
      this.mcpClients.size === 0 &&
      this.operationLocks.size === 0 &&
      this.currentProfileId === null;

    if (verificationPassed) {
    } else {
    }

    // Phase 5: Summary
    const totalCleanupDuration = Date.now() - cleanupStart;
  }

  /**
   * Perform system-level child process cleanup when timeouts occur
   */
  private async performSystemLevelCleanup(cleanupId: string): Promise<void> {
    try {

      // On macOS/Linux, try to find and kill any hanging npm/uvx/python processes that might be children of this app
      if (process.platform !== 'win32') {
        const appPid = process.pid;

        try {
          // Find child processes of the current app that might be hanging
          const psCommand = `ps -eo pid,ppid,comm | grep -E "(npm|uvx|python|pip|uv)" | grep -v grep`;
          const psResult = execSync(psCommand, { encoding: 'utf8', timeout: 5000 });

          if (psResult.trim()) {

            // Parse and kill processes that are children of our app
            const lines = psResult.trim().split('\n');
            for (const line of lines) {
              const [pid, ppid, comm] = line.trim().split(/\s+/);
              if (ppid && parseInt(ppid) === appPid) {
                try {
                  process.kill(parseInt(pid), 'SIGTERM');

                  // Wait a bit, then force kill if still running
                  setTimeout(() => {
                    try {
                      process.kill(parseInt(pid), 'SIGKILL');
                    } catch (error) {
                      // Process probably already dead, ignore
                    }
                  }, 2000);
                } catch (error) {
                }
              }
            }
          } else {
          }
        } catch (error) {
        }
      } else {
      }
    } catch (error) {
    }
  }


  /**
   * Reset instance for user sign-out - clear all user data and connections
   */
  async resetForSignOut(): Promise<void> {
    const resetStart = Date.now();
    const resetId = `reset_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;


    // Phase 1: Gather current state for logging
    const initialState = {
      instanceId: this.instanceId,
      currentUser: this.currentProfileId,
      mcpClientCount: this.mcpClients.size,
      operationLockCount: this.operationLocks.size,
      clientNames: Array.from(this.mcpClients.keys()),
    };


    // Phase 2: Perform complete cleanup

    const cleanupStart = Date.now();
    try {
      await this.cleanup();
      const cleanupDuration = Date.now() - cleanupStart;
    } catch (cleanupError) {
      const cleanupDuration = Date.now() - cleanupStart;
      // Continue with reset even if cleanup partially failed
    }

    // Phase 3: Verify cleanup completion

    const postCleanupState = {
      mcpClientCount: this.mcpClients.size,
      operationLockCount: this.operationLocks.size,
      currentUserCleared: this.currentProfileId === null
    };


    if (postCleanupState.mcpClientCount > 0) {

      // Force cleanup if needed
      this.mcpClients.clear();
      this.operationLocks.clear();
      this.runtimeStates.clear();  // 🆕 Clear runtime state
      this.currentProfileId = null;

    }

    // Phase 4: Reset singleton instance

    const previousInstance = MCPClientManager.instance;
    MCPClientManager.instance = null;


    // Phase 5: Final summary
    const totalDuration = Date.now() - resetStart;
  }

  // ==================== Private Methods ====================

  /**
   * Start connection asynchronously (don't wait for result)
   * Modified to use _executeWithLock to prevent race conditions with manual connect calls
   */
  private _startConnectionAsync(serverName: string): void {
    this._executeWithLock(serverName, 'connect', async () => {
      await this._performConnect(serverName);
    }).catch(error => {
      // Ignore "currently connecting" errors as that's the desired behavior (deduplication)
      if (error.message && error.message.includes('is currently connecting')) {
        return;
      }
      advancedLogger.error({ msg: `Failed to auto-connect server "${serverName}": ${error.message}` });
    });
  }

  /**
   * Execute operation with lock
   */
  private async _executeWithLock(
    serverName: string,
    operation: 'connect' | 'disconnect' | 'reconnect',
    action: () => Promise<void>
  ): Promise<void> {
    // Check if operation is already in progress
    const existingLock = this.operationLocks.get(serverName);
    if (existingLock) {
      throw new Error(`Server "${serverName}" is currently ${existingLock.operation}ing, please wait`);
    }

    // Create abort controller for cancellation
    const abortController = new AbortController();

    const lockPromise = action();
    const lock: OperationLock = {
      operation,
      promise: lockPromise,
      timestamp: Date.now(),
      abortController
    };

    this.operationLocks.set(serverName, lock);

    try {
      await lockPromise;
    } finally {
      this.operationLocks.delete(serverName);
    }
  }

  /**
   * Force cancel ongoing connection process for a server
   */
  private async _forceCancelConnection(serverName: string): Promise<void> {
    const cancelId = `cancel_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    try {
      // 1. Cancel operation lock if exists
      const operationLock = this.operationLocks.get(serverName);
      if (operationLock) {
        if (operationLock.abortController) {
          operationLock.abortController.abort();
        }
        this.operationLocks.delete(serverName);
      }

      // 2. Cancel active connection process if exists
      const connectionProcess = this.activeConnections.get(serverName);
      if (connectionProcess) {
        connectionProcess.abortController.abort();

        // Try to cleanup the client
        try {
          await connectionProcess.client.cleanup();
        } catch (error) {
        }

        this.activeConnections.delete(serverName);
      }

      // 3. Remove client and mappings if they exist
      const client = this.mcpClients.get(serverName);
      if (client) {
        try {
          await client.cleanup();
        } catch (error) {
        }

        this.mcpClients.delete(serverName);
        this.clientImplementations.delete(serverName);
      }

    } catch (error) {
      throw error;
    }
  }

  /**
   * Perform connect operation
   */
  private async _performConnect(serverName: string): Promise<void> {
    const connectId = `connect_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    if (!this.currentProfileId) {
      throw new Error('Manager not initialized with profile id');
    }

    // 🆕 Use dynamic import to avoid circular dependency

    // Get server config from persist
    const serverInfo = await this.getServerInfo(serverName);
    if (!serverInfo.config) {
      throw new Error(`Server "${serverName}" not found in configuration`);
    }

    // Convert to McpServerConfig format
    const serverConfig: McpServerConfig = {
      name: serverInfo.config.name,
      transport: serverInfo.config.transport,
      command: serverInfo.config.command,
      args: serverInfo.config.args,
      url: serverInfo.config.url,
      env: serverInfo.config.env,
      in_use: serverInfo.config.in_use,
      version: serverInfo.config.version,
      headers: serverInfo.config.headers,
    };
    // 🆕 Refactored: Use internal methods to update state
    this._updateServerStatus(serverName, 'connecting');

    // Create abort controller for this connection
    const abortController = new AbortController();
    let client: IUnifiedMcpClient | null = null;

    try {
      // Create new client - use hybrid mode based on transport type
      const implementation = this._determineImplementation(serverConfig);
      client = this._createClient(serverConfig, implementation);

      // Track this connection process
      const connectionProcess: ConnectionProcess = {
        serverName,
        abortController,
        client,
        startTime: Date.now()
      };
      this.activeConnections.set(serverName, connectionProcess);


      // Check if connection was cancelled before proceeding
      if (abortController.signal.aborted) {
        return;
      }

      // Attempt connection with cancellation support
      const result = await this._connectWithCancellation(client, abortController.signal);

      if (abortController.signal.aborted) {
        return;
      }

      if (result === 'connected') {
        // Get tools list
        const tools = await client.getTools();

        if (!tools || tools.length === 0) {
          // No tools available - set error state
          const error = new Error('Connection successful but no tools available');
          // 🆕 Refactored: Use internal methods to update runtime state
          this._updateServerError(serverName, error);
          this._updateServerTools(serverName, []); // Clear tools list for error state
          this._updateServerStatus(serverName, 'error');

          // Still update in_use to true (user wants to use this server)
          await this.updateServerConfig(serverName, { in_use: true });

          return; // Don't throw error - connection operation completed, just in error state
        }

        // Success - update runtime state
        this.mcpClients.set(serverName, client);
        this.clientImplementations.set(serverName, implementation);

        // status='connected' 之后,getAllTools() 才会暴露这批新工具给 LLM。

        // 🆕 Refactored: Use internal methods to update runtime state
        this._updateServerTools(serverName, tools);
        this._updateServerError(serverName, null);
        this._updateServerStatus(serverName, 'connected');

        // Update config in_use to true
        await this.updateServerConfig(serverName, { in_use: true });

      } else {
        // Connection failed
        const error = result instanceof Error ? result : new Error('Connection failed');
        // 🆕 Refactored: Use internal methods to update runtime state
        this._updateServerError(serverName, error);
        this._updateServerTools(serverName, []); // Clear tools list for error state
        this._updateServerStatus(serverName, this._resolveStatusForError(error));

        // Still update in_use to true (user wants to use this server)
        await this.updateServerConfig(serverName, { in_use: true });

        return; // Don't throw error - connection operation completed, just in error state
      }
    } catch (error) {
      // Check if this was a cancellation
      if (abortController.signal.aborted) {
        // Don't update status to error for cancelled connections
        // 🆕 Refactored: Use internal methods to update runtime state
        this._updateServerStatus(serverName, 'disconnected');
        return;
      }

      // Exception handling
      const err = error instanceof Error ? error : new Error('Connection failed');
      // 🆕 Refactored: Use internal methods to update runtime state
      this._updateServerError(serverName, err);
      this._updateServerTools(serverName, []); // Clear tools list for error state
      this._updateServerStatus(serverName, this._resolveStatusForError(err));

      // Still update in_use to true
      try {
        await this.updateServerConfig(serverName, { in_use: true });
      } catch (profileError) {
      }

      // Don't throw error - connection operation completed, just in error state
      return; // Explicitly return to prevent any further execution
    } finally {
      // Clean up connection tracking
      this.activeConnections.delete(serverName);

      // If connection failed and client was created, clean it up
      if (client && !this.mcpClients.has(serverName)) {
        try {
          await client.cleanup();
        } catch (cleanupError) {
        }
      }
    }
  }

  /**
   * Connect with cancellation support
   */
  private async _connectWithCancellation(client: IUnifiedMcpClient, abortSignal: AbortSignal): Promise<string | Error> {
    return new Promise((resolve, reject) => {
      // Handle cancellation
      const onAbort = () => {
        reject(new Error('Connection cancelled'));
      };

      if (abortSignal.aborted) {
        reject(new Error('Connection cancelled'));
        return;
      }

      abortSignal.addEventListener('abort', onAbort);

      // Start the connection
      client.connectToServer()
        .then(result => {
          abortSignal.removeEventListener('abort', onAbort);
          resolve(result);
        })
        .catch(error => {
          abortSignal.removeEventListener('abort', onAbort);
          reject(error);
        });
    });
  }

  /**
   * Perform disconnect operation
   */
  private async _performDisconnect(serverName: string): Promise<void> {
    const disconnectId = `disconnect_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    if (!this.currentProfileId) {
      const error = 'Manager not initialized with profile id'
      throw new Error(error);
    }

    let disconnectError: Error | null = null;

    try {
      // Step 1: Force cancel any ongoing connection process first
      await this._forceCancelConnection(serverName);

      // Step 2: 🆕 Refactored: Use internal methods to update state
      this._updateServerStatus(serverName, 'disconnecting');

      // Step 3: Clean up any remaining resources
      const client = this.mcpClients.get(serverName);

      if (client) {

        await client.cleanup();

        this.mcpClients.delete(serverName);
        this.clientImplementations.delete(serverName);

      } else {
      }
    } catch (error) {
      // Log cleanup error but don't fail the disconnect operation
      disconnectError = error instanceof Error ? error : new Error('Cleanup failed during disconnect');
    }

    try {
      // 🆕 Use dynamic import to avoid circular dependency
      // Update config in_use to false
      await this.updateServerConfig(serverName, { in_use: false });
    } catch (error) {
      // Log config update error but don't fail the disconnect operation
      const configError = error instanceof Error ? error : new Error('Config update failed during disconnect');
      if (!disconnectError) {
        disconnectError = configError;
      }
    }

    // Always set final state to disconnected, regardless of cleanup errors
    // The goal of disconnect is to reach disconnected state
    // 🆕 Refactored: Use internal methods to update runtime state
    this._updateServerTools(serverName, []);
    this._updateServerError(serverName, disconnectError);
    this._updateServerStatus(serverName, 'disconnected');

    if (disconnectError) {
    } else {
    }

    // Don't throw error - disconnect operation should always succeed in reaching disconnected state
    // Even if there were cleanup issues, the server is considered disconnected
  }

  /**
   * Perform reconnect operation
   * 🔧 Fix: If no existing client instance, perform a full connect operation to recreate the instance
   */
  private async _performReconnect(serverName: string): Promise<void> {

    if (!this.currentProfileId) {
      throw new Error('Manager not initialized with profile id');
    }

    // Check if client exists
    const client = this.mcpClients.get(serverName);

    if (!client) {
      // 🆕 When no existing client instance, perform full connect to recreate and connect
      // This fixes the issue where reconnect fails in error state due to missing client instance
      await this._performConnect(serverName);
      return;
    }

    // 🔧 When existing client instance exists, attempt reconnect directly
    // 🆕 Refactored: Use internal methods to update state
    this._updateServerStatus(serverName, 'connecting');

    try {
      // Reuse existing client, call connectToServer() to reconnect
      const result = await client.connectToServer();

      if (result === 'connected') {
        // Get tools
        const tools = await client.getTools();

        if (tools && tools.length > 0) {
          // Success
          // 重连成功后,getAllTools() 才会重新暴露工具。

          // 🆕 Refactored: Use internal methods to update runtime state
          this._updateServerTools(serverName, tools);
          this._updateServerError(serverName, null);
          this._updateServerStatus(serverName, 'connected');

        } else {
          // No tools
          const error = new Error('Reconnection successful but no tools returned from server');
          // 🆕 Refactored: Use internal methods to update runtime state
          this._updateServerError(serverName, error);
          this._updateServerStatus(serverName, 'error');
          this._updateServerTools(serverName, []); // Clear tools list for error state

          // Don't throw error - reconnect completed, just in error state
          return;
        }
      } else {
        // Connection failed
        const error = result instanceof Error ? result : new Error('Reconnection failed');
        // 🆕 Refactored: Use internal methods to update runtime state
        this._updateServerError(serverName, error);
        this._updateServerTools(serverName, []); // Clear tools list for error state
        this._updateServerStatus(serverName, this._resolveStatusForError(error));

        // Don't throw error - reconnect completed, just in error state
        return;
      }
    } catch (error) {
      // Exception occurred
      const err = error instanceof Error ? error : new Error('Reconnect failed');
      // 🆕 Refactored: Use internal methods to update runtime state
      this._updateServerError(serverName, err);
      this._updateServerTools(serverName, []); // Clear tools list for error state
      this._updateServerStatus(serverName, this._resolveStatusForError(err));

      // Don't throw error - reconnect completed, just in error state
      return;
    }
  }


  /**
   * Create a client instance.
   * The legacy SDK MCP client is permanently disabled — all transports use
   * the in-tree `McpClient` adapter.
   *
   * @param serverConfig - Server configuration
   * @param implementation - Client implementation type (always forced to 'native')
   */
  private _createClient(serverConfig: McpServerConfig, implementation: ClientImplementation): IUnifiedMcpClient {
    // SDK client is permanently disabled; all cases use the in-tree client
    if (implementation !== 'native') {
    }

    return new McpClient(serverConfig);
  }

  /**
   * Determine the client implementation for a given server. All transports
   * use the in-tree client; the legacy SDK client is permanently disabled.
   *
   * @param serverConfig - Server configuration
   */
  private _determineImplementation(serverConfig: McpServerConfig): ClientImplementation {
    // stdio, sse, streamablehttp all use the in-tree client
    return 'native';
  }

  /**
   * Force a specific client implementation for a server.
   * Only 'native' is allowed; 'sdk' is silently coerced to 'native' since the
   * SDK client is permanently disabled.
   *
   * @param serverName - Server name
   * @param implementation - Client implementation type
   */
  async forceClientImplementation(serverName: string, implementation: ClientImplementation): Promise<void> {
    if (!this.currentProfileId) {
      throw new Error('Manager not initialized with profile id');
    }

    // Resolve current server config (dynamic import avoids circular dependency)
    const serverInfo = await this.getServerInfo(serverName);
    if (!serverInfo.config) {
      throw new Error(`Server "${serverName}" not found`);
    }

    // Only allow 'native'
    if (implementation === 'sdk') {
      implementation = 'native';
    }

    this.clientImplementations.set(serverName, implementation);
  }

  /**
   * Implementation distribution stats. With the SDK client permanently
   * disabled, all entries should be reported under `native`.
   */
  getImplementationStats(): { sdk: number; native: number; total: number } {
    const stats = { sdk: 0, native: 0, total: 0 };

    // Count actual implementations — should all be 'native'
    this.clientImplementations.forEach((implementation) => {
      if (implementation === 'sdk') {
        // Should not happen since 'sdk' is disabled
        stats.sdk++;
      } else if (implementation === 'native') {
        stats.native++;
      }
    });

    stats.total = this.clientImplementations.size;
    return stats;
  }
}

// Export singleton instance
export const mcpClientManager = MCPClientManager.getInstance();