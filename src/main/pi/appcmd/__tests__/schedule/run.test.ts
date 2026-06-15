/**
 * `schedule run` subcommand 测试 —— action 类命令,无 --dry-run、无 --yes。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetScheduleMocks, runSchedule, scheduleMocks } from './_fixture';

beforeEach(() => {
  resetScheduleMocks();
});

describe('schedule run', () => {
  it('缺 <job-id> → exit 2', async () => {
    const r = await runSchedule('run');
    expect(r.exitCode).toBe(2);
    expect(scheduleMocks.runJobNowInternal).not.toHaveBeenCalled();
  });

  it('happy path 含 chat_session_id → 输出 chat_session 行', async () => {
    scheduleMocks.runJobNowInternal.mockResolvedValue({
      success: true,
      message: 'Schedule "j_abc" triggered.',
      chat_session_id: 's_xyz',
    });

    const r = await runSchedule('run j_abc');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Schedule "j_abc" triggered.');
    expect(r.stdout).toContain('chat_session: s_xyz');

    expect(scheduleMocks.runJobNowInternal).toHaveBeenCalledWith(
      { job_id: 'j_abc' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('happy path 无 chat_session_id → 仅输出 message', async () => {
    scheduleMocks.runJobNowInternal.mockResolvedValue({
      success: true,
      message: 'Schedule "j_abc" triggered.',
    });
    const r = await runSchedule('run j_abc');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Schedule "j_abc" triggered.');
    expect(r.stdout).not.toContain('chat_session');
  });

  it('kernel success=false → exit 1', async () => {
    scheduleMocks.runJobNowInternal.mockResolvedValue({
      success: false,
      message: 'Only enabled schedules can be run manually.',
    });
    const r = await runSchedule('run j_abc');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Only enabled schedules can be run manually.');
  });

  it('--json 成功 → envelope', async () => {
    scheduleMocks.runJobNowInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      chat_session_id: 's_xyz',
    });
    const r = await runSchedule('run j_abc --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.action).toBe('run');
    expect(parsed.chat_session_id).toBe('s_xyz');
  });

  it('--json + success=false → exit 1 但 stdout 是 JSON', async () => {
    scheduleMocks.runJobNowInternal.mockResolvedValue({
      success: false,
      message: 'fail',
    });
    const r = await runSchedule('run j_abc --json');
    expect(r.exitCode).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.success).toBe(false);
  });

  it('ctx.signal 透传', async () => {
    scheduleMocks.runJobNowInternal.mockResolvedValue({ success: true, message: 'ok' });
    const ac = new AbortController();
    await runSchedule('run j_abc', { signal: ac.signal });
    const opts = scheduleMocks.runJobNowInternal.mock.calls[0][1];
    expect(opts.signal).toBe(ac.signal);
  });
});
