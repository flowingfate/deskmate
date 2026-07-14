/**
 * RenderMessage —— 渲染进程使用的消息形态。
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  Domain    (shared/persist/types/message.ts) 主进程内存 + IPC 契约    │
 *   │  Persisted (同模块，`PersistedJsonLine`)      JSONL 行,从 Domain 派生  │
 *   │  Render    (本文件)                          渲染进程,UI flag 极简加挂 │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * 与 Domain 的差异:
 *   - assistant 多挂一个 `streamingComplete: boolean`,UI 据此显示流式光标 /
 *     收尾态。已落盘的历史消息天然 true;新生 streaming message 起步 false,
 *     收到 `complete` chunk 时翻 true。
 *   - user 形态不变(用户消息天然不流式);直接 alias 即可。
 *
 * UI 字段一律加在本文件,**禁止**回流到 shared / Domain 层。
 */

import type { UserMessage, AssistantMessage } from '@shared/persist/types'

export type RenderUserMessage = UserMessage;

export interface RenderAssistantMessage extends AssistantMessage {
  /** 流式收尾标记;持久化历史天然 true,新建 streaming message 起步 false。 */
  streamingComplete: boolean;
}

export type RenderMessage = RenderUserMessage | RenderAssistantMessage;
export type RenderMessageRole = RenderMessage['role'];

export const isRenderUserMessage = (m: RenderMessage): m is RenderUserMessage =>
  m.role === 'user';
export const isRenderAssistantMessage = (m: RenderMessage): m is RenderAssistantMessage =>
  m.role === 'assistant';

/**
 * 把 Domain Message 提到 RenderMessage:
 *   - user 直接透传(类型一致)
 *   - assistant 默认 `streamingComplete: true`(从 IPC 拿到的快照都是已收尾的)
 *
 * 注:对正在流式的 assistant 不要走这条 —— streaming 流自己在 session-manager
 * 里就地构造 Render 形态,起步标 `streamingComplete: false`。
 */
export function liftToRender(m: UserMessage | AssistantMessage): RenderMessage {
  if (m.role === 'user') return m;
  return { ...m, streamingComplete: true };
}
