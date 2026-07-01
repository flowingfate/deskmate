/**
 * `skill unbind` subcommand 测试 —— 与 bind 对称的核心契约。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetSkillMocks, runSkill, skillMocks } from './_fixture';

beforeEach(() => {
  resetSkillMocks();
});

describe('skill unbind', () => {
  it('缺位置参数 → exit 2', async () => {
    const r = await runSkill('unbind');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('missing required <skill-name>');
    expect(skillMocks.unbindSkillInternal).not.toHaveBeenCalled();
  });

  it('--agent-name 与 --all-agents 同时存在 → exit 2', async () => {
    const r = await runSkill('unbind pptx --agent-name foo --all-agents');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('mutually exclusive');
    expect(skillMocks.unbindSkillInternal).not.toHaveBeenCalled();
  });

  it('--all-agents + 多 skill → 调 kernel(remove_from_all=true)', async () => {
    skillMocks.unbindSkillInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      skill_names: ['pptx', 'jira'],
      updated_agent_count: 3,
      removed_binding_count: 5,
      unchanged_target_count: 0,
      failed_count: 0,
      updated_targets: [],
      skipped_targets: [],
    });

    const r = await runSkill('unbind pptx jira --all-agents');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.unbindSkillInternal).toHaveBeenCalledWith(
      { skill_names: ['pptx', 'jira'], remove_from_all: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(r.stdout).toContain('all agents');
    expect(r.stdout).toContain('updated agents: 3');
    expect(r.stdout).toContain('removed bindings: 5');
  });

  it('--agent-name 多个 → 传 agent_names 数组', async () => {
    skillMocks.unbindSkillInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      skill_names: ['pptx'],
      updated_agent_count: 2,
      removed_binding_count: 2,
      unchanged_target_count: 0,
      failed_count: 0,
      updated_targets: [],
      skipped_targets: [],
    });

    const r = await runSkill('unbind pptx --agent-name a --agent-name b');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.unbindSkillInternal).toHaveBeenCalledWith(
      { skill_names: ['pptx'], agent_names: ['a', 'b'] },
      expect.anything(),
    );
  });

  it('默认 → 走 resolveDefaultAgentTarget,ctx.agentId 非空 + 命中', async () => {
    skillMocks.profileGetAgent.mockResolvedValue({ config: { name: 'CurrentBot' } });
    skillMocks.unbindSkillInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      skill_names: ['pptx'],
      updated_agent_count: 1,
      removed_binding_count: 1,
      unchanged_target_count: 0,
      failed_count: 0,
      updated_targets: [],
      skipped_targets: [],
    });

    const r = await runSkill('unbind pptx');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.unbindSkillInternal).toHaveBeenCalledWith(
      {
        skill_names: ['pptx'],
        targets: [{ agentId: 'agent-test', agentName: 'CurrentBot' }],
      },
      expect.anything(),
    );
    expect(r.stdout).toContain('current agent "CurrentBot"');
  });

  it('默认 + ctx.agentId 空 → exit 1 + 提示传 --agent-name / --all', async () => {
    const r = await runSkill('unbind pptx', { agentId: '' });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('No active chat context');
    expect(skillMocks.unbindSkillInternal).not.toHaveBeenCalled();
  });

  it('kernel 失败 → exit 1 + 透传 message', async () => {
    skillMocks.profileGetAgent.mockResolvedValue({ config: { name: 'X' } });
    skillMocks.unbindSkillInternal.mockResolvedValue({
      success: false,
      message: 'Nothing matched',
      skill_names: ['pptx'],
      updated_agent_count: 0,
      removed_binding_count: 0,
      unchanged_target_count: 1,
      failed_count: 0,
      updated_targets: [],
      skipped_targets: [],
      error: 'NO_MATCH',
    });

    const r = await runSkill('unbind pptx');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Nothing matched');
  });

  it('--dry-run 不调 kernel', async () => {
    const r = await runSkill('unbind pptx --all-agents --dry-run');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.unbindSkillInternal).not.toHaveBeenCalled();
    expect(r.stdout).toContain('[dry-run] skill unbind');
    expect(r.stdout).toContain('all agents');
  });

  it('--json 透传 envelope', async () => {
    skillMocks.unbindSkillInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      skill_names: ['pptx'],
      updated_agent_count: 1,
      removed_binding_count: 1,
      unchanged_target_count: 0,
      failed_count: 0,
      updated_targets: [],
      skipped_targets: [],
    });

    const r = await runSkill('unbind pptx --all-agents --json');
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.success).toBe(true);
    expect(obj.updated_agent_count).toBe(1);
  });
});
