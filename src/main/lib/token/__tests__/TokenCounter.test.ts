import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../calculators/TextTokenCalculator', () => {
  class TextTokenCalculator {
    countTokens(text: string) { return text.length; }
  }
  return { TextTokenCalculator };
});

vi.mock('../calculators/ImageTokenCalculator', () => {
  class ImageTokenCalculator {
    calculateTokens() { return { tokens: 100 }; }
    calculateFromAttachment() { return { tokens: 100 }; }
  }
  return { ImageTokenCalculator };
});

vi.mock('../calculators/ToolsTokenCalculator', () => {
  class ToolsTokenCalculator {
    calculateAllToolsTokens() { return { totalTokens: 0, tools: [] }; }
  }
  return { ToolsTokenCalculator };
});

import { TokenCounter } from '../TokenCounter';
import { type Message,
type UserMessage,
type AssistantMessage,
type Attachment,
type ToolCall,
asFileUri, } from '@shared/persist/types'

function makeUser(overrides: Partial<UserMessage> = {}): UserMessage {
  return {
    role: 'user',
    id: 'u-1',
    time: 0,
    content: 'hi',
    attachments: [],
    ...overrides,
  };
}

function makeAssistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    id: 'a-1',
    time: 0,
    think: '',
    content: 'hi',
    tool_calls: [],
    ...overrides,
  };
}

describe('TokenCounter', () => {
  let counter: TokenCounter;

  beforeEach(() => {
    counter = new TokenCounter();
  });

  describe('countMessagesTokens', () => {
    it('returns 3 for an empty message array (BASE_TOKENS_PER_COMPLETION overhead)', () => {
      expect(counter.countMessagesTokens([])).toBe(3);
    });

    it('adds +3 completion overhead on top of individual message tokens', () => {
      // text "hello" has length 5 → textCalculator returns 5
      // countMessageTokens = 3 (BASE_TOKENS_PER_MESSAGE) + 5 = 8
      // countMessagesTokens = 3 (BASE_TOKENS_PER_COMPLETION) + 8 = 11
      const message = makeUser({ content: 'hello' });
      expect(counter.countMessagesTokens([message])).toBe(11);
    });

    it('sums tokens for multiple messages plus +3 completion overhead', () => {
      // Each user message: 3 + content.length
      // "hi" (2) → 5 tokens per message
      // Two messages: 5 + 5 = 10, plus 3 = 13
      const msg1 = makeUser({ content: 'hi' });
      const msg2 = makeUser({ content: 'hi' });
      expect(counter.countMessagesTokens([msg1, msg2])).toBe(13);
    });
  });

  describe('countMessageTokens', () => {
    it('adds +3 (BASE_TOKENS_PER_MESSAGE) to text content tokens for user', () => {
      // "hello" length = 5, so total = 3 + 5 = 8
      const message = makeUser({ content: 'hello' });
      expect(counter.countMessageTokens(message)).toBe(8);
    });

    it('handles empty content — returns only BASE_TOKENS_PER_MESSAGE', () => {
      const message = makeUser({ content: '' });
      expect(counter.countMessageTokens(message)).toBe(3);
    });

    it('adds image-attachment tokens for user role (one per image attachment)', () => {
      // mock calculateFromAttachment returns 100 per image attachment.
      // content "ok" → 2; total = 3 + 2 + 100 = 105
      const image: Attachment = {
        kind: 'image',
        fileName: 'a.png',
        fileSize: 1024,
        mimeType: 'image/png',
        source: { kind: 'dataUrl', data: 'BASE64' },
        width: 100,
        height: 100,
        detail: 'high',
      };
      const message = makeUser({ content: 'ok', attachments: [image] });
      expect(counter.countMessageTokens(message)).toBe(3 + 2 + 100);
    });

    it('skips non-image attachments for user role (file/office/opaque are inlined into content)', () => {
      // file attachment must NOT add image tokens; total = 3 + 2 (= "ok")
      const file: Attachment = {
        kind: 'text',
        fileName: 'a.txt',
        fileSize: 10,
        mimeType: 'text/plain',
        fileUri: asFileUri('local://a.txt'),
      };
      const message = makeUser({ content: 'ok', attachments: [file] });
      expect(counter.countMessageTokens(message)).toBe(3 + 2);
    });

    it('counts assistant content + think text tokens', () => {
      // content "ok" (2) + think "deep" (4) → 3 + 2 + 4 = 9
      const message = makeAssistant({ content: 'ok', think: 'deep' });
      expect(counter.countMessageTokens(message)).toBe(3 + 2 + 4);
    });

    it('applies ×1.5 safety margin (ceiling) to tool_calls tokens for assistant messages', () => {
      // Domain ToolCall shape: { id, name, time, args, response? }.
      // JSON.stringify on this shape yields a different length than the chatTypes
      // wrapper, so derive the expected count from the actual stringified payload
      // rather than hard-coding a number.
      const toolCall: ToolCall = { id: 'tc1', name: 'foo', time: 0, args: {} };
      const jsonLen = JSON.stringify(toolCall).length;
      const expectedToolTokens = Math.ceil(jsonLen * 1.5);
      const message = makeAssistant({
        content: 'ok',
        think: '',
        tool_calls: [toolCall],
      });
      // 3 (base) + 2 (content "ok") + 0 (empty think) + expectedToolTokens
      expect(counter.countMessageTokens(message)).toBe(3 + 2 + expectedToolTokens);
    });

    it('tool_calls overhead exceeds bare text+base for assistant (sanity check)', () => {
      // Independent of exact JSON shape: a tool call MUST add some non-zero overhead
      // beyond `BASE_TOKENS_PER_MESSAGE + content text`.
      const toolCall: ToolCall = { id: 'tc1', name: 'foo', time: 0, args: { a: 1 } };
      const message = makeAssistant({
        content: 'ok',
        think: '',
        tool_calls: [toolCall],
      });
      expect(counter.countMessageTokens(message)).toBeGreaterThan(3 + 2);
    });

    it('user messages never trigger tool_calls accounting (no tool_calls field on UserMessage)', () => {
      // Pure structural assertion: a user message with no attachments and "ok"
      // content is exactly 3 + 2 = 5, regardless of any assistant-only branching.
      const message = makeUser({ content: 'ok' });
      expect(counter.countMessageTokens(message)).toBe(5);
    });

    it('assistant with empty tool_calls behaves like plain text', () => {
      // 3 (base) + 2 ("ok") + 0 (think "") + 0 (no tool_calls) = 5
      const message = makeAssistant({ content: 'ok', think: '', tool_calls: [] });
      expect(counter.countMessageTokens(message)).toBe(5);
    });

    it('discriminates by role — same content yields same base+text contribution for user and assistant (no tool_calls, no think)', () => {
      const userMsg: Message = makeUser({ content: 'hello' });
      const asstMsg: Message = makeAssistant({ content: 'hello', think: '', tool_calls: [] });
      // user: 3 + 5 = 8;  assistant: 3 + 5 + 0 + 0 = 8
      expect(counter.countMessageTokens(userMsg)).toBe(8);
      expect(counter.countMessageTokens(asstMsg)).toBe(8);
    });
  });
});
