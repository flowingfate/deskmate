/**
 * `mcp` 顶层路由 + `--help` / 未知 subcommand 行为 + `update` / `add` 等其它
 * subcommand 的最少 happy path 测试。
 *
 * 把所有"路由层"测试集中在一个文件,避免把 install/remove/status/connection
 * 之外的小 case 散布到多个文件。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { appCommands } from '@main/pi/appcmd/registry';

import { mcpMocks, resetMcpMocks, runMcp } from './_fixture';

beforeEach(() => {
  resetMcpMocks();
});

describe('mcp 顶层路由', () => {
  it('注册到全局 appCommands', () => {
    expect(appCommands.has('mcp')).toBe(true);
  });

  it('空 sub → 顶层 help', async () => {
    const r = await runMcp('');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout).toContain('mcp <subcommand>');
    expect(r.stdout).toContain('install');
    expect(r.stdout).toContain('remove');
  });

  it('`mcp --help` → 顶层 help', async () => {
    const r = await runMcp('--help');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('SUBCOMMANDS');
  });

  it('`mcp -h` → 顶层 help', async () => {
    const r = await runMcp('-h');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('SUBCOMMANDS');
  });

  it('未知 subcommand → exit 2 + hint', async () => {
    const r = await runMcp('bogus-sub');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown subcommand "bogus-sub"');
    expect(r.stderr).toContain('mcp --help');
  });

  it.each([
    'add',
    'update',
    'remove',
    'connect',
    'disconnect',
    'reconnect',
    'status',
  ])('`mcp %s --help` 展示 subcommand help,exit 0,不动 manager', async (sub) => {
    const r = await runMcp(`${sub} --help`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout).toContain(sub);
    expect(mcpMocks.mcpDelete).not.toHaveBeenCalled();
    expect(mcpMocks.mcpConnect).not.toHaveBeenCalled();
    expect(mcpMocks.createServerInternal).not.toHaveBeenCalled();
  });
});

describe('mcp add', () => {
  it('缺 --transport → exit 2', async () => {
    const r = await runMcp('add my-srv');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--transport is required');
  });

  it('--transport stdio 但缺 --command → exit 2', async () => {
    const r = await runMcp('add my-srv --transport stdio');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--command is required');
  });

  it('--transport sse 但缺 --url → exit 2', async () => {
    const r = await runMcp('add my-srv --transport sse');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--url is required');
  });

  it('--transport 非法值 → exit 2', async () => {
    const r = await runMcp('add my-srv --transport weird');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('invalid --transport');
  });

  it('happy path: stdio + --command + --arg ×2', async () => {
    mcpMocks.createServerInternal.mockResolvedValue({
      success: true,
      message: 'created',
    });

    const r = await runMcp([
      'add',
      'my-srv',
      '--transport',
      'stdio',
      '--command',
      'npx',
      '--arg',
      '-y',
      '--arg',
      'pkg',
    ]);
    expect(r.exitCode).toBe(0);
    const callArgs = mcpMocks.createServerInternal.mock.calls[0][0];
    expect(callArgs.mcp_config.transport).toBe('stdio');
    expect(callArgs.mcp_config.command).toBe('npx');
    expect(callArgs.mcp_config.args).toEqual(['-y', 'pkg']);
  });

  it('--dry-run 不调 create', async () => {
    const r = await runMcp('add my-srv --transport sse --url https://x.com/sse --dry-run');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('[dry-run]');
    expect(mcpMocks.createServerInternal).not.toHaveBeenCalled();
  });
});

describe('mcp update', () => {
  it('server 未安装 → exit 1', async () => {
    mcpMocks.profileMcpGet.mockReturnValue(undefined);
    const r = await runMcp('update brave --env BRAVE_API_KEY=new');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not installed');
    expect(mcpMocks.updateServerInternal).not.toHaveBeenCalled();
  });

  it('ON-DEVICE → auto-increment by kernel; CLI 透传 partial flags', async () => {
    mcpMocks.profileMcpGet.mockReturnValue({
      name: 'my-srv',
      version: '1.0.3',
    });
    mcpMocks.updateServerInternal.mockResolvedValue({ success: true, message: 'updated' });

    const r = await runMcp('update my-srv --env A=b');
    expect(r.exitCode).toBe(0);
    const callArgs = mcpMocks.updateServerInternal.mock.calls[0][0];
    expect(callArgs.mcp_config.name).toBe('my-srv');
    expect(callArgs.mcp_config.env).toEqual({ A: 'b' });
  });
});
