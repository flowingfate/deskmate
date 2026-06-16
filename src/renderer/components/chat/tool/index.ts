// src/renderer/components/chat/tool/index.ts
// 工具调用渲染机制的 barrel。
//
// 副作用:import 本文件即触发 `registerBuiltinToolRenderers()`,完成所有内置
// renderer 的注册。`ToolCallsSection` / `ToolDetailView` 渲染时调用
// `resolveToolRenderer(toolName)` 查注册表 —— 命中即按 slot 优先级
// (粗 > 细 > 默认)注入对应点位的覆盖,无命中则全部走默认。
//
// 设计纪律(参见 ./types.ts 顶部注释):
//   - 三个固定点位 chip / input / output,布局由本目录拥有,工具不接管。
//   - 每个点位"细 / 粗二选一"覆盖。output 额外允许覆盖 executing 状态
//     (OutputExecutingBlock,仅粗粒度)。
//   - 失败 / interrupted 一律走默认渲染。

import { registerBuiltinToolRenderers } from './registerBuiltins';

// 模块加载即注册。registerBuiltins 内部幂等,HMR / 多次 import 安全。
registerBuiltinToolRenderers();

export * from './types';
export { ToolCallsSection } from './ToolCallsSection';
export { ToolDetailView } from './ToolDetailView';
export { registerToolRenderer, resolveToolRenderer } from './toolRendererRegistry';
