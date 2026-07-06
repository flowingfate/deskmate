/**
 * 终端模块内部的短 ID 生成器。
 *
 * 形如 `terminal_1699999999999_a1b2c3`，用于实例 / 管理器 / 命令执行的追踪标识。
 * 仅用于日志关联与池内寻址，不要求全局唯一或密码学随机。
 */
export function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
