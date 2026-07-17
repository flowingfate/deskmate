import type { ProfileStore } from '@main/persist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCronWatchdog } from '../cronWatchdog';
import { SchedulerContext } from '../context';
import { SchedulerTaskRuntime } from '../taskRuntime';

vi.mock('node-cron', async () => ({
  schedule: vi.fn(() => ({
    stop: vi.fn(),
  })),
}));

vi.mock('../cronWatchdog', async () => ({
  runCronWatchdog: vi.fn(async (): Promise<void> => undefined),
}));

const cronJob = {
  id: 'job-cron',
  agentId: 'agent-1',
  name: 'Hourly task',
  description: '',
  enabled: true,
  message: 'Run the task',
  notifyOnCompletion: true,
  scheduleType: 'cron' as const,
  cronExpression: '0 * * * *',
};

describe('SchedulerTaskRuntime', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('restarts the watchdog after re-registering the only cron task', async () => {
    vi.useFakeTimers();
    const store: ProfileStore = Object.assign(Object.create(null), { id: 'p_test' });
    const context = new SchedulerContext(store);
    context.activate();
    const executeJob = vi.fn(async () => ({ success: true }));
    const runtime = new SchedulerTaskRuntime(context, executeJob);

    await runtime.registerJob(cronJob);
    runtime.startHeartbeat();
    runtime.unregisterTask(cronJob.id, 'update-job');
    await runtime.registerJob(cronJob);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(runCronWatchdog).toHaveBeenCalledTimes(1);
    runtime.stopHeartbeat();
  });
});
