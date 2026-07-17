/**
 * `agent remove` subcommand 测试 —— 破坏性默认拒绝是核心契约。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { agentMocks, resetAgentMocks, runAgent } from './_fixture';

beforeEach(() => {
  resetAgentMocks();
});

describe('agent remove', () => {
  it('缺 <name> → exit 2', async () => {
    const r = await runAgent('remove');
    expect(r.exitCode).toBe(2);
    expect(agentMocks.removeAgentInternal).not.toHaveBeenCalled();
  });

  it('不带 --yes → exit 1 + REFUSE + 不调 remove', async () => {
    agentMocks.profileListAgents.mockReturnValue([{ id: 'cid', name: 'bot' }]);

    const r = await runAgent('remove bot');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('refusing without --yes');
    expect(r.stderr).toContain('"bot" was NOT removed');
    expect(agentMocks.removeAgentInternal).not.toHaveBeenCalled();
  });

  it('--yes 但 agent 不存在 → exit 1', async () => {
    agentMocks.profileListAgents.mockReturnValue([]);
    const r = await runAgent('remove bot --yes');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not installed');
    expect(agentMocks.removeAgentInternal).not.toHaveBeenCalled();
  });

  it('--yes + 已安装 → 调 removeAgentInternal + exit 0', async () => {
    agentMocks.profileListAgents.mockReturnValue([{ id: 'cid', name: 'bot' }]);
    agentMocks.removeAgentInternal.mockResolvedValue({
      success: true,
      message: 'removed',
      agent_name: 'bot',
      agent_id: 'cid',
    });

    const r = await runAgent('remove bot --yes');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Removed agent "bot"');
    expect(agentMocks.removeAgentInternal).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(String) }),
      { agent_name: 'bot' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('removeAgentInternal 失败 → exit 1 + 透传 message', async () => {
    agentMocks.profileListAgents.mockReturnValue([{ id: 'cid', name: 'bot' }]);
    agentMocks.removeAgentInternal.mockResolvedValue({
      success: false,
      message: 'archive failed',
    });

    const r = await runAgent('remove bot --yes');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('archive failed');
  });

  it('--dry-run 不需要 --yes,已安装 → 提示 would archive', async () => {
    agentMocks.profileListAgents.mockReturnValue([{ id: 'cid', name: 'bot' }]);

    const r = await runAgent('remove bot --dry-run');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('[dry-run]');
    expect(r.stdout).toContain('would archive');
    expect(agentMocks.removeAgentInternal).not.toHaveBeenCalled();
  });

  it('--dry-run 未安装 → "NOT installed",exit 0', async () => {
    agentMocks.profileListAgents.mockReturnValue([]);
    const r = await runAgent('remove bot --dry-run');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('NOT installed');
    expect(agentMocks.removeAgentInternal).not.toHaveBeenCalled();
  });

  it('--dry-run --json 输出结构化', async () => {
    agentMocks.profileListAgents.mockReturnValue([{ id: 'cid', name: 'bot' }]);

    const r = await runAgent('remove bot --dry-run --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.wouldRemove).toBe(true);
    expect(parsed.name).toBe('bot');
  });

  it('--yes --json 成功时输出 success envelope', async () => {
    agentMocks.profileListAgents.mockReturnValue([{ id: 'cid', name: 'bot' }]);
    agentMocks.removeAgentInternal.mockResolvedValue({
      success: true,
      message: 'removed',
      agent_id: 'cid',
    });

    const r = await runAgent('remove bot --yes --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.action).toBe('remove');
    expect(parsed.name).toBe('bot');
  });
});
