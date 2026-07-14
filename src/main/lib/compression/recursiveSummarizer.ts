// src/main/lib/compression/recursiveSummarizer.ts
//
// 递归 summarize:把若干 Domain Message 喂给 LLM 摘要,过长时按 token 预算切块,
// 并行 summarize 每个 chunk,再把这些 partial summary 包成"假 assistant 消息"
// 走第二轮 summarize,直到一次塞得下或达到 `maxRecursionDepth`。
//
// 还包含三个紧密耦合的子能力:
//   1. token 预算估算 + 单条消息塞入 budget(`fitMessageToPromptBudget`)
//   2. 文本二分截断到指定 token 数(`truncateTextToTokenBudget`)
//   3. 把 Domain Message 渲染成 LLM 看的纯文本(`buildConversationText`)
//
// 这些子能力之所以放一起:它们仅被 RecursiveSummarizer 内部消费、共享 tokenCounter
// + budget 配置;拆出去就要在每个调用点重传同一组参数,反而更糟。
//
// 蓝本:ai.prompt/message.md

import type { AssistantMessage, Message, UserMessage } from '@shared/persist/types'
import { createAssistantMessage } from '@shared/utils/messageFactory';
import type { TokenCounter } from '../token';
import { contextCompressionLlmSummarizer } from '@main/pi';

/**
 * 调用方注入的 summarize 实现 —— 给一段对话文本,返回 summary。
 * 让 caller 自己决定走哪条 LLM、是否挂主链路 trace、走啥 profile,
 * RecursiveSummarizer 内部不感知这些。
 *
 * 返回的 `attempts` 让外层准确累加 `totalLlmCallCount`,无需理会重试细节。
 */
export type SummarizeImpl = (conversationText: string) => Promise<{ summary: string; attempts: number }>;

export interface RecursiveSummarizerOptions {
  tokenCounter: TokenCounter;
  /** 单次 summarize prompt 的 token 上限。 */
  promptTokenBudget: number;
  /** 递归 summarize 上限,防止一直塞不下时的无限递归。 */
  maxRecursionDepth: number;
  /** chunk-level summarize 并发上限。 */
  maxConcurrency: number;
  /** LLM 调用入口。缺省走默认 contextCompressionLlmSummarizer(无 trace);需要 profileId 时由 caller 注入。 */
  summarize: SummarizeImpl;
}

export interface RecursiveSummarizerResult {
  summary: string;
  /** 一次 summarize 调用 = 一个 chunk;反映本次压缩切了多少块。 */
  chunkSummaryCallCount: number;
  /** 包括重试的 LLM API 调用累计。 */
  totalLlmCallCount: number;
}

/**
 * 给 RecursiveSummarizer 用、profile 已知的默认 SummarizeImpl —— 直接调
 * `contextCompressionLlmSummarizer.summarize`,不挂主 trace。
 *
 * 业务路径(`compression.ts`)倾向于自己包一层带 trace 的 SummarizeImpl 注入,
 * 这个 helper 仅为单元测试 / 命令行场景提供便利。
 */
export function makeDefaultSummarizeImpl(profileId: string, maxRetries: number): SummarizeImpl {
  return async (conversationText) => {
    const r = await contextCompressionLlmSummarizer.summarize({
      conversationText,
      profileId,
      maxRetries,
    });
    if (!r.success || !r.summary) {
      throw new Error(r.error || 'Summary API call failed after all retries');
    }
    return { summary: r.summary, attempts: r.attempts };
  };
}

/**
 * 递归 summarize 一组 messages,返回 summary 文本 + 调用计数。
 * 一次性使用:每次 `run()` 内部计数从 0 起;实例可复用配置但不共享 counters。
 */
export class RecursiveSummarizer {
  private static readonly MIN_EFFECTIVE_SUMMARY_CONTENT_TOKENS = 64;
  private static readonly MIN_MERGE_MESSAGE_TOKENS = 128;
  private static readonly MERGE_SUMMARY_HEADER = 'Chunk summary to merge:\n';
  private static readonly SINGLE_MESSAGE_TRUNCATION_SUFFIX = '\n[Truncated to fit summary prompt budget]';
  private static readonly TOOL_RESULT_TRUNCATED_PLACEHOLDER = '[tool result truncated to fit summary prompt budget]';

  private readonly opts: RecursiveSummarizerOptions;
  private chunkSummaryCallCount = 0;
  private totalLlmCallCount = 0;

  constructor(opts: RecursiveSummarizerOptions) {
    this.opts = opts;
  }

  async run(messages: readonly Message[]): Promise<RecursiveSummarizerResult> {
    this.chunkSummaryCallCount = 0;
    this.totalLlmCallCount = 0;
    const summary = await this.summarizeRecursively(messages, 'conversation', 0);
    return {
      summary,
      chunkSummaryCallCount: this.chunkSummaryCallCount,
      totalLlmCallCount: this.totalLlmCallCount,
    };
  }

  // ─── 递归骨架 ──────────────────────────────────────────────────────────

  private async summarizeRecursively(
    messages: readonly Message[],
    stage: 'conversation' | 'merge',
    depth: number,
  ): Promise<string> {
    if (depth >= this.opts.maxRecursionDepth) {
      throw new Error(
        `Exceeded maxSummaryRecursionDepth=${this.opts.maxRecursionDepth} during ${stage} summary recursion`,
      );
    }

    const chunks = this.chunkMessages(messages, stage);
    if (chunks.length === 0) return '';
    if (chunks.length === 1) {
      return await this.callSummaryAPI(buildConversationText(chunks[0]));
    }

    const partialSummaries = stage === 'conversation'
      ? await this.summarizeChunksConcurrently(chunks)
      : await this.summarizeChunksSequentially(chunks);

    // partial summaries 包成 fake assistant message 走第二轮 summarize
    const mergeMessages: Message[] = this.prepareMergeSummaryMessages(partialSummaries).map((s) =>
      createAssistantMessage({ content: `${RecursiveSummarizer.MERGE_SUMMARY_HEADER}${s}` }),
    );

    return await this.summarizeRecursively(mergeMessages, 'merge', depth + 1);
  }

  // ─── chunk 并发策略 ────────────────────────────────────────────────────

  /**
   * Worker-pool 并发 summarize。`nextChunkIndex` 自增和读取之间没有 await,
   * 每个 worker 抢到唯一 index 后才进 LLM 调用,Node 单线程 event loop 下安全。
   */
  private async summarizeChunksConcurrently(chunks: readonly Message[][]): Promise<string[]> {
    const maxConcurrency = Math.max(1, this.opts.maxConcurrency);
    const partialSummaries = new Array<string>(chunks.length);
    let nextChunkIndex = 0;

    const workers = Array.from({ length: Math.min(maxConcurrency, chunks.length) }, async () => {
      while (true) {
        const chunkIndex = nextChunkIndex;
        nextChunkIndex += 1;
        if (chunkIndex >= chunks.length) return;
        partialSummaries[chunkIndex] = await this.callSummaryAPI(buildConversationText(chunks[chunkIndex]));
      }
    });

    await Promise.all(workers);
    return partialSummaries;
  }

  /** merge 阶段通常 chunk 少,串行更省并发额度 + 上下文连贯性更好。 */
  private async summarizeChunksSequentially(chunks: readonly Message[][]): Promise<string[]> {
    const partialSummaries: string[] = [];
    for (const chunk of chunks) {
      partialSummaries.push(await this.callSummaryAPI(buildConversationText(chunk)));
    }
    return partialSummaries;
  }

  // ─── chunking + 单条塞入 budget ────────────────────────────────────────

  private chunkMessages(messages: readonly Message[], stage: 'conversation' | 'merge'): Message[][] {
    if (messages.length === 0) return [];

    const availablePromptTokens = this.getAvailablePromptTokens();
    const chunks: Message[][] = [];
    let currentChunk: Message[] = [];
    let currentPromptTokens = 0;

    for (const originalMessage of messages) {
      const message = this.fitMessageToBudget(originalMessage, availablePromptTokens, stage);
      const messagePromptTokens = this.estimateMessageTokens(message, stage);
      if (currentChunk.length > 0 && currentPromptTokens + messagePromptTokens > availablePromptTokens) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentPromptTokens = 0;
      }

      currentChunk.push(message);
      currentPromptTokens += messagePromptTokens;
    }

    if (currentChunk.length > 0) chunks.push(currentChunk);
    return chunks;
  }

  private getAvailablePromptTokens(): number {
    const promptOverheadTokens = contextCompressionLlmSummarizer.getPromptOverheadTokens(this.opts.tokenCounter);
    const availablePromptTokens = this.opts.promptTokenBudget - promptOverheadTokens;
    if (availablePromptTokens < RecursiveSummarizer.MIN_EFFECTIVE_SUMMARY_CONTENT_TOKENS) {
      throw new Error(
        `summaryPromptTokenBudget=${this.opts.promptTokenBudget} is too small for the summary template overhead (${promptOverheadTokens} prompt tokens)`,
      );
    }
    return availablePromptTokens;
  }

  private prepareMergeSummaryMessages(partialSummaries: readonly string[]): string[] {
    const availablePromptTokens = this.getAvailablePromptTokens();
    const perMessageBudget = Math.max(
      RecursiveSummarizer.MIN_MERGE_MESSAGE_TOKENS,
      Math.floor(availablePromptTokens / 2),
    );

    return partialSummaries.map((summary) =>
      this.truncateTextToTokenBudget(summary, perMessageBudget, RecursiveSummarizer.MERGE_SUMMARY_HEADER),
    );
  }

  /** 二分搜最大可塞前缀,加 `[Truncated for recursive merge budget]` 后缀。 */
  private truncateTextToTokenBudget(text: string, tokenBudget: number, prefix = ''): string {
    const fullText = `${prefix}${text}`;
    if (this.opts.tokenCounter.countTextTokens(fullText) <= tokenBudget) {
      return text;
    }

    const suffix = '\n[Truncated for recursive merge budget]';
    let low = 0;
    let high = text.length;
    let best = '';

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = `${text.slice(0, mid)}${suffix}`;
      const candidateTokens = this.opts.tokenCounter.countTextTokens(`${prefix}${candidate}`);
      if (candidateTokens <= tokenBudget) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return best || suffix.trim();
  }

  private estimateMessageTokens(message: Message, stage: 'conversation' | 'merge'): number {
    const prefix = stage === 'merge' ? RecursiveSummarizer.MERGE_SUMMARY_HEADER : '';
    const messagePart = buildConversationMessagePart(message, prefix);
    return this.opts.tokenCounter.countTextTokens(`${messagePart}\n\n`);
  }

  /**
   * 把一条本身就大于 budget 的消息塞进 budget。
   * 第一招:assistant 的所有 tool_call.response.result 全部替换占位符。
   * 第二招:对消息正文(content)做 token 二分截断。
   * 两招都失败抛错(budget 配的太小,不可恢复)。
   */
  private fitMessageToBudget(message: Message, tokenBudget: number, stage: 'conversation' | 'merge'): Message {
    if (this.estimateMessageTokens(message, stage) <= tokenBudget) {
      return message;
    }

    const prefix = stage === 'merge' ? RecursiveSummarizer.MERGE_SUMMARY_HEADER : '';
    let candidate: Message = message;

    // 第一招:替换 tool result
    if (candidate.role === 'assistant' && candidate.tool_calls.some((tc) => tc.response)) {
      const truncatedToolCalls = candidate.tool_calls.map((tc) =>
        tc.response
          ? { ...tc, response: { ...tc.response, result: RecursiveSummarizer.TOOL_RESULT_TRUNCATED_PLACEHOLDER } }
          : tc,
      );
      candidate = { ...candidate, tool_calls: truncatedToolCalls };
      if (this.estimateMessageTokens(candidate, stage) <= tokenBudget) return candidate;
    }

    // 第二招:正文 token 二分截断
    const truncatedText = this.truncateMessageTextToBudget(candidate, tokenBudget, prefix);
    candidate = { ...candidate, content: truncatedText } as Message;

    if (this.estimateMessageTokens(candidate, stage) > tokenBudget) {
      throw new Error(`Unable to fit single ${message.role} message within summary prompt budget ${tokenBudget}`);
    }
    return candidate;
  }

  private truncateMessageTextToBudget(message: Message, tokenBudget: number, prefix = ''): string {
    const originalText = message.content;
    const suffix = RecursiveSummarizer.SINGLE_MESSAGE_TRUNCATION_SUFFIX;
    let candidateMessage: Message = message;
    const tokensWithText = (text: string): number => {
      candidateMessage = { ...candidateMessage, content: text } as Message;
      const candidatePart = buildConversationMessagePart(candidateMessage, prefix);
      return this.opts.tokenCounter.countTextTokens(`${candidatePart}\n\n`);
    };

    if (tokensWithText(originalText) <= tokenBudget) return originalText;

    let low = 0;
    let high = originalText.length;
    let best = '';

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = `${originalText.slice(0, mid)}${suffix}`;
      if (tokensWithText(candidate) <= tokenBudget) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (best) return best;
    if (tokensWithText(suffix.trim()) <= tokenBudget) return suffix.trim();
    throw new Error(`Summary prompt budget ${tokenBudget} is too small to represent a truncated ${message.role} message`);
  }

  // ─── LLM 调用门面 ──────────────────────────────────────────────────────

  private async callSummaryAPI(conversationText: string): Promise<string> {
    this.chunkSummaryCallCount += 1;
    const { summary, attempts } = await this.opts.summarize(conversationText);
    this.totalLlmCallCount += attempts;
    return summary;
  }
}

// ─── 把 Domain Message 渲染成 LLM 输入文本 ────────────────────────────────
//
// 这两个函数与 RecursiveSummarizer 紧耦合(estimateMessageTokens / chunkMessages
// 都靠它估字节),但本身是纯函数。export 出去同时给单测用。

/** 多条消息 → 一段 conversation text(消息间双换行)。 */
export function buildConversationText(messages: readonly Message[]): string {
  return messages.map((m) => buildConversationMessagePart(m)).join('\n\n');
}

/**
 * 单条消息文本表示。assistant 的 tool_calls / response 在这里展开为子行,
 * 让 chunk token 估算能看到 tool 结果体积(否则 chunking 会大幅低估)。
 */
export function buildConversationMessagePart(message: Message, textPrefix = ''): string {
  let messagePart = `**${message.role}**: ${textPrefix}${message.content}`;

  if (message.role === 'assistant') {
    appendAssistantToolCalls(message, (line) => { messagePart += line; });
  } else {
    const summary = buildAttachmentSummary(message);
    if (summary) messagePart += ` [Attachments: ${summary}]`;
  }

  return messagePart;
}

function appendAssistantToolCalls(message: AssistantMessage, push: (line: string) => void): void {
  if (message.tool_calls.length === 0) return;
  const toolNames = message.tool_calls.map((tc) => tc.name).join(', ');
  push(` [Tool calls: ${toolNames}]`);
  for (const tc of message.tool_calls) {
    const argsText = (() => {
      try { return JSON.stringify(tc.args ?? {}); } catch { return '{}'; }
    })();
    if (tc.response) {
      push(`\n[tool_call: ${tc.name}] args=${argsText} result=${tc.response.result}`);
    } else {
      push(`\n[tool_call: ${tc.name}] args=${argsText} result=(no response)`);
    }
  }
}

function buildAttachmentSummary(m: UserMessage): string | null {
  if (m.attachments.length === 0) return null;
  const groups: { kind: string; names: string[] }[] = [
    { kind: 'files', names: [] },
    { kind: 'office', names: [] },
    { kind: 'opaque', names: [] },
    { kind: 'images', names: [] },
  ];
  for (const att of m.attachments) {
    if (att.kind === 'text') groups[0].names.push(att.fileName);
    else if (att.kind === 'office') groups[1].names.push(att.fileName);
    else if (att.kind === 'opaque') groups[2].names.push(att.fileName);
    else if (att.kind === 'image') groups[3].names.push(att.fileName);
  }
  const parts: string[] = [];
  for (const g of groups) {
    if (g.names.length > 0) parts.push(`${g.names.length} ${g.kind}: ${g.names.join(', ')}`);
  }
  return parts.length > 0 ? parts.join('; ') : null;
}
