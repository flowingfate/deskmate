import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContextState } from '@shared/types/agentChatTypes';
import type { AssistantMessage, Message } from '@shared/types/message';
import type { Usage as PiUsage } from '@earendil-works/pi-ai';

// pi/compression 直接吃 Domain Message;mock 整个 fullModeCompressor 工厂,
// 控制它返回的 `FullModeCompressionResult`(Domain 形态)。
const compressMock = vi.fn();

vi.mock('@main/lib/compression/fullModeCompressor', () => ({
  createFullModeCompressor: () => ({
    compressMessages: (...args: unknown[]) => compressMock(...args),
  }),
}));

import { checkAndCompress } from '../compression';

// Domain 形态的构造助手。
function userMsg(text: string): Message {
  return { role: 'user', id: `u_${text}`, time: 1, content: text, attachments: [] };
}

function assistantMsg(text: string): Message {
  return { role: 'assistant', id: `a_${text}`, time: 2, think: '', content: text, tool_calls: [] };
}

function summaryMsg(text: string, id = 'summary_1'): AssistantMessage {
  return { role: 'assistant', id, time: 3, think: '', content: text, tool_calls: [] };
}

function makeUsage(input: number): PiUsage {
  return {
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * 模拟 algorithm "成功摘要"路径的输出。`summaryMessage` 是 compressedMessages
 * 中的同一对象引用,与算法实际行为一致。
 */
function ok(args: { compressedMessages: Message[]; summary: AssistantMessage; earlyPreservedCount: number }) {
  return {
    success: true,
    originalMessages: [],
    compressedMessages: args.compressedMessages,
    strategy: 'intelligent_summary',
    processingTime: 0,
    summary: args.summary.content,
    summaryMessage: args.summary,
    earlyPreservedCount: args.earlyPreservedCount,
    compressedBeforeIndex: args.compressedMessages.length - args.earlyPreservedCount - 1,
    metadata: { compressionMethod: 'summary', chunkSummaryCallCount: 1, totalLlmCallCount: 1 },
  };
}

function fail(originalMessages: Message[]) {
  return {
    success: false,
    originalMessages,
    compressedMessages: originalMessages,
    strategy: 'fallback_preservation',
    processingTime: 0,
    metadata: { compressionMethod: 'fallback', chunkSummaryCallCount: 0, totalLlmCallCount: 0 },
  };
}

describe('checkAndCompress', () => {
  beforeEach(() => {
    compressMock.mockReset();
  });

  it('skips compression when lastUsage.input below threshold', async () => {
    const messages: Message[] = [userMsg('hello'), assistantMsg('world')];
    const state: ContextState = { compressions: [] };

    const r = await checkAndCompress({
      messages,
      contextState: state,
      systemPrompt: 'sys',
      toolsForEstimate: [],
      contextWindow: 10_000,
      agentName: 'a',
      profileId: 'test-user',
      lastUsage: makeUsage(100), // 100 < 8500
    });

    expect(r.applied).toBe(false);
    expect(compressMock).not.toHaveBeenCalled();
    expect(r.usage.tokenCount).toBe(100);
    expect(r.nextContextState).toBe(state);
  });

  it('triggers compression when lastUsage.input over threshold', async () => {
    const messages: Message[] = [userMsg('a'), assistantMsg('b'), userMsg('c'), assistantMsg('d')];
    const state: ContextState = { compressions: [] };

    const summary = summaryMsg('SUMMARY');
    compressMock.mockResolvedValue(ok({
      compressedMessages: [summary, userMsg('c'), assistantMsg('d')],
      summary,
      earlyPreservedCount: 0,
    }));

    const willCompress = vi.fn();
    const r = await checkAndCompress({
      messages,
      contextState: state,
      systemPrompt: '',
      toolsForEstimate: [],
      contextWindow: 1_000,
      agentName: 'a',
      profileId: 'test-user',
      lastUsage: makeUsage(900), // 900 > 850
      onWillCompress: willCompress,
    });

    expect(willCompress).toHaveBeenCalledOnce();
    expect(r.applied).toBe(true);
    expect(r.nextContextState.compressions).toHaveLength(1);
    const snap = r.nextContextState.compressions[0];
    expect(snap.summary).toBe(summary);
    expect(snap.summary.content).toBe('SUMMARY');
    expect(snap.earlyPreservedCount).toBe(0);
    // 2 messages after summary → compressedBeforeIndex = 4 - 2 = 2
    expect(snap.compressedBeforeIndex).toBe(2);
  });

  it('force: true bypasses threshold check', async () => {
    const messages: Message[] = [userMsg('a'), assistantMsg('b'), userMsg('c')];
    const state: ContextState = { compressions: [] };

    // 返回 2 条 < 输入 3 条,满足 compressWithFullMode 的"长度变短"判定
    const summary = summaryMsg('SUM');
    compressMock.mockResolvedValue(ok({
      compressedMessages: [summary, assistantMsg('b')],
      summary,
      earlyPreservedCount: 0,
    }));

    const r = await checkAndCompress({
      messages,
      contextState: state,
      systemPrompt: '',
      toolsForEstimate: [],
      contextWindow: 1_000_000,
      agentName: 'a',
      profileId: 'test-user',
      lastUsage: makeUsage(10),
      force: true,
    });

    expect(r.applied).toBe(true);
    expect(compressMock).toHaveBeenCalledOnce();
  });

  it('falls back to roughEstimate when lastUsage is null', async () => {
    // 构造一段够长的消息让 roughEstimate 超阈值
    const big = 'x'.repeat(40_000); // ~10_000 tokens
    const messages: Message[] = [userMsg(big), assistantMsg('reply')];
    const state: ContextState = { compressions: [] };

    const summary = summaryMsg('SUM');
    compressMock.mockResolvedValue(ok({
      compressedMessages: [summary],
      summary,
      earlyPreservedCount: 0,
    }));

    const r = await checkAndCompress({
      messages,
      contextState: state,
      systemPrompt: '',
      toolsForEstimate: [],
      contextWindow: 1_000, // 850 threshold << 10_000 估算
      agentName: 'a',
      profileId: 'test-user',
      lastUsage: null,
    });

    expect(r.applied).toBe(true);
  });

  it('returns applied=false when compressor reports failure', async () => {
    const messages: Message[] = [userMsg('a')];
    const state: ContextState = { compressions: [] };

    compressMock.mockResolvedValue(fail([userMsg('a')]));

    const r = await checkAndCompress({
      messages,
      contextState: state,
      systemPrompt: '',
      toolsForEstimate: [],
      contextWindow: 10,
      agentName: 'a',
      profileId: 'test-user',
      lastUsage: makeUsage(100),
    });

    expect(r.applied).toBe(false);
  });

  it('catches compressor exceptions and returns lastTokenUsage fallback', async () => {
    const messages: Message[] = [userMsg('a')];
    const state: ContextState = {
      compressions: [],
      lastTokenUsage: { tokenCount: 42, totalMessages: 1, contextMessages: 1, compressionRatio: 1.0 },
    };

    compressMock.mockRejectedValue(new Error('boom'));

    const r = await checkAndCompress({
      messages,
      contextState: state,
      systemPrompt: '',
      toolsForEstimate: [],
      contextWindow: 10,
      agentName: 'a',
      profileId: 'test-user',
      lastUsage: makeUsage(100),
    });

    expect(r.applied).toBe(false);
    expect(r.usage.tokenCount).toBe(42);
  });
});
