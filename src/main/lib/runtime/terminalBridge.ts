import type { TerminalRuntimeBridge } from '../terminal/runtimeBridge';
import { applyManagedRuntimeDirs } from './internalEnv';
import type { RuntimeManager } from './RuntimeManager';

/**
 * 用 `RuntimeManager` 构造 terminal 所需的 {@link TerminalRuntimeBridge}。
 *
 * 这是 `runtime → terminal` 的合法方向：runtime 作为上层，向下层 terminal
 * 注入自身能力，令 terminal 不再反向 import runtime（见 terminal/runtimeBridge.ts）。
 */
export function createTerminalRuntimeBridge(manager: RuntimeManager): TerminalRuntimeBridge {
  return {
    ensureRuntimeForCommand(command, args) {
      return manager.ensureRuntimeForCommand(command, args);
    },

    applyRuntimeEnv(env) {
      // 路径 B（LLM 干活：shell 工具 / MCP transport）。与路径 A（getEnvWithInternalPath）
      // 共用同一「喂目录变量」实现：managed dir 环境变量 + UV_PYTHON / VIRTUAL_ENV 单一 owner。
      applyManagedRuntimeDirs(env, manager.managedRuntimeDirs());
    },
  };
}
