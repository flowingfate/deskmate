// src/main/lib/compression/fullModeCompressor.ts
//
// Domain-shaped 上下文压缩器 —— 公共门面。
//
// 职责仅限 orchestration:把 messages 切成 head / middle / recent,把 middle
// 段送入 summarizer,失败时退化到"裸保留头尾"。具体子能力都被拆出去:
//   - messageStructure.ts    : 结构分析(锚点定位)
//   - messagePreview.ts      : 单条消息预压缩
//   - recursiveSummarizer.ts : token 预算 + 递归 summarize
//
// 与 IPC / persist 同形 → compression.ts 不再需要边界翻译。
// 蓝本:ai.prompt/message.md

import type { AssistantMessage, Message } from '@shared/persist/types'
import { createAssistantMessage } from '@shared/utils/messageFactory';
import { TokenCounter } from '../token';
import {
  analyzeMessageStructure,
  type MessageStructureAnalysis,
} from './messageStructure';
import {
  DEFAULT_PREVIEW_OPTIONS,
  prepareMessagesForCompression,
} from './messagePreview';
import {
  RecursiveSummarizer,
  makeDefaultSummarizeImpl,
  type SummarizeImpl,
} from './recursiveSummarizer';

export type { SummarizeImpl } from './recursiveSummarizer';

/** Full Mode compression configuration. */
export interface FullModeCompressionConfig {
  /** Number of recent messages to preserve. */
  preserveRecentMessages: number;
  /** Whether to additionally pin the first user message. */
  preserveFirstUserMessage: boolean;
  /** Whether to additionally pin the first SKILL.md tool-call block. */
  preserveFirstSkillToolCall: boolean;
  /** Conservative prompt-token budget bounding each summarization pass. */
  summaryPromptTokenBudget: number;
  /** Maximum LLM call retries inside the default `SummarizeImpl`. */
  maxRetries: number;
  /** Maximum recursive summary passes before failing to non-LLM fallback. */
  maxSummaryRecursionDepth: number;
  /** Maximum first-layer chunk summaries in flight at once. */
  maxConcurrentChunkSummaries: number;
  /** Whether to enable debug logging. */
  enableDebugLog: boolean;
}

export interface FullModeCompressionResult {
  success: boolean;
  originalMessages: Message[];
  compressedMessages: Message[];
  /** Description of the compression strategy used. */
  strategy: string;
  /** Range of messages that were compressed. */
  compressedRange?: {
    startIndex: number;
    endIndex: number;
    messageCount: number;
  };
  /** Summary content text, if applicable. */
  summary?: string;
  /**
   * 单条 Domain summary message,与 compressedMessages 中插入的 summary 同对象引用。
   * 仅 `compressionMethod === 'summary'` 时存在。
   */
  summaryMessage?: AssistantMessage;
  /** [head] 块在 compressedMessages 中的长度;= summary 在 compressedMessages 中的下标。 */
  earlyPreservedCount?: number;
  /** = originalMessages.length - recent 块长度;buildLlmContext 据此切片。 */
  compressedBeforeIndex?: number;
  processingTime: number;
  error?: string;
  metadata: {
    preservedFirst: boolean;
    preservedRecent: number;
    compressionMethod: 'summary' | 'none' | 'fallback';
    timestamp: number;
    /** Number of chunk-level summarize() invocations (one per chunk). */
    chunkSummaryCallCount: number;
    /** Total LLM API calls including retries across all chunks. */
    totalLlmCallCount: number;
  };
}

const DEFAULT_CONFIG: FullModeCompressionConfig = {
  preserveRecentMessages: 5,
  preserveFirstUserMessage: false,
  preserveFirstSkillToolCall: false,
  summaryPromptTokenBudget: 100000,
  maxRetries: 3,
  maxSummaryRecursionDepth: 4,
  maxConcurrentChunkSummaries: 2,
  enableDebugLog: false,
};

/**
 * General-purpose Deskmate task compressor.
 * 入口: `compressMessages(messages, profileId, summarize?)`。
 */
export class FullModeCompressor {
  private config: FullModeCompressionConfig;
  private readonly tokenCounter: TokenCounter;

  constructor(config: Partial<FullModeCompressionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tokenCounter = new TokenCounter({ enableCache: true, encoding: 'o200k_base' });
  }

  /**
   * 压缩 messages。Strategy:固定 recent 窗口 + 可选锚点(首条 user / 首条
   * SKILL.md read assistant),然后把"中段"摘成一条 summary 插入。
   *
   * `summarize` 缺省走默认实现(直接调 contextCompressionLlmSummarizer,无 trace);
   * 调用方可注入带 trace 的 SummarizeImpl 接管。
   */
  async compressMessages(
    messages: Message[],
    profileId: string,
    summarize?: SummarizeImpl,
  ): Promise<FullModeCompressionResult> {
    const startTime = Date.now();
    const summarizer = new RecursiveSummarizer({
      tokenCounter: this.tokenCounter,
      promptTokenBudget: this.config.summaryPromptTokenBudget,
      maxRecursionDepth: this.config.maxSummaryRecursionDepth,
      maxConcurrency: this.config.maxConcurrentChunkSummaries,
      summarize: summarize ?? makeDefaultSummarizeImpl(profileId, this.config.maxRetries),
    });

    let chunkSummaryCallCount = 0;
    let totalLlmCallCount = 0;

    try {
      const analysis = this.analyze(messages);

      if (!analysis.needsCompression) {
        return this.buildResult({
          success: true,
          originalMessages: messages,
          compressedMessages: messages,
          strategy: 'no_compression_needed',
          startTime,
          analysis,
          chunkSummaryCallCount,
          totalLlmCallCount,
        });
      }

      const compressed = await this.runCompression(messages, analysis, summarizer);
      chunkSummaryCallCount = compressed.chunkSummaryCallCount;
      totalLlmCallCount = compressed.totalLlmCallCount;

      return this.buildResult({
        success: true,
        originalMessages: messages,
        compressedMessages: compressed.compressedMessages,
        strategy: 'intelligent_summary',
        startTime,
        analysis,
        summary: compressed.summary,
        summaryMessage: compressed.summaryMessage,
        earlyPreservedCount: compressed.earlyPreservedCount,
        compressedBeforeIndex: compressed.compressedBeforeIndex,
        chunkSummaryCallCount,
        totalLlmCallCount,
      });
    } catch (error) {
      // Fallback:裸保留 firstUser + recent N 条,丢中段。Domain 形态下
      // assistant 与它的 tool_calls/responses 不可分,这种粗暴砍法不会留 orphan。
      const fallbackMessages = this.fallbackPreserve(messages);
      return this.buildResult({
        success: false,
        originalMessages: messages,
        compressedMessages: fallbackMessages,
        strategy: 'fallback_preservation',
        startTime,
        analysis: this.analyze(messages),
        error: error instanceof Error ? error.message : 'Unknown error',
        chunkSummaryCallCount,
        totalLlmCallCount,
      });
    }
  }

  // ─── orchestration ────────────────────────────────────────────────────

  private analyze(messages: readonly Message[]): MessageStructureAnalysis {
    return analyzeMessageStructure(messages, {
      preserveRecentMessages: this.config.preserveRecentMessages,
      preserveFirstUserMessage: this.config.preserveFirstUserMessage,
      preserveFirstSkillToolCall: this.config.preserveFirstSkillToolCall,
    });
  }

  /** 拼装 head ⨁ summary ⨁ protected-skill ⨁ recent。 */
  private async runCompression(
    messages: readonly Message[],
    analysis: MessageStructureAnalysis,
    summarizer: RecursiveSummarizer,
  ): Promise<{
    compressedMessages: Message[];
    summary?: string;
    summaryMessage?: AssistantMessage;
    earlyPreservedCount?: number;
    compressedBeforeIndex?: number;
    chunkSummaryCallCount: number;
    totalLlmCallCount: number;
  }> {
    const { firstUserMessageIndex, firstSkillToolCallIndices, middleMessagesRange, recentMessagesStartIndex } =
      analysis;

    if (!middleMessagesRange) {
      return {
        compressedMessages: [...messages],
        compressedBeforeIndex: messages.length,
        earlyPreservedCount: messages.length,
        chunkSummaryCallCount: 0,
        totalLlmCallCount: 0,
      };
    }

    // 中段范围内被锚点保护的消息(目前只可能是首条 SKILL.md read)
    const protectedMiddleIndices = new Set(
      firstSkillToolCallIndices.filter(
        (idx) => idx >= middleMessagesRange.start && idx <= middleMessagesRange.end,
      ),
    );

    // 实际需要送 summarize 的消息(中段 - 锚点保护)
    const middleMessages = messages
      .slice(middleMessagesRange.start, middleMessagesRange.end + 1)
      .filter((_, idx) => !protectedMiddleIndices.has(middleMessagesRange.start + idx));

    const { summary, chunkSummaryCallCount, totalLlmCallCount } = await summarizer.run(
      prepareMessagesForCompression(middleMessages, DEFAULT_PREVIEW_OPTIONS),
    );

    // 拼装最终数组
    const compressedMessages: Message[] = [];

    // 1. head: firstUser + 它和中段起点之间的消息
    if (firstUserMessageIndex !== -1 && firstUserMessageIndex < middleMessagesRange.start) {
      compressedMessages.push(messages[firstUserMessageIndex]);
    }
    if (firstUserMessageIndex !== -1 && firstUserMessageIndex + 1 < middleMessagesRange.start) {
      compressedMessages.push(...messages.slice(firstUserMessageIndex + 1, middleMessagesRange.start));
    } else if (firstUserMessageIndex === -1 && middleMessagesRange.start > 0) {
      compressedMessages.push(...messages.slice(0, middleMessagesRange.start));
    }

    // 2. summary
    let summaryMessage: AssistantMessage | undefined;
    const earlyPreservedCount = compressedMessages.length;
    if (summary) {
      summaryMessage = createAssistantMessage({ content: summary });
      compressedMessages.push(summaryMessage);
    }

    // 3. 中段被锚点保护的 SKILL.md assistant
    const sortedProtectedIndices = Array.from(protectedMiddleIndices).sort((a, b) => a - b);
    for (const idx of sortedProtectedIndices) compressedMessages.push(messages[idx]);

    // 4. recent
    compressedMessages.push(...messages.slice(recentMessagesStartIndex));

    return {
      compressedMessages,
      summary,
      summaryMessage,
      earlyPreservedCount,
      compressedBeforeIndex: recentMessagesStartIndex,
      chunkSummaryCallCount,
      totalLlmCallCount,
    };
  }

  /**
   * Fallback:无 LLM,只保留 firstUser + recent N 条。
   * Domain 形态下 assistant 与它的 tool_calls/responses 不可分,无需 orphan tool_result 兜底。
   */
  private fallbackPreserve(messages: readonly Message[]): Message[] {
    const result: Message[] = [];

    if (this.config.preserveFirstUserMessage) {
      const firstUserIndex = messages.findIndex((msg) => msg.role === 'user');
      if (firstUserIndex !== -1) result.push(messages[firstUserIndex]);
    }

    const recentStartIndex = Math.max(0, messages.length - this.config.preserveRecentMessages);
    result.push(...messages.slice(recentStartIndex));

    // 去重(避免 firstUser 同时也在 recent 窗口内)
    const seen = new Set<string>();
    return result.filter((msg) => {
      if (seen.has(msg.id)) return false;
      seen.add(msg.id);
      return true;
    });
  }

  private buildResult(args: {
    success: boolean;
    originalMessages: Message[];
    compressedMessages: Message[];
    strategy: string;
    startTime: number;
    analysis: MessageStructureAnalysis;
    summary?: string;
    summaryMessage?: AssistantMessage;
    earlyPreservedCount?: number;
    compressedBeforeIndex?: number;
    error?: string;
    chunkSummaryCallCount: number;
    totalLlmCallCount: number;
  }): FullModeCompressionResult {
    return {
      success: args.success,
      originalMessages: args.originalMessages,
      compressedMessages: args.compressedMessages,
      strategy: args.strategy,
      compressedRange: args.analysis.middleMessagesRange
        ? {
            startIndex: args.analysis.middleMessagesRange.start,
            endIndex: args.analysis.middleMessagesRange.end,
            messageCount: args.analysis.middleMessagesRange.count,
          }
        : undefined,
      summary: args.summary,
      summaryMessage: args.summaryMessage,
      earlyPreservedCount: args.earlyPreservedCount,
      compressedBeforeIndex: args.compressedBeforeIndex,
      processingTime: Date.now() - args.startTime,
      error: args.error,
      metadata: {
        preservedFirst: args.analysis.firstUserMessageIndex !== -1,
        preservedRecent: Math.min(this.config.preserveRecentMessages, args.originalMessages.length),
        compressionMethod: args.summary ? 'summary' : (args.success ? 'none' : 'fallback'),
        timestamp: Date.now(),
        chunkSummaryCallCount: args.chunkSummaryCallCount,
        totalLlmCallCount: args.totalLlmCallCount,
      },
    };
  }

  updateConfig(newConfig: Partial<FullModeCompressionConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getConfig(): FullModeCompressionConfig {
    return { ...this.config };
  }
}

export function createFullModeCompressor(
  config?: Partial<FullModeCompressionConfig>,
): FullModeCompressor {
  return new FullModeCompressor(config);
}
