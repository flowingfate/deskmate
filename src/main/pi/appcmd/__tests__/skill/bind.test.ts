/**
 * `skill bind` subcommand 测试 —— 默认 target 解析 + 显式 flag 互斥。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetSkillMocks, runSkill, skillMocks } from './_fixture';

beforeEach(() => {
  resetSkillMocks();
});

describe('skill bind', () => {
  it('缺 <skill-name> → exit 2', async () => {
    const r = await runSkill('bind');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('expected exactly one <skill-name>');
    expect(skillMocks.bindSkillInternal).not.toHaveBeenCalled();
  });

  it('--agent-name 与 --all-agents 同时存在 → exit 2', async () => {
    const r = await runSkill('bind pptx --agent-name foo --all-agents');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('mutually exclusive');
    expect(skillMocks.bindSkillInternal).not.toHaveBeenCalled();
  });

  it('--all-agents → 调 kernel(apply_to_all=true)', async () => {
    skillMocks.bindSkillInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      skill_name: 'pptx',
      applied_count: 3,
      already_applied_count: 0,
      failed_count: 0,
      applied_targets: [],
      skipped_targets: [],
    });

    const r = await runSkill('bind pptx --all-agents');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.bindSkillInternal).toHaveBeenCalledWith(
      { skill_name: 'pptx', apply_to_all: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(r.stdout).toContain('all agents');
    expect(r.stdout).toContain('applied: 3');
  });

  it('--agent-name 多个 → 传 agent_names 数组', async () => {
    skillMocks.bindSkillInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      skill_name: 'pptx',
      applied_count: 2,
      already_applied_count: 0,
      failed_count: 0,
      applied_targets: [],
      skipped_targets: [],
    });

    const r = await runSkill('bind pptx --agent-name a --agent-name b');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.bindSkillInternal).toHaveBeenCalledWith(
      { skill_name: 'pptx', agent_names: ['a', 'b'] },
      expect.anything(),
    );
    expect(r.stdout).toContain('agent(s) [a, b]');
  });

  it('默认 → 走 resolveDefaultAgentTarget(ctx.agentId 非空 + getAgent 命中)', async () => {
    skillMocks.profileGetAgent.mockResolvedValue({ config: { name: 'CurrentBot' } });
    skillMocks.bindSkillInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      skill_name: 'pptx',
      applied_count: 1,
      already_applied_count: 0,
      failed_count: 0,
      applied_targets: [],
      skipped_targets: [],
    });

    const r = await runSkill('bind pptx');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.bindSkillInternal).toHaveBeenCalledWith(
      {
        skill_name: 'pptx',
        targets: [{ agentId: 'agent-test', agentName: 'CurrentBot' }],
      },
      expect.anything(),
    );
    expect(r.stdout).toContain('current agent "CurrentBot"');
  });

  it('默认 + ctx.agentId 空 → exit 1 + 提示传 --agent-name / --all', async () => {
    const r = await runSkill('bind pptx', { agentId: '' });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('No active chat context');
    expect(r.stderr).toContain('--agent-name');
    expect(r.stderr).toContain('--all-agents');
    expect(skillMocks.bindSkillInternal).not.toHaveBeenCalled();
  });

  it('默认 + agent 不存在 → exit 1 + "Current chat not found"', async () => {
    skillMocks.profileGetAgent.mockResolvedValue(undefined);

    const r = await runSkill('bind pptx');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Current chat not found');
  });

  it('kernel 拒绝(未安装)→ exit 1 + 透传 message', async () => {
    skillMocks.profileGetAgent.mockResolvedValue({ config: { name: 'X' } });
    skillMocks.bindSkillInternal.mockResolvedValue({
      success: false,
      message: 'Skill "pptx" is not installed. Run "app skill install pptx" first.',
      skill_name: 'pptx',
      applied_count: 0,
      already_applied_count: 0,
      failed_count: 0,
      applied_targets: [],
      skipped_targets: [],
      error: 'SKILL_NOT_INSTALLED',
    });

    const r = await runSkill('bind pptx');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('is not installed');
  });

  it('--dry-run 不调 kernel,human 输出', async () => {
    const r = await runSkill('bind pptx --all-agents --dry-run');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.bindSkillInternal).not.toHaveBeenCalled();
    expect(r.stdout).toContain('[dry-run] skill bind "pptx"');
    expect(r.stdout).toContain('all agents');
  });

  it('--dry-run --json 输出结构化', async () => {
    const r = await runSkill('bind pptx --all-agents --dry-run --json');
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj).toMatchObject({
      dryRun: true,
      action: 'bind',
      skill_name: 'pptx',
      target: 'all agents',
    });
  });

  it('--json 成功 → 透传 kernel envelope', async () => {
    skillMocks.bindSkillInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      skill_name: 'pptx',
      applied_count: 1,
      already_applied_count: 0,
      failed_count: 0,
      applied_targets: [{ agentId: 'c', agentName: 'A' }],
      skipped_targets: [],
    });

    const r = await runSkill('bind pptx --all-agents --json');
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.success).toBe(true);
    expect(obj.applied_count).toBe(1);
  });
});
