import { describe, expect, it } from 'vitest';
import { settleWithConcurrency } from '../concurrency';

describe('settleWithConcurrency', () => {
  it('limits in-flight work while preserving input order', async () => {
    let active = 0;
    let peakActive = 0;

    const settled = await settleWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return value * 2;
    });

    expect(peakActive).toBe(2);
    expect(settled).toEqual([
      { status: 'fulfilled', value: 2 },
      { status: 'fulfilled', value: 4 },
      { status: 'fulfilled', value: 6 },
      { status: 'fulfilled', value: 8 },
      { status: 'fulfilled', value: 10 },
    ]);
  });

  it('starts queued work when any active worker finishes', async () => {
    const resolvers = new Map<number, () => void>();
    const started: number[] = [];
    const settled = settleWithConcurrency([1, 2, 3], 2, async (value) => {
      started.push(value);
      await new Promise<void>((resolve) => resolvers.set(value, resolve));
      return value;
    });

    await vi.waitFor(() => expect(started).toEqual([1, 2]));
    resolvers.get(2)?.();
    await vi.waitFor(() => expect(started).toEqual([1, 2, 3]));
    resolvers.get(1)?.();
    resolvers.get(3)?.();

    await expect(settled).resolves.toEqual([
      { status: 'fulfilled', value: 1 },
      { status: 'fulfilled', value: 2 },
      { status: 'fulfilled', value: 3 },
    ]);
  });

});
