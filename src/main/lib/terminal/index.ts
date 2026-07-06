/**
 * 统一终端实例管理器 —— 模块导出。
 *
 * 只导出外部真正消费的主入口。实例类（`CommandInstance` / `McpTransportInstance`）
 * 与平台/命令构建等纯函数是内部实现，模块内走相对路径引用，不从此 barrel 暴露。
 * 主入口是模块级 const 单例 `terminalManager`（构造零成本，加载即建）；`TerminalManager`
 * 类仅供测试 `new` 出隔离实例。仅 `BaseTerminalInstance` 作为「终端实例」的公共类型出口。
 */

export { TerminalManager, terminalManager } from './TerminalManager';
export type { BaseTerminalInstance } from './BaseTerminalInstance';
export type { CommandInstance } from './CommandInstance';
export type { McpTransportInstance } from './McpTransportInstance';
