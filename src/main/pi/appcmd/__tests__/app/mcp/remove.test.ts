/**
 * `mcp remove` subcommand 测试 —— 破坏性默认拒绝是核心契约。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { mcpMocks, resetMcpMocks, runMcp } from './_fixture';

beforeEach(() => {
  resetMcpMocks();
});

describe('mcp remove', () => {
  it('缺 <name> → exit 2', async () => {
    const r = await runMcp('remove');
    expect(r.exitCode).toBe(2);
    expect(mcpMocks.mcpDelete).not.toHaveBeenCalled();
  });

  it('不带 --yes → exit 1 + REFUSE + 不调 delete', async () => {
    mcpMocks.profileMcpGet.mockReturnValue({ name: 'brave' });

    const r = await runMcp('remove brave');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('refusing without --yes');
    expect(r.stderr).toContain('"brave" was NOT removed');
    expect(mcpMocks.mcpDelete).not.toHaveBeenCalled();
  });

  it('--yes 但 server 不存在 → exit 1', async () => {
    mcpMocks.profileMcpGet.mockReturnValue(undefined);
    const r = await runMcp('remove brave --yes');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not installed');
    expect(mcpMocks.mcpDelete).not.toHaveBeenCalled();
  });

  it('--yes + 已安装 → 调 mcpClientManager.delete + exit 0', async () => {
    mcpMocks.profileMcpGet.mockReturnValue({ name: 'brave' });
    mcpMocks.mcpDelete.mockResolvedValue(undefined);

    const r = await runMcp('remove brave --yes');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Removed MCP server "brave"');
    expect(mcpMocks.mcpDelete).toHaveBeenCalledWith('brave');
  });

  it('delete 抛错 → exit 1 + 透传 message', async () => {
    mcpMocks.profileMcpGet.mockReturnValue({ name: 'brave' });
    mcpMocks.mcpDelete.mockRejectedValue(new Error('disk full'));

    const r = await runMcp('remove brave --yes');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('disk full');
  });

  it('--dry-run 不需要 --yes,已安装 → 提示 would remove', async () => {
    mcpMocks.profileMcpGet.mockReturnValue({ name: 'brave' });

    const r = await runMcp('remove brave --dry-run');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('[dry-run]');
    expect(r.stdout).toContain('would disconnect and delete');
    expect(mcpMocks.mcpDelete).not.toHaveBeenCalled();
  });

  it('--dry-run 未安装 → 提示 nothing would be removed,exit 0', async () => {
    mcpMocks.profileMcpGet.mockReturnValue(undefined);
    const r = await runMcp('remove brave --dry-run');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('NOT installed');
    expect(mcpMocks.mcpDelete).not.toHaveBeenCalled();
  });

  it('--dry-run --json 输出结构化', async () => {
    mcpMocks.profileMcpGet.mockReturnValue({ name: 'brave' });

    const r = await runMcp('remove brave --dry-run --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.wouldRemove).toBe(true);
    expect(parsed.name).toBe('brave');
  });

  it('--yes --json 成功时输出 success envelope', async () => {
    mcpMocks.profileMcpGet.mockReturnValue({ name: 'brave' });
    mcpMocks.mcpDelete.mockResolvedValue(undefined);

    const r = await runMcp('remove brave --yes --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.action).toBe('remove');
    expect(parsed.name).toBe('brave');
  });
});
