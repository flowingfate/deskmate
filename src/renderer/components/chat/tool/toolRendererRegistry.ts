// src/renderer/components/chat/tool/toolRendererRegistry.ts
// 工具渲染覆盖项的注册表 + dispatch。
//
// 结构:`Map<toolName, ToolRenderer>` —— 一个工具一个坑,严格一对一,O(1) 查询。
// 子命令分派(如 `app` 内部分到 `subagent` / `mcp` / `skill`)是**该工具自身**
// 实现细节,在它的 slot 函数 / component 内部完成,不暴露到本表。
//
// 注册入口由 `./registerBuiltins.ts` 集中拉起;barrel(index.ts)在 import
// 自身时连带触发。

import type { ToolRenderer } from './types';

const REGISTRY = new Map<string, ToolRenderer>();

/**
 * 注册一个工具的 renderer。同一个 toolName 重复注册会被忽略(防止 dev HMR
 * 双注),开发期 console.warn 提醒。
 */
export function registerToolRenderer(toolName: string, renderer: ToolRenderer): void {
  if (REGISTRY.has(toolName)) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(`[tool-renderer] duplicate registration toolName="${toolName}", ignoring`);
    }
    return;
  }
  REGISTRY.set(toolName, renderer);
}

export function resolveToolRenderer(toolName: string): ToolRenderer | null {
  return REGISTRY.get(toolName) ?? null;
}

/**
 * 测试 / 调试用 —— 清空 registry。生产代码不要调用。
 */
export function _resetToolRendererRegistryForTest(): void {
  REGISTRY.clear();
}
