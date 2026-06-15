// src/renderer/components/chat/toolCallViews/index.ts
// Tool Call custom view exports and selection functions.
//
// dispatch 流:
//   1. 传统 LocalTool(`shell` / `write` 等)仍按 `toolName`
//      直接 switch 命中 view。
//   2. `app` LocalTool 走 `resolveAppCmdView(toolName, rawArgs)` —— resolver
//      只接管 toolName === 'app' 的调用,把 cmdline 子命令(`subagent spawn` /
//      `subagent spawn-many` 等)派到对应富交互 view;无匹配返回 null,
//      `app` 调用就走默认 view(单行 displayText 即可)。
//
// 不在本文件直接 import `app` 的所有子命令 view —— `appCmdViewResolver` 自己
// 持有那条 mapping,本文件只对 resolver 做 fall-through。

import React from 'react';
import { ToolCallViewProps } from './types';
import { ShellToolCallView } from './ShellToolCallView';
import { WriteToolCallView } from './WriteToolCallView';
import { SubAgentToolCallView, ParallelSubAgentsToolCallView } from './SubAgentToolCallView';
import { resolveAppCmdView } from './appCmdViewResolver';

export * from './types';
export { ShellToolCallView } from './ShellToolCallView';
export { WriteToolCallView } from './WriteToolCallView';
export { SubAgentToolCallView, ParallelSubAgentsToolCallView } from './SubAgentToolCallView';

/**
 * Get the custom view component for a given tool call.
 * Returns null when no custom view applies, in which case the caller renders
 * the default single-line display.
 *
 * `rawArgs` is required when dispatching `app` calls — resolver inspects the
 * `cmd` field to pick a sub-view. Non-`app` tools ignore the argument.
 */
export const getToolCallView = (
  toolName: string,
  rawArgs?: Record<string, unknown>,
): React.ComponentType<ToolCallViewProps> | null => {
  // `app` 走 resolver:命中 → 返回 sub-view;不命中 → null(默认 view)。
  const appView = resolveAppCmdView(toolName, rawArgs);
  if (appView) return appView;
  if (toolName === 'app') return null;

  switch (toolName) {
    case 'shell':
      return ShellToolCallView;

    case 'write':
      return WriteToolCallView;

    // present_deliverables tool does not use a custom view; handled specially by ToolCallsSection
    case 'present_deliverables':
      return null;

    // 未来若有其它富交互 LocalTool,加在这里。`app` 子命令 view 走上面的
    // `resolveAppCmdView`,不要塞进这条 switch。

    default:
      return null;
  }
};

/**
 * Check if a tool call has a custom view. Passes `rawArgs` through so `app`
 * calls go through `resolveAppCmdView` consistently with `getToolCallView`.
 */
export const hasCustomView = (toolName: string, rawArgs?: Record<string, unknown>): boolean => {
  return getToolCallView(toolName, rawArgs) !== null;
};