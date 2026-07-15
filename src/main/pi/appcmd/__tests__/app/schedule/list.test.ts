/**
 * `schedule list` subcommand 测试 —— human / JSON / agent 过滤 / 空 / 失败。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetScheduleMocks, runSchedule, scheduleMocks } from './_fixture';

beforeEach(() => {
  resetScheduleMocks();
});

describe('schedule list', () => {
  it('意外的位置参数 → exit 2', async () => {
    const r = await runSchedule('list extra');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unexpected positional');
    expect(scheduleMocks.listJobsInternal).not.toHaveBeenCalled();
  });

  it('空列表 → 友好提示,exit 0', async () => {
    scheduleMocks.listJobsInternal.mockResolvedValue({ success: true, schedules: [] });
    const r = await runSchedule('list');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No schedules registered.');
  });

  it('--agent 过滤透传给 kernel + 空列表提示带 agent 名', async () => {
    scheduleMocks.listJobsInternal.mockResolvedValue({ success: true, schedules: [] });
    const r = await runSchedule('list --agent a_abc');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No schedules for agent "a_abc".');

    const [args] = scheduleMocks.listJobsInternal.mock.calls[0];
    expect(args.agent_id).toBe('a_abc');
  });

  it('happy path human 输出:一行一 schedule,含 type/enabled/trigger/last-started', async () => {
    scheduleMocks.listJobsInternal.mockResolvedValue({
      success: true,
      schedules: [
        {
          job_id: 'j_a',
          name: 'morning',
          description: 'd',
          schedule_type: 'cron',
          cron_expression: '0 6 * * *',
          message: 'm',
          agent_id: 'a_test',
          enabled: true,
          last_started_at: '2026-03-09T06:00:00Z',
        },
        {
          job_id: 'j_b',
          name: 'reminder',
          description: 'd',
          schedule_type: 'once',
          run_at: '2026-03-10T08:00:00+08:00',
          message: 'm',
          agent_id: 'a_test',
          enabled: false,
        },
      ],
    });

    const r = await runSchedule('list');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Found 2 schedule(s):');
    expect(r.stdout).toContain('j_a  morning');
    expect(r.stdout).toContain('[cron/on]');
    expect(r.stdout).toContain('cron=0 6 * * *');
    expect(r.stdout).toContain('last=2026-03-09T06:00:00Z');
    expect(r.stdout).toContain('j_b  reminder');
    expect(r.stdout).toContain('[once/off]');
    expect(r.stdout).toContain('at=2026-03-10T08:00:00+08:00');
    expect(r.stdout).toContain('last=-');
  });

  it('--json 透传 schedule array;success=true → exit 0', async () => {
    scheduleMocks.listJobsInternal.mockResolvedValue({
      success: true,
      schedules: [
        {
          job_id: 'j_a',
          name: 'morning',
          description: 'd',
          schedule_type: 'cron',
          cron_expression: '0 6 * * *',
          message: 'm',
          agent_id: 'a_test',
          enabled: true,
        },
      ],
    });

    const r = await runSchedule('list --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.schedules).toHaveLength(1);
    expect(parsed.schedules[0].job_id).toBe('j_a');
  });

  it('kernel success=false → exit 1', async () => {
    scheduleMocks.listJobsInternal.mockResolvedValue({
      success: false,
      message: 'scheduler not initialized',
    });
    const r = await runSchedule('list');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('scheduler not initialized');
  });

  it('--json + success=false → exit 1 但 stdout 是 JSON', async () => {
    scheduleMocks.listJobsInternal.mockResolvedValue({
      success: false,
      message: 'oops',
    });
    const r = await runSchedule('list --json');
    expect(r.exitCode).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.success).toBe(false);
  });

  it('ctx.signal 透传给 kernel', async () => {
    scheduleMocks.listJobsInternal.mockResolvedValue({ success: true, schedules: [] });
    const ac = new AbortController();
    await runSchedule('list', { signal: ac.signal });
    const opts = scheduleMocks.listJobsInternal.mock.calls[0][1];
    expect(opts.signal).toBe(ac.signal);
  });
});
