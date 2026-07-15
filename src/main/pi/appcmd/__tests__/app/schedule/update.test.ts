/**
 * `schedule update` subcommand 测试 —— job_id 校验 / 字段无给 / enabled
 * 三态 / schedule_type / dry-run / JSON。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetScheduleMocks, runSchedule, scheduleMocks } from './_fixture';

beforeEach(() => {
  resetScheduleMocks();
});

describe('schedule update', () => {
  it('缺 <job-id> → exit 2', async () => {
    const r = await runSchedule('update --name foo');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('expected exactly one positional <job-id>');
    expect(scheduleMocks.updateJobInternal).not.toHaveBeenCalled();
  });

  it('没有任何 --* 字段 → exit 2', async () => {
    const r = await runSchedule('update j_abc');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('no fields to update');
    expect(scheduleMocks.updateJobInternal).not.toHaveBeenCalled();
  });

  it('happy path: --message → 透传给 kernel', async () => {
    scheduleMocks.updateJobInternal.mockResolvedValue({
      success: true,
      message: 'Schedule updated.',
      job: undefined,
    });
    const r = await runSchedule(['update', 'j_abc', '--message', 'new prompt']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Schedule updated.');

    const [args, opts] = scheduleMocks.updateJobInternal.mock.calls[0];
    expect(args.job_id).toBe('j_abc');
    expect(args.message).toBe('new prompt');
    expect(args.name).toBeUndefined();
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  describe('--enabled', () => {
    it('--enabled true → 布尔 true', async () => {
      scheduleMocks.updateJobInternal.mockResolvedValue({ success: true, message: 'ok' });
      await runSchedule('update j_abc --enabled true');
      const [args] = scheduleMocks.updateJobInternal.mock.calls[0];
      expect(args.enabled).toBe(true);
    });

    it('--enabled false → 布尔 false(三态!)', async () => {
      scheduleMocks.updateJobInternal.mockResolvedValue({ success: true, message: 'ok' });
      await runSchedule('update j_abc --enabled false');
      const [args] = scheduleMocks.updateJobInternal.mock.calls[0];
      expect(args.enabled).toBe(false);
    });

    it('--enabled 非法值 → exit 2', async () => {
      const r = await runSchedule('update j_abc --enabled maybe');
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain('--enabled must be "true" or "false"');
      expect(scheduleMocks.updateJobInternal).not.toHaveBeenCalled();
    });
  });

  describe('--schedule-type', () => {
    it('--schedule-type cron 单独给 → 透传', async () => {
      scheduleMocks.updateJobInternal.mockResolvedValue({ success: true, message: 'ok' });
      await runSchedule('update j_abc --schedule-type cron');
      const [args] = scheduleMocks.updateJobInternal.mock.calls[0];
      expect(args.schedule_type).toBe('cron');
    });

    it('--schedule-type 非法值 → exit 2', async () => {
      const r = await runSchedule('update j_abc --schedule-type weekly');
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain('--schedule-type must be "cron" or "once"');
    });
  });

  it('显式 --cron → 透传(切换类型由 kernel 处理)', async () => {
    scheduleMocks.updateJobInternal.mockResolvedValue({ success: true, message: 'ok' });
    await runSchedule(['update', 'j_abc', '--cron', '0 9 * * 1-5']);
    const [args] = scheduleMocks.updateJobInternal.mock.calls[0];
    expect(args.cron_expression).toBe('0 9 * * 1-5');
  });

  it('kernel success=false → exit 1', async () => {
    scheduleMocks.updateJobInternal.mockResolvedValue({
      success: false,
      message: 'job not found',
    });
    const r = await runSchedule('update j_xxx --name new');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('job not found');
  });

  it('--json 成功 → envelope,含 job 投影', async () => {
    scheduleMocks.updateJobInternal.mockResolvedValue({
      success: true,
      message: 'Schedule updated.',
      job: {
        job_id: 'j_abc',
        name: 'morning',
        description: 'd',
        schedule_type: 'cron',
        cron_expression: '0 6 * * *',
        message: 'm',
        agent_id: 'a',
        enabled: true,
      },
    });
    const r = await runSchedule('update j_abc --name morning --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.action).toBe('update');
    expect(parsed.job.job_id).toBe('j_abc');
  });

  describe('--dry-run', () => {
    it('不调 kernel,输出 would-update 行', async () => {
      const r = await runSchedule('update j_abc --name new --enabled false --dry-run');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('[dry-run]');
      expect(r.stdout).toContain('name');
      expect(r.stdout).toContain('→ new');
      expect(r.stdout).toContain('enabled');
      expect(r.stdout).toContain('→ false');
      expect(scheduleMocks.updateJobInternal).not.toHaveBeenCalled();
    });

    it('--dry-run --json → JSON envelope', async () => {
      const r = await runSchedule('update j_abc --message hi --dry-run --json');
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.action).toBe('update');
      expect(parsed.updates.job_id).toBe('j_abc');
      expect(parsed.updates.message).toBe('hi');
    });

    it('--dry-run 但仍 0 字段 → exit 2(早期校验,不到达 dry-run 分支)', async () => {
      const r = await runSchedule('update j_abc --dry-run');
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain('no fields to update');
    });
  });

  it('ctx.signal 透传', async () => {
    scheduleMocks.updateJobInternal.mockResolvedValue({ success: true, message: 'ok' });
    const ac = new AbortController();
    await runSchedule('update j_abc --name foo', { signal: ac.signal });
    const opts = scheduleMocks.updateJobInternal.mock.calls[0][1];
    expect(opts.signal).toBe(ac.signal);
  });
});
