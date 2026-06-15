import { describe, it, expect } from 'vitest';
import { classifyError } from '../errors';

describe('classifyError - overflow', () => {
  const cases: Array<[string, string]> = [
    ['anthropic', 'prompt is too long: 250000 tokens > 200000 maximum'],
    ['anthropic-tokens', 'prompt token count (250000) exceeds the limit'],
    ['openai-context-length', 'This model has a maximum context length of 128000 tokens'],
    ['openai-maximum-context', 'maximum context length is 128000'],
    ['openai-context-length-2', 'context length exceeded'],
    ['openai-too-many', 'too many tokens in the request'],
    ['generic-exceeds', 'tokens exceeds the limit'],
    ['openai-request-too-large', 'Request too large for gpt-4'],
    ['openai-responses', 'maximum context length is 1048576 tokens'],
  ];
  for (const [name, msg] of cases) {
    it(`detects ${name}`, () => {
      expect(classifyError(new Error(msg))).toBe('overflow');
    });
  }

  it('accepts plain string error', () => {
    expect(classifyError('prompt is too long')).toBe('overflow');
  });

  it('accepts pi-style { errorMessage } object', () => {
    expect(classifyError({ errorMessage: 'prompt is too long' })).toBe('overflow');
  });
});

describe('classifyError - auth', () => {
  it.each([
    'Unauthorized',
    'Invalid API key provided',
    'Token expired',
    'Authentication failed',
  ])('detects %s', (msg) => {
    expect(classifyError(new Error(msg))).toBe('auth');
  });
});

describe('classifyError - rateLimit', () => {
  it.each([
    'Rate limit reached',
    'Too many requests',
    'You exceeded your current quota',
  ])('detects %s', (msg) => {
    expect(classifyError(new Error(msg))).toBe('rateLimit');
  });
});

describe('classifyError - network', () => {
  it.each([
    'fetch failed',
    'ECONNRESET',
    'ETIMEDOUT',
    'socket hang up',
  ])('detects %s', (msg) => {
    expect(classifyError(new Error(msg))).toBe('network');
  });
});

describe('classifyError - other / edge cases', () => {
  it('returns other for unknown', () => {
    expect(classifyError(new Error('something unrelated'))).toBe('other');
  });
  it('returns other for null/undefined', () => {
    expect(classifyError(null)).toBe('other');
    expect(classifyError(undefined)).toBe('other');
  });
  it('returns other for empty string', () => {
    expect(classifyError('')).toBe('other');
  });
});
