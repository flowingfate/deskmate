/**
 * MCP server "update" 内核 —— 自动 patch+1 已安装 server 的字段。
 *
 * 角色:被 `appcmd/builtins/app/mcp/update.ts` 调用。
 *
 * 升级规则: version 自动 patch+1; env / url / command / args 整体替换 ——
 * 给了就用新的,没给就保留(或清空 env)。
 */

import { mcpClientManager } from '@main/lib/mcpRuntime'
import { Profiles } from '@main/persist';
import type { McpServerConfig } from '@shared/types/profileTypes';

export interface UpdateServerArgs {
  mcp_config: {
    name: string;
    transport?: 'stdio' | 'sse' | 'StreamableHttp';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    version?: string;
  };
}

export interface UpdateServerResult {
  success: boolean;
  message: string;
  server_name?: string;
  old_version?: string;
  new_version?: string;
  error?: string;
}

/**
 * Auto-increment patch version。例:"1.0.0" -> "1.0.1"。非标准 semver(段数 ≠ 3)
 * 走兜底:直接追加 ".1"。
 */
function incrementPatchVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3) return `${version}.1`;
  const [major, minor, patch] = parts;
  const patchNum = parseInt(patch, 10);
  if (isNaN(patchNum)) return `${version}.1`;
  return `${major}.${minor}.${patchNum + 1}`;
}

/**
 * 失败统一通过 `{ success: false, ... }` envelope 回流,不抛。`signal` 仅做契约
 * 形状对齐 —— profile 写盘 + 重连没有 abort 中断点。
 */
export async function updateServerInternal(
  args: UpdateServerArgs,
  _opts?: { signal?: AbortSignal },
): Promise<UpdateServerResult> {
  try {
    if (!args.mcp_config || typeof args.mcp_config !== 'object') {
      return {
        success: false,
        message: 'Invalid input: mcp_config is required and must be an object',
        error: 'INVALID_INPUT',
      };
    }

    const config = args.mcp_config;

    if (!config.name || typeof config.name !== 'string' || !config.name.trim()) {
      return {
        success: false,
        message: 'Invalid input: mcp_config.name is required and must be a non-empty string',
        error: 'INVALID_INPUT',
      };
    }

    const serverName = config.name.trim();

    // Check if MCP is installed in the active profile
    const profile = await Profiles.get().active();
    const existingConfig = profile.mcp.get(serverName);
    if (!existingConfig) {
      return {
        success: false,
        message: `MCP server "${serverName}" is not installed. Use "app mcp add" first.`,
        error: 'NOT_INSTALLED',
      };
    }

    const oldVersion = existingConfig.version || '1.0.0';
    const finalVersion = incrementPatchVersion(oldVersion);

    const updatedConfig: McpServerConfig = {
      name: serverName,
      transport: config.transport || existingConfig.transport,
      in_use: existingConfig.in_use,
      command: config.command?.trim() || existingConfig.command,
      args: Array.isArray(config.args) ? config.args : existingConfig.args,
      env: config.env && typeof config.env === 'object' ? config.env : (existingConfig.env || {}),
      url: config.url?.trim() || existingConfig.url,
      version: finalVersion,
    };

    // Re-validate transport-related fields
    if (updatedConfig.transport === 'stdio') {
      if (!updatedConfig.command || !updatedConfig.command.trim()) {
        return {
          success: false,
          message: 'stdio transport requires a command',
          error: 'INVALID_CONFIG',
        };
      }
    }
    if (updatedConfig.transport === 'sse' || updatedConfig.transport === 'StreamableHttp') {
      if (!updatedConfig.url || !updatedConfig.url.trim()) {
        return {
          success: false,
          message: `${updatedConfig.transport} transport requires a url`,
          error: 'INVALID_CONFIG',
        };
      }
    }

    await mcpClientManager.update(serverName, updatedConfig);

    return {
      success: true,
      message: `Successfully updated MCP server "${serverName}". Version: ${oldVersion} -> ${finalVersion}. The server is now reconnecting...`,
      server_name: serverName,
      old_version: oldVersion,
      new_version: finalVersion,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error updating MCP server: ${error instanceof Error ? error.message : String(error)}`,
      error: 'EXECUTION_ERROR',
    };
  }
}
