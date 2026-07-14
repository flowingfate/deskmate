/**
 * Unit tests for ContextCompressionLlmSummarizer
 * Tests the real (non-mocked) static methods and verifies configuration constants.
 */

import { ContextCompressionLlmSummarizer } from '../contextCompressionLlmSummarizer';
import { TokenCounter } from '@main/lib/token';

// Mock utility completion to prevent real API calls
vi.mock('@main/pi/utils/utilityCompletion', () => ({
  runUtilityCompletion: vi.fn(),
}));

import { runUtilityCompletion } from '@main/pi/utils/utilityCompletion'
const mockRun = vi.mocked(runUtilityCompletion);

describe('ContextCompressionLlmSummarizer', () => {
  const tokenCounter = new TokenCounter({ enableCache: true, encoding: 'o200k_base' });

  describe('configuration constants', () => {
    it('uses claude-haiku-4.5 model', async () => {
      mockRun.mockResolvedValueOnce('test summary');

      await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'hello world',
        profileId: 'test-user',
        maxRetries: 1,
      });

      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          modelKey: 'github-copilot::claude-haiku-4.5',
          profileId: 'test-user',
          maxTokens: 16000,
          temperature: 0.3,
        }),
      );
    });

    it('passes MAX_TOKENS=16000 to runUtilityCompletion', async () => {
      mockRun.mockResolvedValueOnce('summary result');

      await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test content',
        profileId: 'test-user',
        maxRetries: 1,
      });

      const callArgs = mockRun.mock.calls[0][0];
      expect(callArgs.maxTokens).toBe(16000);
    });
  });

  describe('buildPrompt', () => {
    it('includes conversation text in the prompt', () => {
      const prompt = ContextCompressionLlmSummarizer.buildPrompt('my conversation content');
      expect(prompt).toContain('my conversation content');
    });

    it('includes the 8-section summary template', () => {
      const prompt = ContextCompressionLlmSummarizer.buildPrompt('test');
      expect(prompt).toContain('Conversation Overview');
      expect(prompt).toContain('Resource Foundation');
      expect(prompt).toContain('Continuation Plan');
    });

    it('returns empty prompt content when given empty string', () => {
      const prompt = ContextCompressionLlmSummarizer.buildPrompt('');
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0); // template still present
    });
  });

  describe('getPromptOverheadTokens', () => {
    it('returns a positive number representing fixed prompt overhead', () => {
      const overhead = ContextCompressionLlmSummarizer.getPromptOverheadTokens(tokenCounter);
      expect(overhead).toBeGreaterThan(0);
      // Template + system prompt should be at least a few hundred tokens
      expect(overhead).toBeGreaterThan(200);
    });

    it('overhead is less than summaryPromptTokenBudget (100K)', () => {
      const overhead = ContextCompressionLlmSummarizer.getPromptOverheadTokens(tokenCounter);
      expect(overhead).toBeLessThan(100000);
    });

    it('estimateRequestTokens grows with conversation text length', () => {
      const shortEstimate = ContextCompressionLlmSummarizer.estimateRequestTokens(tokenCounter, 'short');
      const longEstimate = ContextCompressionLlmSummarizer.estimateRequestTokens(tokenCounter, 'a'.repeat(10000));
      expect(longEstimate).toBeGreaterThan(shortEstimate);
    });
  });

  describe('summarize — retry and error handling', () => {
    beforeEach(() => {
      mockRun.mockReset();
    });

    it('returns success on first attempt when API succeeds', async () => {
      mockRun.mockResolvedValueOnce('Generated summary');

      const result = await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test',
        profileId: 'test-user',
        maxRetries: 3,
      });

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Generated summary');
      expect(result.attempts).toBe(1);
    });

    it('retries on failure and succeeds on second attempt', async () => {
      mockRun
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce('Recovered summary');

      const result = await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test',
        profileId: 'test-user',
        maxRetries: 3,
      });

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Recovered summary');
      expect(result.attempts).toBe(2);
    });

    it('returns failure after exhausting all retries', async () => {
      mockRun.mockRejectedValue(new Error('Persistent failure'));

      const result = await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test',
        profileId: 'test-user',
        maxRetries: 2,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(2);
      expect(result.error).toContain('Persistent failure');
    });

    it('treats empty response as error and retries', async () => {
      mockRun
        .mockResolvedValueOnce('   ')  // whitespace-only = empty after trim
        .mockResolvedValueOnce('Valid summary');

      const result = await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test',
        profileId: 'test-user',
        maxRetries: 2,
      });

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Valid summary');
      expect(result.attempts).toBe(2);
    });

    it('respects maxRetries=1 with no retry', async () => {
      mockRun.mockRejectedValueOnce(new Error('fail'));

      const result = await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test',
        profileId: 'test-user',
        maxRetries: 1,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(mockRun).toHaveBeenCalledTimes(1);
    });
  });
});
