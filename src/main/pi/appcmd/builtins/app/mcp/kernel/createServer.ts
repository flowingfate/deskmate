/**
 * MCP server "add" 内核 —— 写 profile + 开始建立连接。
 *
 * 角色:被 `appcmd/builtins/app/mcp/install.ts`(library 装)与 `add.ts`(custom)
 * 调用,业务逻辑的真家。
 *
 * 注意:renderer 端的 MCP CRUD 走 `mcpApi.addServer` IPC 直通
 * `mcpClientManager.add`,**不**消费本函数 —— 本函数只服务 `app mcp ...`
 * CLI 路径。
 *
 * 与 `mcpClientManager.add` 的边界:本函数只做"参数校验 + 字段补全 + 调
 * mcpClientManager.add",**不**做 connect / status 查询;运行时状态由
 * mcpClientManager 自己异步推进。
 */

import { mcpClientManager } from '@main/lib/mcpRuntime'
import type { McpServerConfig } from '@shared/persist/types'

export interface CreateServerArgs {
  mcp_config: {
    /** MCP server name */
    name: string;
    /** Transport type: 'stdio', 'sse', or 'StreamableHttp' */
    transport: 'stdio' | 'sse' | 'StreamableHttp';
    /** Command (for stdio transport) */
    command?: string;
    /** Command-line arguments */
    args?: string[];
    /** Environment variables */
    env?: Record<string, string>;
    /** Server URL (for sse/http transport) */
    url?: string;
    /** MCP server version (optional, defaults to 1.0.0) */
    version?: string;
  };
}

export interface CreateServerResult {
  success: boolean;
  message: string;
  server_name?: string;
  error?: string;
}

/**
 * 校验 + 落盘 + 触发连接。失败统一通过 `{ success: false, ... }` envelope 回流,
 * 不抛 —— caller(appcmd 或 ipc wrapper)按 success 字段分支处理。
 *
 * `signal` 仅做契约形状对齐,该路径下没有可取消的底层 I/O(mcpClientManager.add
 * 内部同步写盘 + 异步触发连接,后者不挂在 signal 上)。
 */
export async function createServerInternal(
  args: CreateServerArgs,
  _opts?: { signal?: AbortSignal },
): Promise<CreateServerResult> {
  try {
    // Validate input arguments
    if (!args.mcp_config || typeof args.mcp_config !== 'object') {
      return {
        success: false,
        message: 'Invalid input: mcp_config is required and must be an object',
        error: 'INVALID_INPUT',
      };
    }

    const config = args.mcp_config;

    // Validate required fields
    if (!config.name || typeof config.name !== 'string' || !config.name.trim()) {
      return {
        success: false,
        message: 'Invalid input: mcp_config.name is required and must be a non-empty string',
        error: 'INVALID_INPUT',
      };
    }

    if (!config.transport || !['stdio', 'sse', 'StreamableHttp'].includes(config.transport)) {
      return {
        success: false,
        message: 'Invalid input: mcp_config.transport must be one of: stdio, sse, StreamableHttp',
        error: 'INVALID_INPUT',
      };
    }

    // Validate required fields for stdio transport
    if (config.transport === 'stdio') {
      if (!config.command || typeof config.command !== 'string' || !config.command.trim()) {
        return {
          success: false,
          message: 'Invalid input: mcp_config.command is required for stdio transport',
          error: 'INVALID_INPUT',
        };
      }
    }

    // Validate required fields for sse/http transport
    if (config.transport === 'sse' || config.transport === 'StreamableHttp') {
      if (!config.url || typeof config.url !== 'string' || !config.url.trim()) {
        return {
          success: false,
          message: `Invalid input: mcp_config.url is required for ${config.transport} transport`,
          error: 'INVALID_INPUT',
        };
      }
    }
    // Build the complete McpServerConfig
    const finalVersion = config.version || '1.0.0';
    const mcpConfig: McpServerConfig = {
      name: config.name.trim(),
      transport: config.transport,
      in_use: true, // enabled by default
      command: config.command?.trim() || '',
      args: Array.isArray(config.args) ? config.args : [],
      env: config.env && typeof config.env === 'object' ? config.env : {},
      url: config.url?.trim() || '',
      version: finalVersion,
    };

    // mcpClientManager 内部会更新 ProfileCacheManager + 启动连接
    await mcpClientManager.add(mcpConfig.name, mcpConfig);

    return {
      success: true,
      message: `Successfully added MCP server "${mcpConfig.name}". The server is now connecting...`,
      server_name: mcpConfig.name,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error adding MCP server: ${error instanceof Error ? error.message : String(error)}`,
      error: 'EXECUTION_ERROR',
    };
  }
}
