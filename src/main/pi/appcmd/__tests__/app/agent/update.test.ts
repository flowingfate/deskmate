/**
 * `agent update` subcommand 测试 —— 重点验证 partial patch + 已安装存在性
 * 前置校验。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { agentMocks, resetAgentMocks, runAgent } from './_fixture';

beforeEach(() => {
  resetAgentMocks();
});

describe('agent update', () => {
  it('缺 <name> → exit 2', async () => {
    const r = await runAgent('update');
    expect(r.exitCode).toBe(2);
    expect(agentMocks.updateAgentInternal).not.toHaveBeenCalled();
  });

  it('agent 未安装 → exit 1 + 不调 kernel', async () => {
    agentMocks.profileListAgents.mockReturnValue([]);
    const r = await runAgent('update bot --model gpt-4o');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not installed');
    expect(agentMocks.updateAgentInternal).not.toHaveBeenCalled();
  });


  it('ON-DEVICE agent + partial flags → patch 仅含给的字段', async () => {
    agentMocks.profileListAgents.mockReturnValue([{ id: 'cid', name: 'bot' }]);
    agentMocks.profileGetAgent.mockResolvedValue({
      config: {},
    });
    agentMocks.updateAgentInternal.mockResolvedValue({
      success: true,
      message: 'updated',
      old_version: '1.0.0',
      new_version: '1.0.1',
    });

    const r = await runAgent(['update', 'bot', '--model', 'gpt-4o', '--skill', 'foo']);
    expect(r.exitCode).toBe(0);
    const cfg = agentMocks.updateAgentInternal.mock.calls[0][0].agent_config;
    expect(cfg.name).toBe('bot');
    expect(cfg.model).toBe('gpt-4o');
    expect(cfg.skills).toEqual(['foo']);
    // 没给的字段必须 undefined,避免覆盖
    expect(cfg.emoji).toBeUndefined();
    expect(cfg.system_prompt).toBeUndefined();
    expect(cfg.mcp_servers).toBeUndefined();
  });

  it('zero_states:仅 greeting 给 → quickStarts 为 undefined', async () => {
    agentMocks.profileListAgents.mockReturnValue([{ id: 'cid', name: 'bot' }]);
    agentMocks.profileGetAgent.mockResolvedValue({
      config: {},
    });
    agentMocks.updateAgentInternal.mockResolvedValue({ success: true, message: 'ok' });

    await runAgent(['update', 'bot', '--greeting', 'Hello']);
    const cfg = agentMocks.updateAgentInternal.mock.calls[0][0].agent_config;
    expect(cfg.zero_states).toEqual({ greeting: 'Hello' });
  });

  it('kernel update 失败 → exit 1 + 透传 message', async () => {
    agentMocks.profileListAgents.mockReturnValue([{ id: 'cid', name: 'bot' }]);
    agentMocks.profileGetAgent.mockResolvedValue({
      config: {},
    });
    agentMocks.updateAgentInternal.mockResolvedValue({
      success: false,
      message: 'failed to write',
    });

    const r = await runAgent('update bot --model gpt-4o');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('failed to write');
  });

  it('--json 成功输出 patch + 版本信息', async () => {
    agentMocks.profileListAgents.mockReturnValue([{ id: 'cid', name: 'bot' }]);
    agentMocks.profileGetAgent.mockResolvedValue({
      config: {},
    });
    agentMocks.updateAgentInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      old_version: '1.0.0',
      new_version: '1.0.1',
    });

    const r = await runAgent('update bot --model gpt-4o --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.old_version).toBe('1.0.0');
    expect(parsed.new_version).toBe('1.0.1');
    expect(parsed.patch.model).toBe('gpt-4o');
  });

  it('profile.active 抛错 → exit 1 + 提示', async () => {
    agentMocks.profileActive.mockRejectedValue(new Error('no profile'));
    const r = await runAgent('update bot --model gpt-4o');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('no profile');
    expect(agentMocks.updateAgentInternal).not.toHaveBeenCalled();
  });

  it('signal 透传到 updateAgentInternal', async () => {
    agentMocks.profileListAgents.mockReturnValue([{ id: 'cid', name: 'bot' }]);
    agentMocks.profileGetAgent.mockResolvedValue({
      config: {},
    });
    agentMocks.updateAgentInternal.mockResolvedValue({ success: true, message: 'ok' });

    const ctrl = new AbortController();
    await runAgent('update bot --model gpt-4o', { signal: ctrl.signal });
    const opts = agentMocks.updateAgentInternal.mock.calls[0][1];
    expect(opts.signal).toBe(ctrl.signal);
  });
});
