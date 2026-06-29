/**
 * MCP server status 内核 + `McpStatus` 类型。
 *
 * 角色:被 `appcmd/builtins/app/mcp/status.ts` 调用 + `appcmd/builtins/app/mcp/_shared.ts`
 * 通过 `import type { McpStatus }` 引用做枚举映射。
 *
 * 返回七态枚举之一(`McpStatus`):NotAdded / Disconnected / Connected /
 * Error / Disconnecting / Connecting / NeedsUserInteraction。
 */

import { mcpClientManager } from '@main/lib/mcpRuntime/mcpClientManager';
import { Profiles } from '@main/persist';

/** MCP server status type。 */
export type McpStatus =
  | 'NotAdded'
  | 'Disconnected'
  | 'Connected'
  | 'Error'
  | 'Disconnecting'
  | 'Connecting'
  | 'NeedsUserInteraction';

export interface GetStatusArgs {
  /** MCP server name */
  mcp_name: string;
}

export interface GetStatusResult {
  success: boolean;
  mcp_name: string;
  status: McpStatus;
  message: string;
  details?: {
    in_use?: boolean;
    tools_count?: number;
    error_message?: string;
    transport?: string;
  };
}

/**
 * 失败统一通过 `{ success: false, ... }` envelope 回流,不抛。`signal` 仅做契约
 * 形状对齐 —— 该路径下是同步快路径,内部没有可取消的 I/O。
 */
export async function getStatusInternal(
  args: GetStatusArgs,
  _opts?: { signal?: AbortSignal },
): Promise<GetStatusResult> {
  try {
    if (!args.mcp_name || typeof args.mcp_name !== 'string' || !args.mcp_name.trim()) {
      return {
        success: false,
        mcp_name: args.mcp_name || '',
        status: 'NotAdded',
        message: 'Invalid input: mcp_name is required and must be a non-empty string',
      };
    }

    const mcpName = args.mcp_name.trim();

    let serverInfo;
    try {
      let profile;
      try {
        profile = Profiles.get().activeSync();
      } catch {
        return {
          success: false,
          mcp_name: mcpName,
          status: 'NotAdded',
          message: 'No active user session found. Please sign in first.',
        };
      }
      serverInfo = {
        config: profile.mcp.get(mcpName) ?? null,
        runtime: mcpClientManager.getMcpServerRuntimeState(mcpName) ?? null,
      };
    } catch (error) {
      return {
        success: false,
        mcp_name: mcpName,
        status: 'NotAdded',
        message: `Error accessing MCP server information: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (!serverInfo.config) {
      return {
        success: true,
        mcp_name: mcpName,
        status: 'NotAdded',
        message: `MCP server "${mcpName}" is not added to the configuration.`,
      };
    }

    const runtimeState = serverInfo.runtime;

    if (!runtimeState) {
      return {
        success: true,
        mcp_name: mcpName,
        status: 'Disconnected',
        message: `MCP server "${mcpName}" is configured but not connected.`,
        details: {
          in_use: serverInfo.config.in_use,
          transport: serverInfo.config.transport,
        },
      };
    }

    let status: McpStatus;
    let message: string;
    const details: GetStatusResult['details'] = {
      in_use: serverInfo.config.in_use,
      tools_count: runtimeState.tools?.length || 0,
      transport: serverInfo.config.transport,
    };

    switch (runtimeState.status) {
      case 'connected':
        status = 'Connected';
        message = `MCP server "${mcpName}" is connected and running with ${details.tools_count} tools available.`;
        break;
      case 'connecting':
        status = 'Connecting';
        message = `MCP server "${mcpName}" is currently connecting...`;
        break;
      case 'disconnecting':
        status = 'Disconnecting';
        message = `MCP server "${mcpName}" is currently disconnecting...`;
        break;
      case 'disconnected':
        status = 'Disconnected';
        message = `MCP server "${mcpName}" is disconnected.`;
        break;
      case 'error':
        status = 'Error';
        message = `MCP server "${mcpName}" encountered an error.`;
        if (runtimeState.lastError) {
          details.error_message = runtimeState.lastError.message || String(runtimeState.lastError);
        }
        break;
      case 'needs-user-interaction':
        status = 'NeedsUserInteraction';
        message = `MCP server "${mcpName}" is waiting for user interaction before it can connect.`;
        if (runtimeState.lastError) {
          details.error_message = runtimeState.lastError.message || String(runtimeState.lastError);
        }
        break;
      default:
        status = 'Disconnected';
        message = `MCP server "${mcpName}" has unknown status: ${runtimeState.status}`;
    }

    return {
      success: true,
      mcp_name: mcpName,
      status,
      message,
      details,
    };
  } catch (error) {
    return {
      success: false,
      mcp_name: args.mcp_name || '',
      status: 'Error',
      message: `Error checking MCP server status: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
