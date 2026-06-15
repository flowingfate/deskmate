import { describe, expect, it } from 'vitest';
import type { CronScheduleJobFile, JobRunState, OnceScheduleJobFile } from '@shared/persist/types';
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

describe('toSchedulerJob: runState 状态机映射', () => {
  it('pending → status=pending, lastRunAt/lastFinishedAt undefined', () => {
    const sj = toSchedulerJob(cronFile(), { status: 'pending' });
    expect(sj.status).toBe('pending');
    expect(sj.lastRunAt).toBeUndefined();
    expect(sj.lastFinishedAt).toBeUndefined();
  });

  it('running → status=pending + lastRunAt=startedAt（旧 UI 兼容写法）', () => {
    const rs: JobRunState = { status: 'running', startedAt: '2026-06-04T01:00:00.000Z' };
    const sj = toSchedulerJob(cronFile(), rs);
    expect(sj.status).toBe('pending');
    expect(sj.lastRunAt).toBe('2026-06-04T01:00:00.000Z');
    expect(sj.lastFinishedAt).toBeUndefined();
  });

  it('completed → 全字段填齐', () => {
    const rs: JobRunState = {
      status: 'completed',
      startedAt: '2026-06-04T01:00:00.000Z',
      finishedAt: '2026-06-04T01:05:00.000Z',
    };
    const sj = toSchedulerJob(cronFile(), rs);
    expect(sj.status).toBe('completed');
    expect(sj.lastRunAt).toBe('2026-06-04T01:00:00.000Z');
    expect(sj.lastFinishedAt).toBe('2026-06-04T01:05:00.000Z');
  });

  it('failed → status=failed，error 字段不上抛旧 IPC', () => {
    const rs: JobRunState = {
      status: 'failed',
      startedAt: '2026-06-04T01:00:00.000Z',
      finishedAt: '2026-06-04T01:05:00.000Z',
      error: 'boom',
    };
    const sj = toSchedulerJob(cronFile(), rs);
    expect(sj.status).toBe('failed');
    expect(sj.lastFinishedAt).toBe('2026-06-04T01:05:00.000Z');
    // SchedulerJob 没有 error 字段
    expect((sj as unknown as { error?: unknown }).error).toBeUndefined();
  });
});

describe('toSchedulerJob: enabled=false + once + pending → 反推 expired', () => {
  it('once + enabled=false + pending → expired', () => {
    const sj = toSchedulerJob(onceFile({ enabled: false }), { status: 'pending' });
    expect(sj.status).toBe('expired');
    expect(sj.enabled).toBe(false);
  });

  it('cron + enabled=false 不反推 expired，留 pending', () => {
    const sj = toSchedulerJob(cronFile({ enabled: false }), { status: 'pending' });
    expect(sj.status).toBe('pending');
  });

  it('once + enabled=false + completed 不反推，保留 completed', () => {
    const sj = toSchedulerJob(onceFile({ enabled: false }), {
      status: 'completed',
      startedAt: 'a',
      finishedAt: 'b',
    });
    expect(sj.status).toBe('completed');
  });
});

describe('toSchedulerJob: 字段映射', () => {
  it('cron file → cronExpression 填，runAt 不填', () => {
    const sj = toSchedulerJob(cronFile(), { status: 'pending' });
    expect(sj.cronExpression).toBe('0 6 * * *');
    expect(sj.runAt).toBeUndefined();
  });

  it('once file → runAt 填，cronExpression 不填', () => {
    const sj = toSchedulerJob(onceFile(), { status: 'pending' });
    expect(sj.runAt).toBe('2026-06-10T12:00:00.000Z');
    expect(sj.cronExpression).toBeUndefined();
  });

  it('executedAt 永远 undefined', () => {
    const sj = toSchedulerJob(onceFile(), { status: 'pending' });
    expect(sj.executedAt).toBeUndefined();
  });

  it('notifyOnCompletion 默认 true', () => {
    const sj = toSchedulerJob(cronFile({ notifyOnCompletion: undefined }), { status: 'pending' });
    expect(sj.notifyOnCompletion).toBe(true);
  });
});

describe('toScheduleJobInput: 老 createJob 入参投射', () => {
  it('cron 分支 → kind=cron + cron 字段', () => {
    const input = toScheduleJobInput({
      id: 'ignored',
      description: 'd',
      name: 'n',
      scheduleType: 'cron',
      cronExpression: '*/5 * * * *',
      enabled: true,
      agentId: 'a_X',
      message: 'm',
      status: 'pending',
    });
    expect(input.scheduleType).toBe('cron');
    if (input.scheduleType === 'cron') expect(input.cron).toBe('*/5 * * * *');
    expect(input.name).toBe('n');
  });

  it('once 分支 → kind=once + runAt 字段', () => {
    const input = toScheduleJobInput({
      description: 'd',
      name: 'n',
      scheduleType: 'once',
      runAt: '2026-06-10T12:00:00.000Z',
      enabled: true,
      agentId: 'a_X',
      message: 'm',
      status: 'pending',
    });
    expect(input.scheduleType).toBe('once');
    if (input.scheduleType === 'once') expect(input.runAt).toBe('2026-06-10T12:00:00.000Z');
  });

  it('cron 缺 cronExpression → 抛错', () => {
    expect(() =>
      toScheduleJobInput({
        description: '', name: 'n', scheduleType: 'cron', enabled: true,
        agentId: 'a', message: 'm', status: 'pending',
      }),
    ).toThrow(/cronExpression required/);
  });

  it('once 缺 runAt → 抛错', () => {
    expect(() =>
      toScheduleJobInput({
        description: '', name: 'n', scheduleType: 'once', enabled: true,
        agentId: 'a', message: 'm', status: 'pending',
      }),
    ).toThrow(/runAt required/);
  });
});

describe('toPersistScheduleJobUpdate: updateJob 投射', () => {
  it('仅普通字段 → 不带 schedule', () => {
    const u = toPersistScheduleJobUpdate(cronFile(), { name: 'new', enabled: false });
    expect(u.name).toBe('new');
    expect(u.enabled).toBe(false);
    expect(u.schedule).toBeUndefined();
  });

  it('改 cronExpression → schedule kind=cron 带新值', () => {
    const u = toPersistScheduleJobUpdate(cronFile(), { cronExpression: '0 9 * * *' });
    expect(u.schedule).toEqual({ kind: 'cron', cron: '0 9 * * *' });
  });

  it('改 runAt（once→once）→ schedule kind=once 带新值', () => {
    const u = toPersistScheduleJobUpdate(onceFile(), { runAt: '2026-07-01T00:00:00.000Z' });
    expect(u.schedule).toEqual({ kind: 'once', runAt: '2026-07-01T00:00:00.000Z' });
  });

  it('cron → once 切换需要带 runAt', () => {
    expect(() =>
      toPersistScheduleJobUpdate(cronFile(), { scheduleType: 'once' }),
    ).toThrow(/runAt required/);
  });

  it('cron → once 切换 + runAt 一起给 → ok', () => {
    const u = toPersistScheduleJobUpdate(cronFile(), {
      scheduleType: 'once',
      runAt: '2026-07-01T00:00:00.000Z',
    });
    expect(u.schedule).toEqual({ kind: 'once', runAt: '2026-07-01T00:00:00.000Z' });
  });

  it('status / lastRunAt / executedAt 不在投射范围（runState 不允许外部 mutate）', () => {
    const u = toPersistScheduleJobUpdate(cronFile(), {
      name: 'n',
    } as Parameters<typeof toPersistScheduleJobUpdate>[1]);
    expect(u.name).toBe('n');
    expect(u.schedule).toBeUndefined();
  });
});
