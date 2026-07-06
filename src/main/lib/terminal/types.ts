/**
 * Unified Terminal Instance Manager — type definitions.
 * Supports cross-platform terminal management on Windows and macOS.
 */

export type TerminalInstanceType = 'command' | 'mcp_transport';
export type TerminalState = 'idle' | 'running' | 'stopping' | 'stopped' | 'error';
export type ShellType = 'powershell' | 'cmd' | 'bash' | 'sh' | 'zsh';

/**
 * 终端配置的公共字段（不含判别字段 `type`）。
 *
 * 三个消费者入口（`run` / `createCommand` / `createTransport`）都以此为参数类型：
 * `type` 由入口按用途锁死，调用方不传；`persistent` 对 `createCommand` 有意义（后台长驻
 * 与否由调用方决定），`run` / `createTransport` 则由入口强制覆盖（分别为 false / true）。
 */
export interface TerminalConfigBase {
  // Base configuration
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | null | undefined>;

  // Shell configuration
  shell?: ShellType;

  // Timeout setting
  timeoutMs?: number;

  // Output limit
  maxOutputLength?: number;

  // Environment file
  envFile?: string;

  // Whether this is a long-running process (e.g. an MCP server)
  persistent?: boolean;

  // Instance identifier (for reuse)
  instanceId?: string;
}

/**
 * 完整终端实例配置 = 公共字段 + 判别字段 `type`（选 `CommandInstance` / `McpTransportInstance`）。
 */
export interface TerminalConfig extends TerminalConfigBase {
  // Execution type
  type: TerminalInstanceType;
}

/**
 * Terminal execution result.
 */
export interface TerminalResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  truncated?: boolean;
}

/**
 * Terminal instance status information.
 */
export interface TerminalInstanceInfo {
  id: string;
  type: TerminalInstanceType;
  state: TerminalState;
  config: TerminalConfig;
  pid?: number;
  startTime: number;
  lastActivity: number;
  error?: string;
}

/**
 * Shell profile.
 */
export interface ShellProfile {
  command: string;
  args: string[];
  supportsPersistent: boolean;
}

/**
 * Platform-specific configuration.
 */
export interface PlatformConfig {
  shells: Record<ShellType, ShellProfile>;
  defaultShell: ShellType;
  pathSeparator: string;
  executableExtensions: string[];
}