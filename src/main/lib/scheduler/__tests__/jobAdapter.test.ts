import { describe, expect, it } from 'vitest';
import type { CronScheduleJobFile, OnceScheduleJobFile } from '@shared/persist/types';
import {
  toPersistScheduleJobUpdate,
  toScheduleJobInput,
  toSchedulerJob,
} from '../jobAdapter';

function cronFile(over: Partial<CronScheduleJobFile> = {}): CronScheduleJobFile {
  return {
    version: 1,
    id: 'j_TEST',
    agentId: 'a_TEST',
    name: 'daily',
    message: 'do it',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scheduleType: 'cron',
    cron: '0 6 * * *',
    ...over,
  };
}

function onceFile(over: Partial<OnceScheduleJobFile> = {}): OnceScheduleJobFile {
  return {
    version: 1,
    id: 'j_TEST',
    agentId: 'a_TEST',
    name: 'remind',
    message: 'hey',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scheduleType: 'once',
    runAt: '2026-06-10T12:00:00.000Z',
    ...over,
  };
}

describe('toSchedulerJob', () => {
  it('projects a cron job and its latest run start time', () => {
    const job = toSchedulerJob(cronFile(), {
      status: 'completed',
      startedAt: '2026-06-04T01:00:00.000Z',
      finishedAt: '2026-06-04T01:05:00.000Z',
    });

    expect(job).toMatchObject({
      scheduleType: 'cron',
      cronExpression: '0 6 * * *',
      lastStartedAt: '2026-06-04T01:00:00.000Z',
      notifyOnCompletion: true,
    });
  });

  it('projects a one-time job as the matching discriminated branch', () => {
    const job = toSchedulerJob(onceFile(), { status: 'pending' });

    expect(job).toMatchObject({
      scheduleType: 'once',
      runAt: '2026-06-10T12:00:00.000Z',
    });
    expect(job.lastStartedAt).toBeUndefined();
  });
});

describe('toScheduleJobInput', () => {
  it('maps a cron create request to the persist cron branch', () => {
    const input = toScheduleJobInput({
      description: 'd',
      name: 'n',
      scheduleType: 'cron',
      cronExpression: '*/5 * * * *',
      enabled: true,
      agentId: 'a_X',
      message: 'm',
      notifyOnCompletion: true,
    });

    expect(input).toMatchObject({ scheduleType: 'cron', cron: '*/5 * * * *', name: 'n' });
  });

  it('maps a one-time create request to the persist once branch', () => {
    const input = toScheduleJobInput({
      description: 'd',
      name: 'n',
      scheduleType: 'once',
      runAt: '2026-06-10T12:00:00.000Z',
      enabled: true,
      agentId: 'a_X',
      message: 'm',
      notifyOnCompletion: true,
    });

    expect(input).toMatchObject({ scheduleType: 'once', runAt: '2026-06-10T12:00:00.000Z', name: 'n' });
  });

  it('rejects invalid cron and one-time values before persistence', () => {
    expect(() => toScheduleJobInput({
      name: 'invalid cron', description: '', message: 'do it', enabled: true, notifyOnCompletion: true,
      agentId: 'a_TEST', scheduleType: 'cron', cronExpression: 'not a cron expression',
    })).toThrow('Invalid cron expression');
    expect(() => toScheduleJobInput({
      name: 'invalid once', description: '', message: 'do it', enabled: true, notifyOnCompletion: true,
      agentId: 'a_TEST', scheduleType: 'once', runAt: 'not-a-date',
    })).toThrow('Invalid one-time schedule time');
  });
});

describe('toPersistScheduleJobUpdate', () => {
  it('maps ordinary fields without replacing the schedule', () => {
    const update = toPersistScheduleJobUpdate({ name: 'new', enabled: false });

    expect(update).toEqual({ name: 'new', enabled: false });
  });

  it('replaces a cron schedule atomically', () => {
    const update = toPersistScheduleJobUpdate({
      scheduleType: 'cron',
      cronExpression: '0 9 * * *',
    });

    expect(update.schedule).toEqual({ kind: 'cron', cron: '0 9 * * *' });
  });

  it('replaces a one-time schedule atomically', () => {
    const update = toPersistScheduleJobUpdate({
      scheduleType: 'once',
      runAt: '2026-07-01T00:00:00.000Z',
    });

    expect(update.schedule).toEqual({ kind: 'once', runAt: '2026-07-01T00:00:00.000Z' });
  });
});
