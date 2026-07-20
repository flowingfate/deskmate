/**
 * 本地工具中央注册表。模块级单例 `tools` 在启动时(通过 `pi/tools/index.ts`
 * 的静态 import 副作用)把全部本地工具填进来。
 *
 * 不再做单例 getInstance + reset 的 testing 仪式 —— 单元测试如需隔离,自起
 * `new ToolsRegistry()` 即可。模块级 `tools` 是生产唯一入口。
 *
 * **不变量**:
 * - `register` 重名一律抛错。本地工具命名空间是全局的(由 prompt 与下游
 *   后处理依赖原名),静默覆盖会让一个工具悄悄换实现 —— 比"两个 mcp server
 *   暴露同名工具"问题严重得多。
 * - `execute` 在 handler 抛错时收敛为 `{ ok: false }`,不重新抛 —— turn loop
 *   上游按 string content + isError 处理,需要稳定的 envelope 形态。
 */

import type { Tool as PiTool } from '@earendil-works/pi-ai';

import type { LocalTool, ToolContext, ToolResult } from './types';

/**
 * 执行 catalog 已选中的 LocalTool。registry 与 catalog-private tool 复用完全相同的
 * 取消和异常收敛语义；后者不必为了执行而污染全局注册表。
 */
export async function executeLocalTool(
  tool: LocalTool,
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const name = tool.spec.name;
  if (ctx.signal.aborted) {
    return { ok: false, error: `Tool execution aborted: ${name}` };
  }
  try {
    return await tool.handler(args as never, ctx);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export class ToolsRegistry {
  private readonly entries = new Map<string, LocalTool>();

  /**
   * 注册一个工具。重名直接抛 —— 模块加载期发现冲突优于 runtime 静默覆盖。
   */
  register(tool: LocalTool): void {
    const name = tool.spec.name;
    if (this.entries.has(name)) {
      throw new Error(`[tools] duplicate local tool name: ${name}`);
    }
    this.entries.set(name, tool);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  get(name: string): LocalTool | undefined {
    return this.entries.get(name);
  }

  list(): LocalTool[] {
    return Array.from(this.entries.values());
  }

  /** 仅 spec(pi.Tool 形态),用于喂给 `pi.streamSimple({ tools })`。 */
  listSpecs(): PiTool[] {
    return this.list().map((t) => t.spec);
  }

  listNames(): string[] {
    return Array.from(this.entries.keys());
  }

}
/** 生产单例。启动注册由 `pi/tools/index.ts` 的副作用完成。 */
export const tools = new ToolsRegistry();

/**
 * 懒注册入口。
 *
 * 不在 `pi/index.ts` / IPC handler 顶层 static-import `./index` 的原因:
 * 部分 wrapper(`createScheduleTool` → `SchedulerManager` → `@main/pi`)
 * 会回引 pi 子树,直接静态 import 会形成循环。
 *
 * 所有需要"工具已注册"的入口(`tool.ts::buildToolCatalogFor*`、
 * `startup/ipc/tools.ts`)统一调本函数,内部惰性 dynamic import
 * `./index.ts`,首次触发其顶层 `registerAllTools()`,后续命中
 * module cache;并发首调由共享的 `toolsReady` promise 去重。
 *
 * **注意**:`./index` 在整个 main bundle 里**只能**作为 dynamic import 出现,
 * 否则 repo 自带的 `check-mixed-imports.js` lint 会 fail。新增 caller 务必
 * 走本入口,**不要**自己再写 `import './index'`。
 */
let toolsReady: Promise<void> | null = null;
export async function ensureToolsRegistered(): Promise<void> {
  if (!toolsReady) {
    toolsReady = import('./index').then(() => undefined);
  }
  await toolsReady;
}