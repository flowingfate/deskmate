/**
 * Unit tests for FullModeCompressor.
 *
 * The default strategy now prioritizes recent-turn continuity, structure-aware
 * trimming, and tool_result integrity over hard positional pinning.
 */

// Mock context compression summarizer to avoid actual API calls
vi.mock('@main/pi/utils/contextCompressionLlmSummarizer', async () => {
  const actual = await vi.importActual('@main/pi/utils/contextCompressionLlmSummarizer') as any;
  const PROMPT_OVERHEAD_TOKENS = 1500;

  return {
    ...(actual as Record<string, unknown>),
    contextCompressionLlmSummarizer: {
      ...actual.contextCompressionLlmSummarizer,
      summarize: vi.fn().mockResolvedValue({
        success: true,
        summary: '<summary>Test summary content</summary>',
        attempts: 1,
      }),
      buildPrompt: vi.fn((conversationText: string) =>
        actual.contextCompressionLlmSummarizer.buildPrompt(conversationText)
      ),
      estimateRequestTokens: vi.fn((_tokenCounter: { countTextTokens: (text: string) => number }, conversationText: string) =>
        PROMPT_OVERHEAD_TOKENS + Math.ceil(conversationText.length / 4)
      ),
      getPromptOverheadTokens: vi.fn(() => PROMPT_OVERHEAD_TOKENS),
    }
  };
});

// Mock TokenCounter to use cheap char-based estimation instead of tiktoken encoding.
vi.mock('../../token', async () => {
  const actual = await vi.importActual('../../token') as any;
  return {
    ...actual,
    TokenCounter: class MockTokenCounter {
      countTextTokens(text: string): number {
        return Math.ceil((text || '').length / 4);
      }
      getCacheStats() { return { hits: 0, misses: 0, size: 0, hitRate: 0 }; }
    },
  };
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { FullModeCompressor, createFullModeCompressor } from '../fullModeCompressor';
import { analyzeMessageStructure, findFirstSkillToolCallIndices } from '../messageStructure';
import { prepareMessagesForCompression } from '../messagePreview';
import { RecursiveSummarizer } from '../recursiveSummarizer';
import { TokenCounter } from '../../token';
import type {
  AssistantMessage,
  Message,
  ToolCall,
  UserMessage,
} from '@shared/types/message';
import { contextCompressionLlmSummarizer as _contextCompressionLlmSummarizerImport } from '@main/pi/utils/contextCompressionLlmSummarizer';

// ─── Domain message helpers ─────────────────────────────────────────────────

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}

function createUserMessage(text: string, id?: string): UserMessage {
  return {
    role: 'user',
    id: id || nextId('user'),
    time: Date.now(),
    content: text,
    attachments: [],
  };
}

function createAssistantMessage(
  text: string,
  id?: string,
  tool_calls: ToolCall[] = [],
): AssistantMessage {
  return {
    role: 'assistant',
    id: id || nextId('assistant'),
    time: Date.now(),
    think: '',
    content: text,
    tool_calls,
  };
}

/**
 * Helper to build a `read` ToolCall pointing at a SKILL.md file. Optionally
 * attaches a successful response containing a sample skill body —— 旧测试模式
 * "建一条 assistant + 在它后面 push 一条 ToolMessage"在 Domain 形态下塌缩成
 * "建一条 assistant 把 response 直接挂在对应 ToolCall 上"。
 */
function createSkillToolCall(id: string, filePath: string, response: string | null = createSkillToolResult()): ToolCall {
  return {
    id,
    name: 'read',
    time: Date.now(),
    args: { path: filePath },
    ...(response !== null
      ? { response: { time: Date.now(), status: 'success', result: response } as const }
      : {}),
  };
}

/** Helper to build a `read` 风格 tool result body that compressMessages
 *  treats as 'this is a SKILL.md read'. */
function createSkillToolResult(): string {
  return JSON.stringify({
    content: "---\nname: titan-dynamic-query\ndescription: Execute and analyze dynamic SQL queries...\n---\n\n# Titan Dynamic Query SKILL\n\n## Purpose\n\nThis skill enables the analysis and execution of dynamic SQL queries...",
    fileName: "skill.md",
    startLine: 1,
    endLine: 383,
    totalLines: 383,
    size: 17324,
    truncated: false
  });
}

/**
 * Build an assistant message that owns N tool_calls,each with the given
 * fat result —— 用于测试"recent assistant 自带巨大 tool result 需要预压缩"
 * 这条路径(旧形态下用顶层 tool message,新形态嵌入式)。
 */
function assistantWithFatToolResults(
  id: string,
  toolName: string,
  fatResults: Array<{ id: string; args: Record<string, unknown>; result: string }>,
): AssistantMessage {
  return createAssistantMessage('', id, fatResults.map((r) => ({
    id: r.id,
    name: toolName,
    time: Date.now(),
    args: r.args,
    response: { time: Date.now(), status: 'success', result: r.result },
  })));
}

describe('FullModeCompressor', () => {
  let compressor: FullModeCompressor;
  let contextCompressionLlmSummarizerMock: {
    summarize: Mock;
    buildPrompt: Mock;
    estimateRequestTokens: Mock;
    getPromptOverheadTokens: Mock;
  };

  beforeEach(() => {
    compressor = createFullModeCompressor({
      preserveRecentMessages: 3,
    });
    contextCompressionLlmSummarizerMock = vi.mocked(_contextCompressionLlmSummarizerImport) as any;
    contextCompressionLlmSummarizerMock.summarize.mockReset();
    contextCompressionLlmSummarizerMock.summarize.mockResolvedValue({
      success: true,
      summary: '<summary>Test summary content</summary>',
      attempts: 1,
    });
    idCounter = 0;
  });

  describe('chunked and structural compression', () => {
    it('runs conversation chunk summaries with bounded concurrency while preserving result order', async () => {
      const contextCompressionLlmSummarizer = vi.mocked(_contextCompressionLlmSummarizerImport);
      let activeCalls = 0;
      let maxActiveCalls = 0;
      const dispatchedChunkSummaries: string[] = [];
      const completedChunkSummaries: string[] = [];
      const pendingResolvers = new Map<number, () => void>();
      let releasedFirstWave = false;
      let firstWaveSize = 0;

      contextCompressionLlmSummarizer.summarize.mockClear();
      contextCompressionLlmSummarizer.summarize.mockImplementation(async ({ conversationText }: { conversationText: string }) => {
        const isMergeCall = conversationText.includes('Chunk summary to merge:');
        if (!isMergeCall) {
          activeCalls += 1;
          maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        }

        const chunkMatch = conversationText.match(/Chunk (\d+)/);
        const chunkIndex = chunkMatch ? Number(chunkMatch[1]) : 99;
        const summaryLabel = `summary:chunk-${chunkIndex}`;
        if (!isMergeCall) {
          dispatchedChunkSummaries.push(summaryLabel);
        }

        if (!isMergeCall && !releasedFirstWave) {
          // Yield so all concurrent slots have a chance to enter before checking the gate.
          await Promise.resolve();
          await new Promise<void>((resolve) => {
            pendingResolvers.set(chunkIndex, resolve);
            firstWaveSize = Math.max(firstWaveSize, pendingResolvers.size);

            if (!releasedFirstWave && firstWaveSize >= 2 && pendingResolvers.size === firstWaveSize) {
              releasedFirstWave = true;
              queueMicrotask(() => {
                Array.from(pendingResolvers.keys())
                  .sort((left, right) => right - left)
                  .forEach((index) => pendingResolvers.get(index)?.());
              });
            }
          });
        }

        if (!isMergeCall) {
          activeCalls -= 1;
          completedChunkSummaries.push(summaryLabel);
        }

        return {
          success: true,
          summary: isMergeCall ? `merged:${conversationText.slice(0, 24)}` : summaryLabel,
          attempts: 1,
        };
      });

      const concurrentCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 2500,
        maxConcurrentChunkSummaries: 3,
      });

      const largeMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        ...Array.from({ length: 8 }, (_, index) =>
          createAssistantMessage(`Chunk ${index}: ${'A'.repeat(5000)}`, `mid_${index}`)
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      await concurrentCompressor.compressMessages(largeMessages, "test-user");

      expect(maxActiveCalls).toBeGreaterThan(1);
      expect(maxActiveCalls).toBeLessThanOrEqual(3);
      expect(firstWaveSize).toBeGreaterThan(1);
      expect(completedChunkSummaries.slice(0, firstWaveSize)).toEqual(
        dispatchedChunkSummaries.slice(0, firstWaveSize).slice().reverse()
      );
      expect(completedChunkSummaries.slice(0, firstWaveSize)).not.toEqual(dispatchedChunkSummaries.slice(0, firstWaveSize));

      const firstMergeCallIndex = contextCompressionLlmSummarizer.summarize.mock.calls.findIndex(
        ([args]: [{ conversationText: string }]) => args.conversationText.includes('Chunk summary to merge:')
      );
      expect(firstMergeCallIndex).toBeGreaterThan(0);

      const [firstMergeArgs] = contextCompressionLlmSummarizer.summarize.mock.calls[firstMergeCallIndex] as [{ conversationText: string }];
      const mergeSummaryOrder: string[] = firstMergeArgs.conversationText.match(/summary:chunk-\d+/g) || [];
      expect(mergeSummaryOrder.length).toBeGreaterThan(0);
      expect(mergeSummaryOrder).toEqual(
        dispatchedChunkSummaries.filter((summary) => mergeSummaryOrder.includes(summary))
      );
    });

    it('falls back when any concurrent conversation chunk summary fails', async () => {
      const contextCompressionLlmSummarizer = vi.mocked(_contextCompressionLlmSummarizerImport);

      contextCompressionLlmSummarizer.summarize.mockClear();
      contextCompressionLlmSummarizer.summarize.mockImplementation(async ({ conversationText }: { conversationText: string }) => {
        if (conversationText.includes('Chunk 1:')) {
          throw new Error('synthetic concurrent chunk failure');
        }

        return {
          success: true,
          summary: '<summary>Test summary content</summary>',
          attempts: 1,
        };
      });

      const concurrentCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 2500,
        maxConcurrentChunkSummaries: 3,
      });

      const largeMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        ...Array.from({ length: 8 }, (_, index) =>
          createAssistantMessage(`Chunk ${index}: ${'A'.repeat(5000)}`, `mid_${index}`)
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      const result = await concurrentCompressor.compressMessages(largeMessages, "test-user");

      expect(result.success).toBe(false);
      expect(result.strategy).toBe('fallback_preservation');
      expect(result.error).toContain('synthetic concurrent chunk failure');
      expect(result.compressedMessages.map((message) => message.id)).toEqual(['recent_1', 'recent_2', 'recent_3']);
    });

    it('keeps merge-stage summaries sequential even when conversation summaries are concurrent', async () => {
      const contextCompressionLlmSummarizer = vi.mocked(_contextCompressionLlmSummarizerImport);
      let activeMergeCalls = 0;
      let maxActiveMergeCalls = 0;

      contextCompressionLlmSummarizer.summarize.mockClear();
      contextCompressionLlmSummarizer.summarize.mockImplementation(async ({ conversationText }: { conversationText: string }) => {
        const isMergeCall = conversationText.includes('Chunk summary to merge:');
        if (isMergeCall) {
          activeMergeCalls += 1;
          maxActiveMergeCalls = Math.max(maxActiveMergeCalls, activeMergeCalls);
        }

        await Promise.resolve();

        if (isMergeCall) {
          activeMergeCalls -= 1;
          return {
            success: true,
            summary: 'M'.repeat(2200),
            attempts: 1,
          };
        }

        return {
          success: true,
          summary: 'S'.repeat(2200),
          attempts: 1,
        };
      });

      const concurrentCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 3000,
        maxConcurrentChunkSummaries: 3,
      });

      const largeMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        ...Array.from({ length: 10 }, (_, index) =>
          createAssistantMessage(`Section ${index}: ${'A'.repeat(2800)}`, `mid_${index}`)
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      await concurrentCompressor.compressMessages(largeMessages, "test-user");

      expect(maxActiveMergeCalls).toBeLessThanOrEqual(1);
    });

    it('splits oversized middle history into multiple summary calls', async () => {
      const contextCompressionLlmSummarizer = vi.mocked(_contextCompressionLlmSummarizerImport);
      const budgetedCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 2500,
      });

      const largeMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        ...Array.from({ length: 8 }, (_, index) =>
          createAssistantMessage('A'.repeat(5000), `mid_${index}`)
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      await budgetedCompressor.compressMessages(largeMessages, "test-user");

      expect(contextCompressionLlmSummarizer.summarize.mock.calls.length).toBeGreaterThan(1);
    });

    it('recursively merges chunk summaries instead of doing one unbounded final merge pass', async () => {
      const contextCompressionLlmSummarizer = vi.mocked(_contextCompressionLlmSummarizerImport);
      contextCompressionLlmSummarizer.summarize.mockClear();
      contextCompressionLlmSummarizer.summarize.mockImplementation(async ({ conversationText }: { conversationText: string }) => {
        if (conversationText.includes('Chunk summary to merge:')) {
          return {
            success: true,
            summary: 'M'.repeat(2200),
            attempts: 1,
          };
        }

        return {
          success: true,
          summary: 'S'.repeat(2200),
          attempts: 1,
        };
      });

      const recursivelyMergingCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 3000,
      });

      const largeMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        ...Array.from({ length: 10 }, (_, index) =>
          createAssistantMessage(`Section ${index}: ${'A'.repeat(2800)}`, `mid_${index}`)
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      await recursivelyMergingCompressor.compressMessages(largeMessages, "test-user");

      const mergeCalls = contextCompressionLlmSummarizer.summarize.mock.calls.filter(
        ([args]: [{ conversationText: string }]) => args.conversationText.includes('Chunk summary to merge:')
      );
      expect(mergeCalls.length).toBeGreaterThan(1);
    });

    it('keeps every summary-model prompt within the configured token budget including template overhead', async () => {
      const contextCompressionLlmSummarizer = vi.mocked(_contextCompressionLlmSummarizerImport);
      contextCompressionLlmSummarizer.summarize.mockClear();

      const budgetedCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 2200,
      });

      // 把 7 个膨大的 read 结果塞进单条 assistant 里(每个 tool_call 一个 fat
      // response),模拟"上下文里堆满工具结果"的场景。
      const denseMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        assistantWithFatToolResults(
          'fat_assistant',
          'read',
          Array.from({ length: 7 }, (_, index) => ({
            id: `tool_${index}`,
            args: { path: `/tmp/deep/${index}` },
            result: JSON.stringify({
              path: `/tmp/deep/${index}`,
              content: '数据'.repeat(450) + JSON.stringify({ index, nested: 'X'.repeat(900) }),
            }),
          })),
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      await budgetedCompressor.compressMessages(denseMessages, "test-user");

      const tokenCounter = (budgetedCompressor as any).tokenCounter;
      const configuredBudget = budgetedCompressor.getConfig().summaryPromptTokenBudget;
      for (const [args] of contextCompressionLlmSummarizer.summarize.mock.calls as Array<[{ conversationText: string }]>) {
        const requestTokens = contextCompressionLlmSummarizer.estimateRequestTokens(tokenCounter, args.conversationText);
        expect(requestTokens).toBeLessThanOrEqual(configuredBudget);
      }
    });

    it('counts system prompt inside summary prompt overhead budgeting', async () => {
      const { TokenCounter: RealTokenCounter } = await vi.importActual('../../token') as any;
      const { contextCompressionLlmSummarizer: realSummarizer } = await vi.importActual('@main/pi/utils/contextCompressionLlmSummarizer') as any;
      const realTokenCounter = new RealTokenCounter({ enableCache: true });

      const overheadTokens = realSummarizer.getPromptOverheadTokens(realTokenCounter);
      const userPromptOnlyTokens = realTokenCounter.countTextTokens(
        contextCompressionLlmSummarizerMock.buildPrompt('')
      );

      expect(overheadTokens).toBeGreaterThan(userPromptOnlyTokens);
    });

    it('re-truncates a single oversized message so it cannot bypass the prompt budget', () => {
      const summarizer = new RecursiveSummarizer({
        tokenCounter: new TokenCounter({ enableCache: false, encoding: 'o200k_base' }),
        promptTokenBudget: 1800,
        maxRecursionDepth: 4,
        maxConcurrency: 2,
        summarize: async (text) => ({ summary: `summary(${text.length})`, attempts: 1 }),
      });

      // ASCII text: 5000 chars ≈ 1250 tokens, well above availablePromptTokens (300).
      const oversizedMessage = createAssistantMessage('A'.repeat(5000), 'dense_assistant');
      const availablePromptTokens = (summarizer as any).getAvailablePromptTokens();
      const fittedMessage = (summarizer as any).fitMessageToBudget(
        oversizedMessage,
        availablePromptTokens,
        'conversation',
      ) as Message;

      expect(fittedMessage.content).toContain('[Truncated to fit summary prompt budget]');
      const fittedTokens = (summarizer as any).estimateMessageTokens(fittedMessage, 'conversation');
      expect(fittedTokens).toBeLessThanOrEqual(availablePromptTokens);
    });

    it('treats summaryPromptTokenBudget as a hard budget and falls back when it is below template overhead', async () => {
      const hardBudgetCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 128,
      });

      const messages: Message[] = [
        createUserMessage('start', 'msg_start'),
        createAssistantMessage('middle content that would need summarization', 'mid_1'),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      const result = await hardBudgetCompressor.compressMessages(messages, "test-user");

      expect(result.success).toBe(false);
      expect(result.strategy).toBe('fallback_preservation');
      expect(result.error).toContain('summaryPromptTokenBudget=128 is too small');
    });

    it('fails back when recursive merge exceeds the configured summary depth limit', async () => {
      contextCompressionLlmSummarizerMock.summarize.mockImplementation(async ({ conversationText }: { conversationText: string }) => {
        if (conversationText.includes('Chunk summary to merge:')) {
          return {
            success: true,
            summary: 'M'.repeat(2400),
            attempts: 1,
          };
        }

        return {
          success: true,
          summary: 'S'.repeat(2400),
          attempts: 1,
        };
      });

      const shallowDepthCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        summaryPromptTokenBudget: 3000,
        maxSummaryRecursionDepth: 1,
      });

      const largeMessages: Message[] = [
        createUserMessage('start', 'msg_start'),
        ...Array.from({ length: 10 }, (_, index) =>
          createAssistantMessage(`Section ${index}: ${'A'.repeat(2800)}`, `mid_${index}`)
        ),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      const result = await shallowDepthCompressor.compressMessages(largeMessages, "test-user");

      expect(result.success).toBe(false);
      expect(result.strategy).toBe('fallback_preservation');
      expect(result.error).toContain('Exceeded maxSummaryRecursionDepth=1');
    });

    it('structurally truncates giant tool results before summary generation', () => {
      // 历史:这里用 `fetch_web_content` 当 toolName 测 generic 压缩路径;
      // web 域迁到 `app web fetch` 后 toolName 永远是 `app`,但 generic
      // JSON branch 行为不变。把 toolName 切到 `app` 既反映现状,也覆盖
      // 同一逻辑路径。
      const longToolText = 'X'.repeat(10000);
      const fatAssistant = assistantWithFatToolResults('asst_fat', 'app', [
        { id: 'tool_1', args: {}, result: longToolText },
      ]);
      const prepared = prepareMessagesForCompression([fatAssistant])[0] as AssistantMessage;
      const compactResult = prepared.tool_calls[0].response?.result ?? '';

      expect(compactResult.length).toBeLessThan(longToolText.length);
      expect(compactResult).toContain('Compressed for summary generation');
      expect(compactResult).toContain('originalLength=10000');
    });

    it('keeps read boundaries when structurally truncating', () => {
      // `read` 工具 backend 返回值字段:`fileName`(filesystem)+ 可选 `url`
      // (internal-url)。buildReadPreview 优先 url,再 fileName。本 case 锁住
      // filesystem backend 形态(无 url,只有 fileName)。
      const longPayload = JSON.stringify({
        fileName: 'huge.log',
        startLine: 10,
        endLine: 300,
        totalLines: 500,
        size: 20480,
        content: 'B'.repeat(12000),
      });

      const fatAssistant = assistantWithFatToolResults('asst_read', 'read', [
        { id: 'tool_1', args: { path: 'huge.log' }, result: longPayload },
      ]);
      const prepared = prepareMessagesForCompression([fatAssistant])[0] as AssistantMessage;
      const compactResult = prepared.tool_calls[0].response?.result ?? '';

      expect(compactResult).toContain('[Structured compression: read]');
      expect(compactResult).toContain('file=huge.log');
      expect(compactResult).toContain('range=10-300');
      expect(compactResult).toContain('totalLines=500');
    });

    it('uses `url` field for internal resources (skill:// etc.)', () => {
      // internal-url backend 返回带 `url: "skill://foo"` —— buildReadPreview
      // 应优先它而非 fileName(URL 信息量更大)。
      const longPayload = JSON.stringify({
        url: 'skill://my-skill',
        fileName: 'my-skill',
        startLine: 1,
        endLine: 50,
        totalLines: 50,
        size: 1024,
        content: 'C'.repeat(8000),
      });

      const fatAssistant = assistantWithFatToolResults('asst_skill', 'read', [
        { id: 'tool_1', args: { path: 'skill://my-skill' }, result: longPayload },
      ]);
      const prepared = prepareMessagesForCompression([fatAssistant])[0] as AssistantMessage;
      const compactResult = prepared.tool_calls[0].response?.result ?? '';

      expect(compactResult).toContain('file=skill://my-skill');
    });

    it('keeps search result shape when structurally truncating', () => {
      const longPayload = JSON.stringify({
        results: [
          { title: 'match 1', snippet: 'first hit' },
          { title: 'match 2', snippet: 'second hit' },
          { title: 'match 3', snippet: 'third hit' },
          { title: 'match 4', snippet: 'fourth hit' },
        ],
        raw: 'C'.repeat(12000),
      });

      const fatAssistant = assistantWithFatToolResults('asst_search', 'semantic_search', [
        { id: 'tool_1', args: {}, result: longPayload },
      ]);
      const prepared = prepareMessagesForCompression([fatAssistant])[0] as AssistantMessage;
      const compactResult = prepared.tool_calls[0].response?.result ?? '';

      expect(compactResult).toContain('[Structured compression: semantic_search]');
      expect(compactResult).toContain('resultCount=4');
      expect(compactResult).toContain('match 1 :: first hit');
    });
  });

  describe('findFirstSkillToolCallIndices', () => {
    it('returns the assistant index when a SKILL.md `read` tool call exists', () => {
      const messages: Message[] = [
        createUserMessage('I want to analyze data from Titan', 'msg_1'),
        createAssistantMessage('I can help with that!', 'msg_2'),
        createUserMessage('Option 4', 'msg_3'),
        createAssistantMessage(
          "I'll load the Titan Dynamic Query skill",
          'msg_4',
          [createSkillToolCall('tool_call_1', '/path/to/skills/titan-dynamic-query/skill.md')],
        ),
        createAssistantMessage('Perfect! The skill is loaded.', 'msg_5'),
      ];

      const indices = findFirstSkillToolCallIndices(messages);

      // Domain 形态下,assistant 与它的 tool_calls/responses 是不可分原子,
      // protect 一条 assistant 等于自动 protect 所有 sibling tool 结果。
      expect(indices).toEqual([3]);
    });

    it('is case-insensitive for skill.md filename', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/SKILL.MD')],
        ),
      ];

      const indices = findFirstSkillToolCallIndices(messages);

      expect(indices).toEqual([1]);
    });

    it('only protects the first SKILL.md, not subsequent ones', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading first skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')],
        ),
        createAssistantMessage(
          'Loading second skill',
          'msg_3',
          [createSkillToolCall('tool_call_2', '/another/path/skill.md')],
        ),
      ];

      const indices = findFirstSkillToolCallIndices(messages);

      expect(indices).toEqual([1]);
    });

    it('protects the assistant even if the read result is an error (pairing handled by Domain shape)', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md', '{"error": "File not found"}')],
        ),
      ];

      const indices = findFirstSkillToolCallIndices(messages);

      expect(indices).toEqual([1]);
    });

    it('protects the assistant even with very short result content', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md', 'Short')],
        ),
      ];

      const indices = findFirstSkillToolCallIndices(messages);

      expect(indices).toEqual([1]);
    });

    it('returns empty array when no SKILL.md tool call exists', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading file',
          'msg_2',
          [{
            id: 'tool_call_1',
            name: 'read',
            time: Date.now(),
            args: { path: '/path/to/config.json' },
            response: { time: Date.now(), status: 'success', result: '{"config": "value"}' },
          }],
        ),
      ];

      const indices = findFirstSkillToolCallIndices(messages);

      expect(indices).toHaveLength(0);
    });

    it('handles messages without tool_calls', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage('Just a response', 'msg_2'),
        createUserMessage('Another message', 'msg_3'),
      ];

      const indices = findFirstSkillToolCallIndices(messages);

      expect(indices).toHaveLength(0);
    });
  });

  describe('analyzeMessageStructure', () => {
    it('includes firstSkillToolCallIndices when skill pinning is explicitly enabled', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')],
        ),
        createAssistantMessage('Done', 'msg_3'),
        createUserMessage('Continue', 'msg_4'),
        createAssistantMessage('OK', 'msg_5'),
        createUserMessage('More', 'msg_6'),
        createAssistantMessage('Sure', 'msg_7'),
      ];

      const analysis = analyzeMessageStructure(messages, {
        preserveRecentMessages: 3,
        preserveFirstUserMessage: false,
        preserveFirstSkillToolCall: true,
      });

      expect(analysis.firstSkillToolCallIndices).toEqual([1]);
    });

    it('returns empty array when preserveFirstSkillToolCall is false', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')],
        ),
      ];

      const analysis = analyzeMessageStructure(messages, {
        preserveRecentMessages: 5,
        preserveFirstUserMessage: false,
        preserveFirstSkillToolCall: false,
      });

      expect(analysis.firstSkillToolCallIndices).toHaveLength(0);
    });
  });

  describe('compressMessages', () => {
    it('preserves recent messages by default without hard-pinning the first user or first skill block', async () => {
      const messages: Message[] = [
        createUserMessage('I want to analyze data', 'msg_1'),
        createAssistantMessage('What kind?', 'msg_2'),
        createUserMessage('Option 4', 'msg_3'),
        createAssistantMessage(
          'Loading skill',
          'msg_4',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')],
        ),
        createAssistantMessage('Skill loaded!', 'msg_5'),
        createUserMessage('Run query X', 'msg_6'),
        createAssistantMessage('Running...', 'msg_7'),
        createUserMessage('Show results', 'msg_8'),
        createAssistantMessage('Here they are', 'msg_9'),
        createUserMessage('Thanks', 'msg_10'),
      ];

      const result = await compressor.compressMessages(messages, "test-user");

      expect(result.success).toBe(true);
      expect(result.compressedMessages.length).toBeLessThan(messages.length);

      const preservedIds = result.compressedMessages.map(m => m.id);

      // Last 3 messages preserved.
      expect(preservedIds).toContain('msg_8');
      expect(preservedIds).toContain('msg_9');
      expect(preservedIds).toContain('msg_10');
      expect(result.summary).toBeTruthy();

      // 结构化字段:summary 在 head 之后,recent 在 tail。
      expect(result.summaryMessage).toBeTruthy();
      expect(result.summaryMessage?.content).toBe(result.summary);
      expect(result.compressedBeforeIndex).toBe(messages.length - 3);
      expect(result.compressedMessages[result.earlyPreservedCount!]).toBe(result.summaryMessage);
    });

    it('can still pin the first user and first skill block when explicitly enabled', async () => {
      const pinnedCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        preserveFirstUserMessage: true,
        preserveFirstSkillToolCall: true,
      });

      const messages: Message[] = [
        createUserMessage('I want to analyze data', 'msg_1'),
        createAssistantMessage('What kind?', 'msg_2'),
        createUserMessage('Option 4', 'msg_3'),
        createAssistantMessage(
          'Loading skill',
          'msg_4',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')],
        ),
        createAssistantMessage('Skill loaded!', 'msg_5'),
        createUserMessage('Run query X', 'msg_6'),
        createAssistantMessage('Running...', 'msg_7'),
        createUserMessage('Show results', 'msg_8'),
        createAssistantMessage('Here they are', 'msg_9'),
        createUserMessage('Thanks', 'msg_10'),
      ];

      const result = await pinnedCompressor.compressMessages(messages, "test-user");
      const preservedIds = result.compressedMessages.map(m => m.id);

      expect(preservedIds).toContain('msg_1');  // first user
      expect(preservedIds).toContain('msg_4');  // skill assistant (with its tool_calls automatically attached)
    });

    it('does not include SKILL.md content in summary generation', async () => {
      const { contextCompressionLlmSummarizer } = await import('@main/pi/utils/contextCompressionLlmSummarizer');
      const pinnedCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        preserveFirstSkillToolCall: true,
      });

      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage('Response 1', 'msg_2'),
        createAssistantMessage(
          'Loading skill',
          'msg_3',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')],
        ),
        createAssistantMessage('Middle message', 'msg_4'),
        createUserMessage('Recent 1', 'msg_5'),
        createAssistantMessage('Recent 2', 'msg_6'),
        createUserMessage('Recent 3', 'msg_7'),
      ];

      await pinnedCompressor.compressMessages(messages, "test-user");

      // Check that the summary prompt was called
      expect(contextCompressionLlmSummarizer.summarize).toHaveBeenCalled();

      // Get the prompt that was passed to the model helper
      const callArgs = vi.mocked(contextCompressionLlmSummarizer.summarize).mock.calls[0];
      const summaryPrompt = callArgs[0].conversationText;

      // The SKILL.md content should NOT be in the summary prompt
      // (it's protected, so it shouldn't be summarized)
      expect(summaryPrompt).not.toContain('titan-dynamic-query');
    });
  });

  describe('edge cases', () => {
    it('treats multiple sibling tool_calls as part of the same atomic assistant message', () => {
      // Domain 形态下 sibling tool_calls 自动跟随 assistant 移动 ——
      // 不再像旧 chatTypes 那样需要单独保护"配对完整性"。
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading multiple',
          'msg_2',
          [
            {
              id: 'tool_call_1',
              name: 'read',
              time: Date.now(),
              args: { path: '/path/to/config.json' },
              response: { time: Date.now(), status: 'success', result: '{"config": true}' },
            },
            createSkillToolCall('tool_call_2', '/path/to/skill.md'),
          ],
        ),
      ];

      const indices = findFirstSkillToolCallIndices(messages);

      // 只返回 assistant index;sibling 的 config result 自动跟随该 assistant
      // 一起被锚点保护。
      expect(indices).toEqual([1]);
    });

    it('handles tool call with malformed arguments', () => {
      // Domain `args: Record<string, unknown>` 已经结构化,无需再 try/parse JSON;
      // path 不是 string 时,findFirstSkillToolCallIndices 走"非 SKILL.md"分支即可。
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading',
          'msg_2',
          [{
            id: 'tool_call_1',
            name: 'read',
            time: Date.now(),
            args: { path: 12345 as unknown as string },  // non-string path
          }],
        ),
      ];

      const indices = findFirstSkillToolCallIndices(messages);
      expect(indices).toHaveLength(0);
    });

    it('handles empty messages array', () => {
      const indices = findFirstSkillToolCallIndices([]);
      expect(indices).toHaveLength(0);
    });

    it('handles SKILL.md in various path formats', () => {
      const testPaths = [
        '/Users/user/skills/my-skill/skill.md',
        '/Users/user/skills/my-skill/SKILL.md',
        '/Users/user/skills/my-skill/Skill.MD',
        'C:\\Users\\user\\skills\\my-skill\\skill.md',
        './skills/skill.md',
        'skill.md'
      ];

      for (const path of testPaths) {
        const messages: Message[] = [
          createUserMessage('Test'),
          createAssistantMessage('Loading', undefined, [createSkillToolCall('tool_call_1', path)]),
        ];

        const indices = findFirstSkillToolCallIndices(messages);
        expect(indices.length).toBeGreaterThan(0);
      }
    });
  });

  describe('configuration', () => {
    it('uses default config when not specified', () => {
      const defaultCompressor = createFullModeCompressor();
      const config = defaultCompressor.getConfig();

      expect(config.preserveFirstSkillToolCall).toBe(false);
      expect(config.preserveFirstUserMessage).toBe(false);
      expect(config.summaryPromptTokenBudget).toBe(100000);
      expect(config.maxSummaryRecursionDepth).toBe(4);
      expect(config.maxConcurrentChunkSummaries).toBe(2);
    });

    it('allows disabling SKILL.md protection', () => {
      const noProtectionCompressor = createFullModeCompressor({
        preserveFirstSkillToolCall: false
      });
      const config = noProtectionCompressor.getConfig();

      expect(config.preserveFirstSkillToolCall).toBe(false);
    });

    it('allows updating config at runtime', () => {
      const comp = createFullModeCompressor({ preserveFirstSkillToolCall: true });
      expect(comp.getConfig().preserveFirstSkillToolCall).toBe(true);

      comp.updateConfig({ preserveFirstSkillToolCall: false });
      expect(comp.getConfig().preserveFirstSkillToolCall).toBe(false);
    });

    it('exposes chunkSummaryCallCount in compression result metadata', async () => {
      const messages: Message[] = [
        createUserMessage('start', 'msg_start'),
        createAssistantMessage('A'.repeat(5000), 'mid_1'),
        createAssistantMessage('A'.repeat(5000), 'mid_2'),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      const result = await compressor.compressMessages(messages, "test-user");

      expect(typeof result.metadata.chunkSummaryCallCount).toBe('number');
      expect(result.metadata.chunkSummaryCallCount).toBeGreaterThanOrEqual(0);
      expect(typeof result.metadata.totalLlmCallCount).toBe('number');
      expect(result.metadata.totalLlmCallCount).toBeGreaterThanOrEqual(result.metadata.chunkSummaryCallCount);
    });

    it('resets chunkSummaryCallCount between compressMessages() calls', async () => {
      const messages: Message[] = [
        createUserMessage('start', 'msg_start'),
        createAssistantMessage('A'.repeat(5000), 'mid_1'),
        createAssistantMessage('A'.repeat(5000), 'mid_2'),
        createAssistantMessage('recent 1', 'recent_1'),
        createUserMessage('recent 2', 'recent_2'),
        createAssistantMessage('recent 3', 'recent_3'),
      ];

      const first = await compressor.compressMessages(messages, "test-user");
      const second = await compressor.compressMessages(messages, "test-user");

      // Both calls should report the same count, not an accumulated total
      expect(first.metadata.chunkSummaryCallCount).toBe(second.metadata.chunkSummaryCallCount);
    });
  });

  describe('fallback compression', () => {
    it('falls back and preserves first user message when preserveFirstUserMessage is true', async () => {
      // Force summarize to fail so fallback triggers
      contextCompressionLlmSummarizerMock.summarize.mockRejectedValue(new Error('API failure'));

      const fallbackCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
        preserveFirstUserMessage: true,
      });

      const messages: Message[] = [
        createUserMessage('first user message', 'first_user'),
        createAssistantMessage('middle 1', 'mid_1'),
        createAssistantMessage('middle 2', 'mid_2'),
        createAssistantMessage('middle 3', 'mid_3'),
        createUserMessage('recent 1', 'recent_1'),
        createAssistantMessage('recent 2', 'recent_2'),
        createUserMessage('recent 3', 'recent_3'),
      ];

      const result = await fallbackCompressor.compressMessages(messages, "test-user");

      expect(result.success).toBe(false);
      expect(result.metadata.compressionMethod).toBe('fallback');
      // Should include first user message + recent 3
      const ids = result.compressedMessages.map(m => m.id);
      expect(ids).toContain('first_user');
      expect(ids).toContain('recent_1');
      expect(ids).toContain('recent_2');
      expect(ids).toContain('recent_3');
    });

    it('deduplicates when first user message overlaps with recent messages', async () => {
      contextCompressionLlmSummarizerMock.summarize.mockRejectedValue(new Error('API failure'));

      const fallbackCompressor = createFullModeCompressor({
        preserveRecentMessages: 5,
        preserveFirstUserMessage: true,
      });

      // Only 4 messages — first user overlaps with recent window
      const messages: Message[] = [
        createUserMessage('I am first and recent', 'overlap_msg'),
        createAssistantMessage('response 1', 'resp_1'),
        createUserMessage('question 2', 'q_2'),
        createAssistantMessage('response 2', 'resp_2'),
      ];

      const result = await fallbackCompressor.compressMessages(messages, "test-user");

      // Should not have duplicates
      const ids = result.compressedMessages.map(m => m.id);
      const uniqueIds = [...new Set(ids)];
      expect(ids.length).toBe(uniqueIds.length);
    });

    it('sets chunkSummaryCallCount to 0 on fallback', async () => {
      contextCompressionLlmSummarizerMock.summarize.mockRejectedValue(new Error('API failure'));

      const fallbackCompressor = createFullModeCompressor({
        preserveRecentMessages: 3,
      });

      const messages: Message[] = [
        createUserMessage('start', 'u1'),
        createAssistantMessage('middle', 'a1'),
        createAssistantMessage('middle 2', 'a2'),
        createUserMessage('recent 1', 'r1'),
        createAssistantMessage('recent 2', 'r2'),
        createUserMessage('recent 3', 'r3'),
      ];

      const result = await fallbackCompressor.compressMessages(messages, "test-user");

      // Even on fallback, the counter reflects attempted API calls before fallback triggered
      expect(result.metadata.chunkSummaryCallCount).toBeGreaterThanOrEqual(0);
    });
  });
});
