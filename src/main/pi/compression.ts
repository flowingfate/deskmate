/**
 * pi 路径下的上下文压缩。
 *
 * 对外契约与 `FullModeCompressor` 内部都直接吃 Domain `Message[]`,无翻译层。
 *
 * 与旧 core/utils/compression.ts 的本质区别:
 * - 不再做本地 token 估算;token 数直接来自 pi 上一轮返回的 `usage.totalTokens`(含 output,与 badge 同口径)
 * - 首请求或上一轮失败导致 `lastUsage` 为空时,用 `roughEstimate` 做保护性兜底
 */

import type { CompressionSnapshot, ContextState, ContextTokenUsage } from '@shared/types/agentChatTypes';
import type { AssistantMessage, Message } from '@shared/types/message';
import type { Usage as PiUsage } from '@earendil-works/pi-ai';

import { buildLlmContext } from '@main/pi/utils/buildLlmContext';
import { createFullModeCompressor, type FullModeCompressor, type SummarizeImpl } from '@main/lib/compression/fullModeCompressor';
import { contextCompressionLlmSummarizer } from '@main/pi/utils/contextCompressionLlmSummarizer';
import { Tracer } from '@shared/log/trace';
import { log } from '@main/log';

// 全局共享 compressor —— 无 session 状态。lazy 初始化避免与 fullModeCompressor 测试
// hoist 顺序撞到 TDZ。
let sharedCompressorInstance: FullModeCompressor | null = null;
function sharedCompressor(): FullModeCompressor {
  sharedCompressorInstance ??= createFullModeCompressor();
  return sharedCompressorInstance;
}

const DEFAULT_COMPRESSION_THRESHOLD = 0.85;

export interface CheckAndCompressArgs {
  messages: Message[];
  contextState: ContextState;
  systemPrompt: string;
  toolsForEstimate: ReadonlyArray<unknown>;
  contextWindow: number;
  agentName: string;
  profileId: string;
  lastUsage: PiUsage | null;
  onWillCompress?: () => void;
  force?: boolean;
  compressionThreshold?: number;
  tracer?: Tracer;
}

export interface CheckAndCompressResult {
  applied: boolean;
  nextContextState: ContextState;
  usage: ContextTokenUsage;
  /** 基于 nextContextState 算好的 LLM 上下文(Domain 形态)。 */
  llmContext: Message[];
}

export async function checkAndCompress(args: CheckAndCompressArgs): Promise<CheckAndCompressResult> {
  const { messages, contextState, systemPrompt, toolsForEstimate, contextWindow, profileId, lastUsage, onWillCompress, force, compressionThreshold, tracer } = args;
  const threshold = compressionThreshold ?? DEFAULT_COMPRESSION_THRESHOLD;

  try {
    const contextHistory: Message[] = buildLlmContext(messages, contextState);
    const rawTotalMessages = messages.length;

    // 含 output 的历史总量;与 badge 同口径。下一轮 prompt ≈ 上轮 total + 新消息。
    const estimatedTokens = lastUsage ? lastUsage.totalTokens : roughEstimate(contextHistory, systemPrompt, toolsForEstimate);
    const baseUsage = makeUsage(estimatedTokens, rawTotalMessages, contextHistory.length);

    if (!force) {
      if (estimatedTokens < contextWindow * threshold) {
        return { applied: false, nextContextState: contextState, usage: baseUsage, llmContext: contextHistory };
      }
    }

    onWillCompress?.();

    const fullResult = await compressWithFullMode(contextHistory, sharedCompressor(), profileId, tracer);
    if (!fullResult) {
      return { applied: false, nextContextState: contextState, usage: baseUsage, llmContext: contextHistory };
    }

    const snapshot = buildCompressionSnapshot(messages, fullResult);
    const nextContextState: ContextState = {
      ...contextState,
      compressions: [...contextState.compressions, snapshot],
    };

    const postContextHistory = buildLlmContext(messages, nextContextState);
    const postUsage = makeUsage(
      roughEstimate(postContextHistory, systemPrompt, toolsForEstimate),
      rawTotalMessages,
      postContextHistory.length,
    );

    return { applied: true, nextContextState, usage: postUsage, llmContext: postContextHistory };
  } catch (err) {
    // compression 路径降级 —— 上下文继续走原 messages,turn 不挂;但要让事故
    // 在日志里看见,否则 summarizer 抛错 / OOM / token 计数 panic 全静默。
    log.warn({
      msg: '[pi/compression] checkAndCompress fell back to no-op due to error',
      err: err instanceof Error ? err : new Error(String(err)),
    });
    return {
      applied: false,
      nextContextState: contextState,
      usage: contextState.lastTokenUsage ?? {
        tokenCount: 0,
        totalMessages: messages.length,
        contextMessages: messages.length,
        compressionRatio: 1.0,
      },
      llmContext: buildLlmContext(messages, contextState),
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function makeUsage(tokenCount: number, totalMessages: number, contextMessages: number): ContextTokenUsage {
  return { tokenCount, totalMessages, contextMessages, compressionRatio: 1.0 };
}

/**
 * 极粗 token 估算:基于 Domain 形态的 content / think / attachment 长度。
 * 只在 lastUsage 为空时作为阈值守卫;不与 provider 实际计费口径对齐。
 *
 * 直接累加 length —— 不构造中间字符串。tools 走 `JSON.stringify(tools).length`
 * 一次,工具谱在 turn 内基本静态,这一笔不可避免;但消息体的拼接在长会话上
 * 会有 O(N²) rope 副作用,所以走 number。
 */
function roughEstimate(
  messages: readonly Message[],
  systemPrompt: string,
  tools: ReadonlyArray<unknown>,
): number {
  let len = systemPrompt.length;
  // tools 谱是静态的 → 一次 stringify 后只取长度,中间字符串随 GC 释放
  if (tools.length > 0) len += JSON.stringify(tools).length;
  for (const m of messages) {
    if (m.role === 'user') {
      len += m.content.length;
      for (const att of m.attachments) {
        // file/office/opaque 的 metadata 进估算;image 不算 base64(避免拉爆)
        len += att.fileName.length + att.mimeType.length;
        if (att.kind !== 'image') len += att.fileUri.length;
      }
      continue;
    }
    len += m.think.length + m.content.length;
    for (const tc of m.tool_calls) {
      len += tc.name.length + JSON.stringify(tc.args ?? {}).length;
      if (tc.response) len += tc.response.result.length;
    }
  }
  return Math.ceil(len / 4);
}

/**
 * 调 FullModeCompressor 并按"压缩比变小且有可用 summary"过滤结果。
 * Domain 形态下 compressor 直接吃 / 还回 Domain `Message[]`,无翻译层。
 */
async function compressWithFullMode(
  contextHistory: readonly Message[],
  compressor: FullModeCompressor,
  profileId: string,
  tracer: Tracer | undefined,
): Promise<FullModeResult | null> {
  const summarize: SummarizeImpl | undefined = tracer
    ? async (conversationText) => {
        const r = await contextCompressionLlmSummarizer.summarize({ conversationText, profileId, tracer });
        if (!r.success || !r.summary) {
          throw new Error(r.error || 'Summary API call failed after all retries');
        }
        return { summary: r.summary, attempts: r.attempts };
      }
    : undefined;
  const result = await compressor.compressMessages([...contextHistory], profileId, summarize);
  if (
    result.success
    && result.metadata.compressionMethod === 'summary'
    && result.summaryMessage
    && result.earlyPreservedCount !== undefined
    && result.summary?.trim()
    && result.compressedMessages.length < contextHistory.length
  ) {
    return {
      compressedMessages: result.compressedMessages,
      summaryMessage: result.summaryMessage,
      earlyPreservedCount: result.earlyPreservedCount,
    };
  }
  return null;
}

interface FullModeResult {
  compressedMessages: Message[];
  summaryMessage: AssistantMessage;
  earlyPreservedCount: number;
}

/**
 * 把 algorithm 输出的结构化字段映射到 `CompressionSnapshot`。`compressedBeforeIndex`
 * 走"反推 recent 长度"路线 —— algorithm 看到的是 `contextHistory`(已应用过上一次
 * snapshot 的形态),但 snapshot 里的 index 必须落在原始 `messages` 上,因此用
 * `messages.length - recentCount` 反推位置。recent 既是 contextHistory 末尾 N 条,
 * 也是 messages 末尾 N 条(只要 N ≤ contextHistory tail 长度,对压缩场景恒成立)。
 */
function buildCompressionSnapshot(
  originalMessages: readonly Message[],
  result: FullModeResult,
): CompressionSnapshot {
  const recentCount = result.compressedMessages.length - result.earlyPreservedCount - 1;
  return {
    earlyPreservedCount: result.earlyPreservedCount,
    summary: result.summaryMessage,
    compressedBeforeIndex: originalMessages.length - recentCount,
    appliedAt: new Date().toISOString(),
  };
}

