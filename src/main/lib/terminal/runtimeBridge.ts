/**
 * terminal → runtime 的依赖反转 seam。
 *
 * `terminal` 是下层通用子进程 / 池化设施，本不应知道「运行时（bun/uv/Python）」的
 * 存在。历史上有两处反向耦合让 terminal 直接 import 了 `runtime`：
 *
 *   1. MCP transport 首次 spawn 前的 lazy-install（`McpTransportInstance`）；
 *   2. pinned-python 环境注入 UV_PYTHON / VIRTUAL_ENV（`environment`）。
 *
 * 两者都通过本桥反转：组合根在 boot 时把 `runtime` 侧实现注入进来，terminal 只
 * 依赖此接口，不再 import `runtime`。于是编译期依赖收敛为单向 `runtime → terminal`。
 *
 * 未注入时（bridge 为 null）降级为 no-op —— 与此前「RuntimeManager 尚未初始化就
 * try/catch 忽略」的行为一致：terminal 仍能 spawn，只是不做运行时相关的增强。
 */
export interface TerminalRuntimeBridge {
  /**
   * MCP transport 首次 spawn 前按命令 lazy-install 运行时（JS→bun / Python→uv）。
   * 失败由调用方吞掉，不阻断 spawn。
   */
  ensureRuntimeForCommand(command: string, args: readonly string[]): Promise<void>;

  /**
   * 在子进程环境对象上原地叠加运行时相关变量（UV_PYTHON / VIRTUAL_ENV）。
   */
  applyRuntimeEnv(env: Record<string, string>): void;
}

let bridge: TerminalRuntimeBridge | null = null;

/** 由组合根在 boot 时注入 `runtime` 侧实现。 */
export function setTerminalRuntimeBridge(next: TerminalRuntimeBridge): void {
  bridge = next;
}

/** 取当前注入的桥；未注入返回 null（调用方按 no-op 处理）。 */
export function getTerminalRuntimeBridge(): TerminalRuntimeBridge | null {
  return bridge;
}
