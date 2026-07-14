/**
 * RenderItemsManager —— 把 RenderMessage[] 编译成 UI 友好的 render items 列表。
 *
 * Domain 重构后:
 *   - 顶层只有 user / assistant;tool 结果折在 assistant.tool_calls[i].response。
 *   - assistant.content / assistant.think 是单串(不再是 ContentPart[])。
 *
 * 输出形态(纯数据,**不带任何 list 中位置派生量**:dim / live 判定都是
 * iterator(`ChatContainer`) 的工作,不是 item 自带属性):
 *   - `assistant`           : 一条 assistant 文本展示(纯文本部分,有则出)。
 *   - `tool-calls-section`  : tool 调用集合。**连续 assistant 消息的 tool_calls
 *                              会合并到同一个 section,即便中间夹着带文本的
 *                              assistant**;带文本的 assistant 会先把当前积累
 *                              的 tool 段冲出来,再把自己的 tools 起成新的
 *                              merge 链 —— 后续相邻的 empty-only tool 链会并入
 *                              这条链(视觉上文本已在 section 上方,紧邻的工具段
 *                              合并更自然)。user 消息或下一条带文本 assistant
 *                              才切断 merge 链。
 *   - `user`                : 用户消息。
 *   - `activity-loading` / `activity-placeholder` : UI 占位。
 *
 * 坐标系契约:
 *   - **`item.index` = items 数组下标,所有类型一致**(render-items 坐标系)。
 *     从前 user/assistant 的 `index` 是 messages 坐标、tool-section 是 items
 *     坐标 —— 同名异义,已纠正。
 *   - messages 坐标系仅在 domain 操作里用(如 `editMessageAtom.save` 做
 *     `messages.slice(0, index)` 截断),不再走私进 render items。
 */

import type { ToolCall } from '@shared/persist/types'
import { extractFilePathsFromText } from './extractFilePaths';
import type { SessionManager } from './session-manager';
import type {
  RenderMessage,
  RenderUserMessage,
  RenderAssistantMessage,
} from './renderMessage';

// ── ChatRenderItem type ──

export type ChatRenderItem =
  | { type: 'user'; message: RenderUserMessage; index: number }
  | {
      type: 'assistant';
      message: RenderAssistantMessage;
      index: number;
      extractedFilePaths: string[];
      scheduleIds: string[];
    }
  | {
      type: 'tool-calls-section';
      /** 合并后的扁平 tool_calls 数组,按 owners 顺序拼接。 */
      toolCalls: ToolCall[];
      /**
       * `tool-section-${firstOwnerId}__${lastOwnerId}`。owner 链端点变 → key 变 →
       * `reuseUnchangedItems` 自动失效复用。stableKey 也走它。
       */
      sectionKey: string;
      index: number;
    }
  | { type: 'activity-loading'; sectionKey: string; index: number }
  | { type: 'activity-placeholder'; sectionKey: string; index: number };

// ── ChatRenderItem helpers ──

function assertNever(item: never): never {
  throw new Error(`Unhandled ChatRenderItem type: ${JSON.stringify(item)}`);
}

export const getChatRenderItemStableKey = (item?: ChatRenderItem): string => {
  if (!item) return 'none';
  switch (item.type) {
    case 'assistant':
    case 'user':
      return `${item.type}:${item.message.id || item.index}`;
    case 'tool-calls-section':
      return `${item.type}:${item.sectionKey}`;
    case 'activity-loading':
    case 'activity-placeholder':
      return `${item.type}:${item.sectionKey || item.index}`;
    default:
      assertNever(item);
  }
};

export const isVisibleChatRenderItem = (item?: ChatRenderItem): boolean => {
  if (!item) return false;
  if (item.type === 'tool-calls-section') {
    return item.toolCalls.some((tc) => tc.name.trim().length > 0);
  }
  return item.type !== 'activity-loading' && item.type !== 'activity-placeholder';
};

export const hasTextContent = (message: RenderMessage): boolean => {
  if (message.role === 'user') return message.content.trim().length > 0;
  return message.content.trim().length > 0;
};

// ── Per-message derived data cache ──

/**
 * Schedule job id 形如 `sched_YYYYMMDDhhmmss_<owner>_<suffix>` —— 由 doctor / scheduler 工具
 * 产出,UI 在每条 assistant 文本里抽出后展示成卡片。
 */
const SCHEDULE_JOB_ID_PATTERN = /sched_\d{14}(?:_[a-z0-9-]+_[a-z0-9]+|_[a-z0-9]{8,16})/gi;

interface AssistantDerived {
  extractedFilePaths: string[];
  scheduleIds: string[];
}

const assistantDerivedCache = new WeakMap<RenderAssistantMessage, AssistantDerived>();

function getAssistantDerived(message: RenderAssistantMessage): AssistantDerived {
  const cached = assistantDerivedCache.get(message);
  if (cached) return cached;

  const text = message.content;
  const extractedFilePaths = text ? extractFilePathsFromText(text) : [];
  const scheduleMatches = text.match(SCHEDULE_JOB_ID_PATTERN);
  const scheduleIds = scheduleMatches ? Array.from(new Set(scheduleMatches)) : [];

  const derived: AssistantDerived = { extractedFilePaths, scheduleIds };
  assistantDerivedCache.set(message, derived);
  return derived;
}

// ── Core: compute render items from messages ──

interface PendingMergeSection {
  toolCalls: ToolCall[];
  /** 仅 build 期暂存,flush 后只编码进 sectionKey 字符串就丢弃。 */
  firstOwnerId: string;
  lastOwnerId: string;
}

export function computeRenderItems(messages: RenderMessage[]): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  let pending: PendingMergeSection | null = null;

  const flushPending = () => {
    if (!pending) return;
    items.push({
      type: 'tool-calls-section',
      toolCalls: pending.toolCalls,
      sectionKey: `tool-section-${pending.firstOwnerId}__${pending.lastOwnerId}`,
      index: items.length,
    });
    pending = null;
  };

  for (const message of messages) {
    if (message.role === 'user') {
      flushPending();
      items.push({ type: 'user', message, index: items.length });
      continue;
    }

    // assistant
    const hasText = message.content.trim().length > 0;
    const hasTools = message.tool_calls.length > 0;

    if (hasText) {
      // 文本是时间线分隔点：先把已积累的 empty-only tool 链冲出来。
      flushPending();
      const derived = getAssistantDerived(message);
      items.push({
        type: 'assistant',
        message,
        index: items.length,
        extractedFilePaths: derived.extractedFilePaths,
        scheduleIds: derived.scheduleIds,
      });
      // text+tools：本条 tools 起一个可继续合并的段；后续相邻的 empty-only
      // tool 链会并入同一 section（截断点是 user 消息或下一条带文本 assistant）。
      if (hasTools) {
        pending = {
          toolCalls: [...message.tool_calls],
          firstOwnerId: message.id,
          lastOwnerId: message.id,
        };
      }
      continue;
    }

    // empty-text assistant：tool-only merge 链的组成单元。
    if (!hasTools) continue;

    if (!pending) {
      pending = {
        toolCalls: [...message.tool_calls],
        firstOwnerId: message.id,
        lastOwnerId: message.id,
      };
    } else {
      pending.toolCalls.push(...message.tool_calls);
      pending.lastOwnerId = message.id;
    }
  }

  flushPending();
  return items;
}

/**
 * 用 stable key 对齐前后两版 render items;位置不变且关键字段没变的 item 直接复用旧引用,
 * 让下游 React.memo 的浅比较生效(否则每次 chunk 都会让 tool-calls-section / assistant
 * 看上去"变了",触发整列 re-render)。
 */
export function reuseUnchangedItems(prev: ChatRenderItem[], next: ChatRenderItem[]): ChatRenderItem[] {
  if (prev.length === 0) return next;

  const prevByKey = new Map<string, ChatRenderItem>();
  for (const item of prev) prevByKey.set(getChatRenderItemStableKey(item), item);

  let reusedAny = false;
  const result = next.map((item) => {
    const prior = prevByKey.get(getChatRenderItemStableKey(item));
    if (prior && isSameRenderItem(prior, item)) {
      reusedAny = true;
      return prior;
    }
    return item;
  });
  return reusedAny ? result : next;
}

/** 内容相等比较 —— 比 React.memo 的浅比较更宽(toolCalls 数组逐项比引用)。 */
function isSameRenderItem(a: ChatRenderItem, b: ChatRenderItem): boolean {
  if (a.type !== b.type) return false;
  if (a.index !== b.index) return false;
  switch (b.type) {
    case 'activity-loading':
    case 'activity-placeholder':
      return a.type === b.type;
    case 'user':
      return a.type === 'user' && a.message === b.message;
    case 'tool-calls-section':
      if (a.type !== 'tool-calls-section') return false;
      // sectionKey 编码了 (firstOwnerId, lastOwnerId);它一致 = owner 链端点没变。
      if (a.sectionKey !== b.sectionKey) return false;
      // toolCalls 逐项比引用:catches 中段 owner 改动 (immer 让那条 tool_calls 换引用) +
      // 流式 chunk 追加新项 + section 收到 response 翻新 ToolCall 引用。
      if (a.toolCalls.length !== b.toolCalls.length) return false;
      for (let i = 0; i < b.toolCalls.length; i++) {
        if (a.toolCalls[i] !== b.toolCalls[i]) return false;
      }
      return true;
    case 'assistant':
      if (a.type !== 'assistant') return false;
      if (a.message !== b.message) return false;
      return true;
    default:
      assertNever(b);
  }
}

// ── RenderItemsManager ──

export class RenderItemsManager {
  private renderItemsCache = new Map<string, ChatRenderItem[]>();
  private previousMessages = new Map<string, RenderMessage[]>();
  private unsubscribe: () => void;

  constructor(sessions: SessionManager) {
    this.unsubscribe = sessions.onSessionChange((session, type) => {
      if (type === 'remove') {
        this.removeSession(session.chatSessionId);
        return;
      }
      const prev = this.previousMessages.get(session.chatSessionId);
      if (!prev || prev !== session.messages) {
        this.recompute(session.chatSessionId, session.messages);
      }
    });
  }

  recompute(chatSessionId: string, messages: RenderMessage[]): void {
    const prevItems = this.renderItemsCache.get(chatSessionId);
    const nextItems = computeRenderItems(messages);
    const reusedItems = prevItems ? reuseUnchangedItems(prevItems, nextItems) : nextItems;
    this.renderItemsCache.set(chatSessionId, reusedItems);
    this.previousMessages.set(chatSessionId, messages);
  }

  getRenderItems(chatSessionId: string): ChatRenderItem[] {
    return this.renderItemsCache.get(chatSessionId) ?? EMPTY_RENDER_ITEMS;
  }

  removeSession(chatSessionId: string): void {
    this.renderItemsCache.delete(chatSessionId);
    this.previousMessages.delete(chatSessionId);
  }

  clearCaches(): void {
    this.renderItemsCache.clear();
    this.previousMessages.clear();
  }

  cleanup(): void {
    this.unsubscribe();
    this.clearCaches();
  }
}

const EMPTY_RENDER_ITEMS: ChatRenderItem[] = [];
