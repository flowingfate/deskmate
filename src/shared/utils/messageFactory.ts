/**
 * Domain Message 工厂 + 全局 message id 生成器。
 *
 * **整个代码库只有这一个出处。**
 * - 任何 user / assistant message 创建路径必须走 `createUserMessage` /
 *   `createAssistantMessage`(或显式调 `newMessageId()`)。
 * - 禁止在业务模块里再写 `${prefix}_${Date.now()}_${Math.random()...}` 拼装
 *   message id —— 历史上同一个字段在四个文件里漂出四种长度,trace 难对齐。
 *
 * 与 `@shared/types/message` 的关系:类型定义留在 message.ts(IPC 契约纯类型),
 * 创建逻辑放这里(实现 + 默认值),双方互不污染。
 */

import type {
  AssistantMessage,
  AssistantOutcome,
  Attachment,
  TokenUsage,
  ToolCall,
  UserMessage,
} from '@shared/types/message';

/**
 * 生成 Domain Message 的全局唯一 id。
 *
 * 形如 `msg_<base36-time>_<base36-rand9>`。
 *
 * 前缀固定 `msg`,**不区分 user / assistant** —— role 已在 `Message.role` 上,
 * id 不再承担"形态"信息(老链路里 `user_xxx` / `assistant_xxx` 是历史包袱)。
 */
export function newMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

// ─── User ──────────────────────────────────────────────────────────────────

export interface UserMessageInit {
  content: string;
  attachments?: Attachment[];
  /** 默认 `newMessageId()`;只有 edit / replay 等需要稳定 id 的路径才显式传。 */
  id?: string;
  /** 默认 `Date.now()`;同上。 */
  time?: number;
}

export function createUserMessage(init: UserMessageInit): UserMessage {
  return {
    role: 'user',
    id: init.id ?? newMessageId(),
    time: init.time ?? Date.now(),
    content: init.content,
    attachments: init.attachments ?? [],
  };
}

// ─── Assistant ─────────────────────────────────────────────────────────────

export interface AssistantMessageInit {
  /** 默认 `''`(纯思考无文本输出的 assistant 也合法)。 */
  content?: string;
  /** 默认 `''`。 */
  think?: string;
  /** 默认 `[]`。 */
  tool_calls?: ToolCall[];
  outcome?: AssistantOutcome;
  model?: string;
  usage?: TokenUsage;
  id?: string;
  time?: number;
}

export function createAssistantMessage(init: AssistantMessageInit = {}): AssistantMessage {
  const msg: AssistantMessage = {
    role: 'assistant',
    id: init.id ?? newMessageId(),
    time: init.time ?? Date.now(),
    think: init.think ?? '',
    content: init.content ?? '',
    tool_calls: init.tool_calls ?? [],
  };
  if (init.outcome) msg.outcome = init.outcome;
  if (init.model) msg.model = init.model;
  if (init.usage) msg.usage = init.usage;
  return msg;
}
