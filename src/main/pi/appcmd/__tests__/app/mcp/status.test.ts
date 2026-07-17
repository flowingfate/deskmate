/**
 * `mcp status` subcommand 测试 —— human 与 --json 两条路径。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { mcpMocks, resetMcpMocks, runMcp } from './_fixture';

beforeEach(() => {
  resetMcpMocks();
});

describe('mcp status', () => {
  it('缺 <name> → exit 2', async () => {
    const r = await runMcp('status');
    expect(r.exitCode).toBe(2);
    expect(mcpMocks.getStatusInternal).not.toHaveBeenCalled();
  });

  it('connected server → human 输出含 transport + tools_count', async () => {
    mcpMocks.getStatusInternal.mockResolvedValue({
      success: true,
      mcp_name: 'brave',
      status: 'Connected',
      message: 'ok',
      details: { transport: 'stdio', tools_count: 4, in_use: true },
    });

    const r = await runMcp('status brave');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('mcp status "brave"');
    expect(r.stdout).toContain('connected (running)');
    expect(r.stdout).toContain('transport:   stdio');
    expect(r.stdout).toContain('tools_count: 4');
    expect(r.stdout).toContain('in_use:      yes');
  });

  it('Error status → 输出 error 字段', async () => {
    mcpMocks.getStatusInternal.mockResolvedValue({
      success: true,
      mcp_name: 'broken',
      status: 'Error',
      message: 'ok',
      details: { error_message: 'process exited 1' },
    });

    const r = await runMcp('status broken');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('error (last connection failed)');
    expect(r.stdout).toContain('process exited 1');
  });

  it('NotAdded → 仍 exit 0(read-only,不算业务失败)', async () => {
    mcpMocks.getStatusInternal.mockResolvedValue({
      success: true,
      mcp_name: 'unknown',
      status: 'NotAdded',
      message: 'ok',
    });

    const r = await runMcp('status unknown');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('not-added (not in profile)');
  });

  it('internal helper success=false → exit 1', async () => {
    mcpMocks.getStatusInternal.mockResolvedValue({
      success: false,
      mcp_name: 'brave',
      status: 'Disconnected',
      message: 'profile not ready',
    });

    const r = await runMcp('status brave');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('profile not ready');
  });

  it('--json 透传原始 result;success=true → exit 0', async () => {
    const raw = {
      success: true,
      mcp_name: 'brave',
      status: 'Connected',
      message: 'ok',
      details: { transport: 'stdio', tools_count: 4 },
    };
    mcpMocks.getStatusInternal.mockResolvedValue(raw);

    const r = await runMcp('status brave --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toEqual(raw);
  });

  it('--json + success=false → exit 1 但 stdout 仍是 JSON', async () => {
    const raw = {
      success: false,
      mcp_name: 'brave',
      status: 'Error',
      message: 'no profile',
    };
    mcpMocks.getStatusInternal.mockResolvedValue(raw);

    const r = await runMcp('status brave --json');
    expect(r.exitCode).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.success).toBe(false);
  });

  it('ctx.signal 透传给 getMcpStatusInternal', async () => {
    mcpMocks.getStatusInternal.mockResolvedValue({
      success: true,
      mcp_name: 'brave',
      status: 'Connected',
      message: 'ok',
    });
    const aborter = new AbortController();

    await runMcp('status brave', { signal: aborter.signal });
    const optsArg = mcpMocks.getStatusInternal.mock.calls[0][1];
    expect(optsArg).toMatchObject({ signal: aborter.signal, profile: expect.anything() });
  });

  it('--wait 轮询过渡态直到 connected → 多次调用 + exit 0', async () => {
    mcpMocks.getStatusInternal
      .mockResolvedValueOnce({
        success: true,
        mcp_name: 'fs',
        status: 'Connecting',
        message: 'connecting',
        details: { transport: 'stdio', tools_count: 0 },
      })
      .mockResolvedValueOnce({
        success: true,
        mcp_name: 'fs',
        status: 'Connecting',
        message: 'connecting',
        details: { transport: 'stdio', tools_count: 0 },
      })
      .mockResolvedValue({
        success: true,
        mcp_name: 'fs',
        status: 'Connected',
        message: 'ok',
        details: { transport: 'stdio', tools_count: 14 },
      });

    const r = await runMcp('status fs --wait');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('connected (running)');
    expect(r.stdout).toContain('tools_count: 14');
    expect(mcpMocks.getStatusInternal.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('--timeout 隐含 wait;始终 connecting → 超时后打 note + exit 0', async () => {
    mcpMocks.getStatusInternal.mockResolvedValue({
      success: true,
      mcp_name: 'fs',
      status: 'Connecting',
      message: 'connecting',
      details: { transport: 'stdio', tools_count: 0 },
    });

    const r = await runMcp('status fs --timeout 0.5');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('still not settled after 0.5s wait');
    expect(mcpMocks.getStatusInternal.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('无 --wait → 单次快照,不轮询过渡态', async () => {
    mcpMocks.getStatusInternal.mockResolvedValue({
      success: true,
      mcp_name: 'fs',
      status: 'Connecting',
      message: 'connecting',
      details: { transport: 'stdio', tools_count: 0 },
    });

    const r = await runMcp('status fs');
    expect(r.exitCode).toBe(0);
    expect(mcpMocks.getStatusInternal).toHaveBeenCalledTimes(1);
  });

  it('--timeout 非数字 → exit 2', async () => {
    const r = await runMcp('status fs --timeout abc');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--timeout must be a positive number');
    expect(mcpMocks.getStatusInternal).not.toHaveBeenCalled();
  });
});
