/**
 * `schedule remove` subcommand 测试 —— 破坏性默认拒绝 + dry-run + JSON。
 *
 * 与 `mcp remove` 同纪律:不带 `--yes` 直接 exit 1 + 不调 kernel。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetScheduleMocks, runSchedule, scheduleMocks } from './_fixture';

beforeEach(() => {
  resetScheduleMocks();
});

/** remove 内部会先 listJobs 反查存在性,默认让它返回空。具体测里再覆写。 */
function mockListEmpty(): void {
  scheduleMocks.listJobsInternal.mockResolvedValue({ success: true, schedules: [] });
}

function mockListWith(jobId: string): void {
  scheduleMocks.listJobsInternal.mockResolvedValue({
    success: true,
    schedules: [
      {
        job_id: jobId,
        name: 'x',
        description: 'd',
        schedule_type: 'cron',
        cron_expression: '0 * * * *',
        message: 'm',
        agent_id: 'a',
        enabled: true,
        status: 'pending',
      },
    ],
  });
}

describe('schedule remove', () => {
  it('缺 <job-id> → exit 2', async () => {
    const r = await runSchedule('remove');
    expect(r.exitCode).toBe(2);
    expect(scheduleMocks.deleteJobInternal).not.toHaveBeenCalled();
  });

  it('不带 --yes → exit 1 + REFUSE + 不调 kernel', async () => {
    mockListWith('j_abc');

    const r = await runSchedule('remove j_abc');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('refusing without --yes');
    expect(r.stderr).toContain('"j_abc" was NOT removed');
    expect(scheduleMocks.deleteJobInternal).not.toHaveBeenCalled();
  });

  it('--yes 但 kernel 报 not found → exit 1', async () => {
    mockListEmpty();
    scheduleMocks.deleteJobInternal.mockResolvedValue({
      success: false,
      message: 'Schedule "j_abc" not found.',
    });

    const r = await runSchedule('remove j_abc --yes');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not found');
    // kernel 还是被调用了(由 kernel 报错),与 mcp remove 的"前置 existence
    // 反查 + 拒绝"不同;schedule 没有 profile.mcp.get 那样的同步接口,
    // existence 反查仅用于 dry-run 显示,真删走 kernel 自己的报错路径。
    expect(scheduleMocks.deleteJobInternal).toHaveBeenCalledWith(
      { job_id: 'j_abc' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('--yes + kernel 成功 → exit 0 + 透传 message', async () => {
    mockListWith('j_abc');
    scheduleMocks.deleteJobInternal.mockResolvedValue({
      success: true,
      message: 'Removed schedule "j_abc".',
    });

    const r = await runSchedule('remove j_abc --yes');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Removed schedule "j_abc".');
  });

  it('--yes --json 成功 → envelope', async () => {
    mockListWith('j_abc');
    scheduleMocks.deleteJobInternal.mockResolvedValue({ success: true, message: 'ok' });

    const r = await runSchedule('remove j_abc --yes --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.action).toBe('remove');
    expect(parsed.job_id).toBe('j_abc');
  });

  describe('--dry-run', () => {
    it('not found → 提示 nothing would be removed,exit 0', async () => {
      mockListEmpty();
      const r = await runSchedule('remove j_abc --dry-run');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('not found; nothing would be removed');
      expect(scheduleMocks.deleteJobInternal).not.toHaveBeenCalled();
    });

    it('found → 提示 would cancel,exit 0', async () => {
      mockListWith('j_abc');
      const r = await runSchedule('remove j_abc --dry-run');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('[dry-run]');
      expect(r.stdout).toContain('would cancel and delete');
      expect(scheduleMocks.deleteJobInternal).not.toHaveBeenCalled();
    });

    it('--dry-run --json + not found → wouldRemove=false', async () => {
      mockListEmpty();
      const r = await runSchedule('remove j_abc --dry-run --json');
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.wouldRemove).toBe(false);
    });

    it('--dry-run --json + found → wouldRemove=true', async () => {
      mockListWith('j_abc');
      const r = await runSchedule('remove j_abc --dry-run --json');
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.wouldRemove).toBe(true);
    });

    it('--dry-run 不依赖 --yes', async () => {
      mockListWith('j_abc');
      const r = await runSchedule('remove j_abc --dry-run');
      expect(r.exitCode).toBe(0);
    });
  });
});
