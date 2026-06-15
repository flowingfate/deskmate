/**
 * RenderItemsManager —— 把 RenderMessage[] 编译成 UI 友好的 render items 列表。
 *
 * Domain 重构后:
 *   - 顶层只有 user / assistant;tool 结果折在 assistant.tool_calls[i].response。
 *   - assistant.content / assistant.think 是单串(不再是 ContentPart[])。
 *   - `<FINAL_SUMMARY>` 标记**已被淘汰** —— think / content 物理分离,
 *     prompt 端不再注入,本文件不再剥离。
 *
 * 输出形态:
 *   - `assistant`           : 一条 assistant 文本展示(纯文本部分,有则出)。
 *   - `tool-calls-section`  : 紧跟其后的 tool 调用集合(有则出);若 assistant
 *                              无文本只有 tool 调用,就只出 section,不出 assistant 项。
 *   - `user`                : 用户消息。
 *   - `activity-loading` / `activity-placeholder` : UI 占位。
 */

import type { ToolCall } from '@shared/types/message';
import type { PresentedFile } from '@renderer/components/chat/message/GeneratedFileCards';
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
      presentedFiles?: PresentedFile[];
      extractedFilePaths: string[];
      scheduleIds: string[];
    }
  | {
      type: 'tool-calls-section';
      toolCalls: ToolCall[];
      sectionKey: string;
      sourceMessageIndex: number;
      /**
       * 后续是否已经有 user / assistant 文本消息;true 时即使有 tool_call 没收完
       * response,也视作"被打断"。由 computeRenderItems 一次性扫描得出。
       */
      hasSubsequentConversation: boolean;
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

// ── Internal helpers ──

const extractPresentedFiles = (toolCalls: ToolCall[]): PresentedFile[] => {
  const files: PresentedFile[] = [];
  for (const tc of toolCalls) {
    if (tc.name !== 'present_deliverables') continue;
    const fileUris = (tc.args as { fileUris?: unknown }).fileUris;
    if (!Array.isArray(fileUris)) continue;
    const description =
      typeof (tc.args as { description?: unknown }).description === 'string'
        ? ((tc.args as { description: string }).description)
        : 'Final deliverables';
    files.push({
      // 与历史行为兼容:`fileUri` 字段塞 JSON 序列化的 uri 数组(下游展开)。
      fileUri: JSON.stringify(fileUris),
      description,
    });
  }
  return files;
};

// ── Core: compute render items from messages ──

export function computeRenderItems(messages: RenderMessage[]): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  let toolCallsSectionCounter = 0;

  // 预扫描:每条 assistant message 后是否还有 user 或 (有文本的) assistant。
  // 用倒序累计:从尾向头标记"自此向后存在对话延续"。
  const hasFollowingTextAfter: boolean[] = new Array(messages.length).fill(false);
  let followingFlag = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    hasFollowingTextAfter[i] = followingFlag;
    const m = messages[i];
    if (m.role === 'user') {
      followingFlag = true;
    } else if (m.content.trim().length > 0) {
      followingFlag = true;
    }
  }

  messages.forEach((message, index) => {
    if (message.role === 'user') {
      items.push({ type: 'user', message, index });
      return;
    }

    // assistant
    const hasText = message.content.trim().length > 0;
    const hasTools = message.tool_calls.length > 0;

    if (hasText) {
      const derived = getAssistantDerived(message);
      items.push({
        type: 'assistant',
        message,
        index,
        extractedFilePaths: derived.extractedFilePaths,
        scheduleIds: derived.scheduleIds,
        presentedFiles: hasTools ? extractPresentedFiles(message.tool_calls) : undefined,
      });
    }

    if (hasTools) {
      items.push({
        type: 'tool-calls-section',
        toolCalls: message.tool_calls,
        sectionKey: `tool-section-${index}-${toolCallsSectionCounter++}`,
        sourceMessageIndex: index,
        hasSubsequentConversation: hasFollowingTextAfter[index] ?? false,
        index: items.length,
      });
    }
  });

  attachPresentedFilesToFollowingAssistant(items);
  return items;
}

/**
 * 处理"纯 tool 调用消息(无文本) → present_deliverables 产物如何展示"的边界:
 * 把 section 的 presentedFiles 转挂给紧随其后的 assistant 文本项。
 *
 * 现实场景:agent 先发一条带 tool 调用(无文本)的 assistant,再发一条带文本的
 * assistant 收尾。前者的 present_deliverables 应该展示在后者下面。
 */
function attachPresentedFilesToFollowingAssistant(items: ChatRenderItem[]): void {
  let pending: PresentedFile[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type === 'tool-calls-section') {
      const files = extractPresentedFiles(it.toolCalls);
      if (files.length > 0) pending.push(...files);
      continue;
    }
    if (it.type === 'assistant') {
      // assistant 项自身已 inline 了 presentedFiles(同消息的 tool 调用产物);
      // pending 是来自 *前面* section 的产物,这里追加。
      if (pending.length > 0) {
        const merged = [...(it.presentedFiles ?? []), ...pending];
        items[i] = { ...it, presentedFiles: merged };
        pending = [];
      }
      continue;
    }
    if (it.type === 'user') {
      // 用户消息把 pending 重置 —— 跨 turn 的产物不再继承。
      pending = [];
    }
  }
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

function arePresentedFilesEqual(
  a: PresentedFile[] | undefined,
  b: PresentedFile[] | undefined,
): boolean {
  if (a === b) return true;
  const lenA = a?.length ?? 0;
  const lenB = b?.length ?? 0;
  if (lenA !== lenB) return false;
  if (lenA === 0) return true;
  for (let i = 0; i < lenA; i++) {
    const pa = a![i];
    const pb = b![i];
    if (pa.fileUri !== pb.fileUri) return false;
    if (pa.description !== pb.description) return false;
  }
  return true;
}

/** 内容相等比较 —— 比 React.memo 的浅比较更宽(toolCalls 数组逐项比内容)。 */
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
      if (a.sectionKey !== b.sectionKey) return false;
      if (a.sourceMessageIndex !== b.sourceMessageIndex) return false;
      if (a.hasSubsequentConversation !== b.hasSubsequentConversation) return false;
      if (a.toolCalls.length !== b.toolCalls.length) return false;
      for (let i = 0; i < b.toolCalls.length; i++) {
        if (a.toolCalls[i] !== b.toolCalls[i]) return false;
      }
      return true;
    case 'assistant':
      if (a.type !== 'assistant') return false;
      if (a.message !== b.message) return false;
      if (!arePresentedFilesEqual(a.presentedFiles, b.presentedFiles)) return false;
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
