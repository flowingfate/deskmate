/**
 * `mcp connect / disconnect / reconnect` 测试。
 *
 * 三动作共享一份实现 + 测试 —— 它们都是 idempotent 的一个 verb,只在
 * "调 mcpClientManager 的哪个方法" 上有差异。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { mcpMocks, resetMcpMocks, runMcp } from './_fixture';

beforeEach(() => {
  resetMcpMocks();
});

describe('mcp connect|disconnect|reconnect — 共享形态', () => {
  it.each([
    ['connect', mcpMocks.mcpConnect] as const,
    ['disconnect', mcpMocks.mcpDisconnect] as const,
    ['reconnect', mcpMocks.mcpReconnect] as const,
  ])('%s 缺 <name> → exit 2', async (action, manager) => {
    const r = await runMcp(action);
    expect(r.exitCode).toBe(2);
    expect(manager).not.toHaveBeenCalled();
  });


  it('server 未安装 → exit 1', async () => {
    mcpMocks.profileMcpGet.mockReturnValue(undefined);
    const r = await runMcp('connect brave');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not installed');
    expect(mcpMocks.mcpConnect).not.toHaveBeenCalled();
  });

  it('connect 成功 → 调 manager.connect("brave") + 输出新旧 status', async () => {
    mcpMocks.profileMcpGet.mockReturnValue({ name: 'brave' });
    let statusCall = 0;
    mcpMocks.getMcpServerRuntimeState.mockImplementation(() => {
      statusCall += 1;
      return statusCall === 1 ? { status: 'disconnected' } : { status: 'connected' };
    });
    mcpMocks.mcpConnect.mockResolvedValue(undefined);

    const r = await runMcp('connect brave');
    expect(r.exitCode).toBe(0);
    expect(mcpMocks.mcpConnect).toHaveBeenCalledWith('brave');
    expect(r.stdout).toContain('connected (running)');
    expect(r.stdout).toContain('was disconnected');
  });

  it('disconnect 成功 → 调 manager.disconnect', async () => {
    mcpMocks.profileMcpGet.mockReturnValue({ name: 'brave' });
    mcpMocks.getMcpServerRuntimeState.mockReturnValue({ status: 'disconnected' });
    mcpMocks.mcpDisconnect.mockResolvedValue(undefined);

    const r = await runMcp('disconnect brave');
    expect(r.exitCode).toBe(0);
    expect(mcpMocks.mcpDisconnect).toHaveBeenCalledWith('brave');
    expect(mcpMocks.mcpConnect).not.toHaveBeenCalled();
    expect(mcpMocks.mcpReconnect).not.toHaveBeenCalled();
  });

  it('reconnect 成功 → 调 manager.reconnect', async () => {
    mcpMocks.profileMcpGet.mockReturnValue({ name: 'brave' });
    mcpMocks.getMcpServerRuntimeState.mockReturnValue({ status: 'connected' });
    mcpMocks.mcpReconnect.mockResolvedValue(undefined);

    const r = await runMcp('reconnect brave');
    expect(r.exitCode).toBe(0);
    expect(mcpMocks.mcpReconnect).toHaveBeenCalledWith('brave');
  });

  it('connect 抛错 → exit 1 + 含前后 status', async () => {
    mcpMocks.profileMcpGet.mockReturnValue({ name: 'brave' });
    let statusCall = 0;
    mcpMocks.getMcpServerRuntimeState.mockImplementation(() => {
      statusCall += 1;
      return statusCall === 1 ? { status: 'disconnected' } : { status: 'error' };
    });
    mcpMocks.mcpConnect.mockRejectedValue(new Error('boom'));

    const r = await runMcp('connect brave');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('boom');
    expect(r.stderr).toContain('previous: disconnected');
    expect(r.stderr).toContain('current:  error');
  });

  it('--json 成功路径输出 envelope', async () => {
    mcpMocks.profileMcpGet.mockReturnValue({ name: 'brave' });
    let statusCall = 0;
    mcpMocks.getMcpServerRuntimeState.mockImplementation(() => {
      statusCall += 1;
      return statusCall === 1 ? { status: 'disconnected' } : { status: 'connected' };
    });
    mcpMocks.mcpConnect.mockResolvedValue(undefined);

    const r = await runMcp('connect brave --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toEqual({
      success: true,
      action: 'connect',
      name: 'brave',
      previousStatus: 'disconnected',
      currentStatus: 'connected',
    });
  });

  it('已 abort 的 signal → exit 1,不动 manager', async () => {
    mcpMocks.profileMcpGet.mockReturnValue({ name: 'brave' });
    const aborter = new AbortController();
    aborter.abort();

    const r = await runMcp('connect brave', { signal: aborter.signal });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('aborted before start');
    expect(mcpMocks.mcpConnect).not.toHaveBeenCalled();
  });
});
