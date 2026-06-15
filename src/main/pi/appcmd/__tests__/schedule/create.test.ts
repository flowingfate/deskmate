/**
 * `schedule create` subcommand 测试 —— flag 校验 / dry-run / kernel 契约 /
 * JSON 输出。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetScheduleMocks, runSchedule, scheduleMocks } from './_fixture';

beforeEach(() => {
  resetScheduleMocks();
});

describe('schedule create', () => {
  it('缺 <name> → exit 2 + 提示去看 --help', async () => {
    const r = await runSchedule('create');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('missing required <name>');
    expect(scheduleMocks.createJobInternal).not.toHaveBeenCalled();
  });

  it('多余位置参数 → exit 2 + 提示用引号', async () => {
    // 注意:不能用字符串形态(空格会被切分);用数组传名字 + 多余参
    const r = await runSchedule(['create', 'foo', 'extra', '--message', 'm', '--cron', '0 * * * *']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('too many positional');
  });

  it('缺 --message → exit 2', async () => {
    const r = await runSchedule(['create', 'foo', '--cron', '0 * * * *']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--message <text> is required');
    expect(scheduleMocks.createJobInternal).not.toHaveBeenCalled();
  });

  it('happy path: cron 模式 → 透传给 kernel,默认 description 从 name 推导', async () => {
    scheduleMocks.createJobInternal.mockResolvedValue({
      success: true,
      job_id: 'j_abc',
      schedule_type: 'cron',
      message: 'Recurring schedule "morning" created. Cron: 0 6 * * *.',
    });

    const r = await runSchedule(['create', 'morning', '--cron', '0 6 * * *', '--message', 'Daily digest']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Recurring schedule "morning" created.');
    expect(r.stdout).toContain('job_id: j_abc');

    expect(scheduleMocks.createJobInternal).toHaveBeenCalledTimes(1);
    const [args, fallbackAgentId, opts] = scheduleMocks.createJobInternal.mock.calls[0];
    expect(args).toEqual({
      name: 'morning',
      description: 'Scheduled task: morning',
      message: 'Daily digest',
      cron_expression: '0 6 * * *',
      run_at: undefined,
      agent_id: undefined,
    });
    expect(fallbackAgentId).toBe('agent-test');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('happy path: --at 模式 → schedule_type=once', async () => {
    scheduleMocks.createJobInternal.mockResolvedValue({
      success: true,
      job_id: 'j_once',
      schedule_type: 'once',
      message: 'One-time schedule "reminder" created. Runs at 2026-03-10T08:00:00+08:00.',
    });

    const r = await runSchedule(['create', 'reminder', '--at', '2026-03-10T08:00:00+08:00', '--message', 'Rest']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('One-time schedule "reminder" created.');

    const [args] = scheduleMocks.createJobInternal.mock.calls[0];
    expect(args.run_at).toBe('2026-03-10T08:00:00+08:00');
    expect(args.cron_expression).toBeUndefined();
  });

  it('显式 --description 与 --agent 透传', async () => {
    scheduleMocks.createJobInternal.mockResolvedValue({
      success: true,
      job_id: 'j_x',
      schedule_type: 'cron',
      message: 'ok',
    });

    const r = await runSchedule([
      'create',
      'foo',
      '--cron', '0 * * * *',
      '--message', 'msg',
      '--description', 'custom desc',
      '--agent', 'a_other',
    ]);
    expect(r.exitCode).toBe(0);
    const [args] = scheduleMocks.createJobInternal.mock.calls[0];
    expect(args.description).toBe('custom desc');
    expect(args.agent_id).toBe('a_other');
  });

  it('kernel 返回 success=false → exit 1 + 透传 message', async () => {
    scheduleMocks.createJobInternal.mockResolvedValue({
      success: false,
      message: 'cron parse error: bad expression',
    });

    const r = await runSchedule(['create', 'foo', '--cron', 'BAD', '--message', 'm']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('cron parse error');
  });

  it('--json 成功 → 输出 envelope', async () => {
    scheduleMocks.createJobInternal.mockResolvedValue({
      success: true,
      job_id: 'j_json',
      schedule_type: 'cron',
      message: 'ok',
    });

    const r = await runSchedule(['create', 'foo', '--cron', '0 * * * *', '--message', 'm', '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.action).toBe('create');
    expect(parsed.job_id).toBe('j_json');
  });

  it('--json + success=false → exit 1 但 stdout 仍是 JSON', async () => {
    scheduleMocks.createJobInternal.mockResolvedValue({
      success: false,
      message: 'fail',
    });

    const r = await runSchedule(['create', 'foo', '--cron', '0 * * * *', '--message', 'm', '--json']);
    expect(r.exitCode).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.success).toBe(false);
  });

  describe('--dry-run', () => {
    it('cron 模式 → 不调 kernel,human 输出含 [dry-run]', async () => {
      const r = await runSchedule(['create', 'foo', '--cron', '0 6 * * *', '--message', 'msg', '--dry-run']);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('[dry-run]');
      expect(r.stdout).toContain('cron:    0 6 * * *');
      expect(r.stdout).toContain('Nothing was registered');
      expect(scheduleMocks.createJobInternal).not.toHaveBeenCalled();
    });

    it('--at 模式 → schedule_type=once 投影', async () => {
      const r = await runSchedule(['create', 'foo', '--at', '2026-04-01T08:00:00Z', '--message', 'msg', '--dry-run']);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('(once)');
      expect(r.stdout).toContain('at:      2026-04-01T08:00:00Z');
      expect(scheduleMocks.createJobInternal).not.toHaveBeenCalled();
    });

    it('--dry-run 同时给 --cron 和 --at → exit 2', async () => {
      const r = await runSchedule(['create', 'foo', '--cron', '0 * * * *', '--at', '2026-01-01T00:00:00Z', '--message', 'm', '--dry-run']);
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain('exactly one of --cron or --at');
      expect(scheduleMocks.createJobInternal).not.toHaveBeenCalled();
    });

    it('--dry-run --json 输出结构化', async () => {
      const r = await runSchedule(['create', 'foo', '--cron', '0 * * * *', '--message', 'msg', '--dry-run', '--json']);
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.action).toBe('create');
      expect(parsed.schedule.schedule_type).toBe('cron');
      expect(parsed.schedule.agent_id).toBe('agent-test');
    });

    it('--dry-run 截断过长 --message', async () => {
      const longMsg = 'x'.repeat(300);
      const r = await runSchedule(['create', 'foo', '--cron', '0 * * * *', '--message', longMsg, '--dry-run']);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('message: ' + 'x'.repeat(120) + '...');
    });
  });

  it('ctx.signal 透传给 kernel', async () => {
    scheduleMocks.createJobInternal.mockResolvedValue({ success: true, job_id: 'j', schedule_type: 'cron', message: 'ok' });
    const ac = new AbortController();
    await runSchedule(['create', 'foo', '--cron', '0 * * * *', '--message', 'm'], { signal: ac.signal });
    const opts = scheduleMocks.createJobInternal.mock.calls[0][2];
    expect(opts.signal).toBe(ac.signal);
  });
});
