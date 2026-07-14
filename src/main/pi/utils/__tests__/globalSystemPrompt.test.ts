import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getGlobalSystemPrompt } from '../globalSystemPrompt';

describe('getGlobalSystemPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays identical across wall-clock times and directs temporal queries to app time', () => {
    vi.setSystemTime(new Date('2026-07-13T00:00:00.000Z'));
    const first = getGlobalSystemPrompt();

    vi.setSystemTime(new Date('2026-07-14T12:34:56.789Z'));
    const second = getGlobalSystemPrompt();

    expect(second).toBe(first);
    expect(first).toContain('client-local sent timestamp');
    expect(first).toContain('app("time")');
    expect(first).not.toContain('Current time:');
  });
});
