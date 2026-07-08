/**
 * 终端配置校验 —— 纯函数，无状态。
 */

import { TerminalConfig } from './types';

/**
 * 校验终端配置，非法时抛出带说明的 Error。
 */
export function validateConfig(config: TerminalConfig): void {
  if (!config.command || !config.command.trim()) {
    throw new Error('Command is required and cannot be empty');
  }

  if (!config.cwd || !config.cwd.trim()) {
    throw new Error('Working directory (cwd) is required and cannot be empty');
  }

  if (!Array.isArray(config.args)) {
    throw new Error('Args must be an array');
  }

  if (config.timeoutMs !== undefined && (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)) {
    throw new Error('TimeoutMs must be a positive finite number');
  }

  if (config.maxOutputLength !== undefined && (!Number.isFinite(config.maxOutputLength) || config.maxOutputLength <= 0)) {
    throw new Error('MaxOutputLength must be a positive finite number');
  }
}
