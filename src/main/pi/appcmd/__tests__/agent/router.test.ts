/**
 * `agent` 顶层路由 + `--help` / 未知 subcommand 行为 + list / status /
 * set-primary / add 的 minimal happy path 测试。
 *
 * 把所有"路由层"测试集中在一个文件,避免把 install/remove/update/search 之外
 * 的小 case 散布到多个文件。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { appCommands } from '@main/pi/appcmd/registry';

import { agentMocks, resetAgentMocks, runAgent } from './_fixture';

beforeEach(() => {
  resetAgentMocks();
});

describe('agent 顶层路由', () => {
  it('注册到全局 appCommands', () => {
    expect(appCommands.has('agent')).toBe(true);
  });

  it('空 sub → 顶层 help', async () => {
    const r = await runAgent('');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout).toContain('agent <subcommand>');
    expect(r.stdout).toContain('add <name>');
    expect(r.stdout).toContain('set-primary <name>');
  });

  it('`agent --help` → 顶层 help', async () => {
    const r = await runAgent('--help');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('SUBCOMMANDS');
  });

  it('`agent -h` → 顶层 help', async () => {
    const r = await runAgent('-h');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('SUBCOMMANDS');
  });

  it('未知 subcommand → exit 2 + hint', async () => {
    const r = await runAgent('bogus');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown subcommand "bogus"');
    expect(r.stderr).toContain('agent --help');
  });

  it.each([
    'add',
    'update',
    'remove',
    'list',
    'status',
    'set-primary',
  ])('`agent %s --help` 展示 subcommand help,exit 0,不动 kernel', async (sub) => {
    const r = await runAgent(`${sub} --help`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(agentMocks.createAgentInternal).not.toHaveBeenCalled();
    expect(agentMocks.updateAgentInternal).not.toHaveBeenCalled();
    expect(agentMocks.removeAgentInternal).not.toHaveBeenCalled();
    expect(agentMocks.listAgentsInternal).not.toHaveBeenCalled();
    expect(agentMocks.getStatusInternal).not.toHaveBeenCalled();
    expect(agentMocks.setPrimaryInternal).not.toHaveBeenCalled();
  });
});

describe('agent list', () => {
  it('happy path → 调 listAgentsInternal + 输出 count', async () => {
    agentMocks.listAgentsInternal.mockResolvedValue({
      success: true,
      agents: ['a', 'b'],
      count: 2,
      message: 'Found 2 agent(s): a, b',
    });

    const r = await runAgent('list');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('2 agent(s)');
    expect(r.stdout).toContain('- a');
    expect(r.stdout).toContain('- b');
  });

  it('空集 → "No agents installed"', async () => {
    agentMocks.listAgentsInternal.mockResolvedValue({
      success: true,
      agents: [],
      count: 0,
      message: 'No agents configured in the profile.',
    });

    const r = await runAgent('list');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No agents installed');
  });

  it('--json 透传 raw envelope', async () => {
    agentMocks.listAgentsInternal.mockResolvedValue({
      success: true,
      agents: ['a'],
      count: 1,
      message: 'ok',
    });

    const r = await runAgent('list --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.agents).toEqual(['a']);
    expect(parsed.count).toBe(1);
  });

  it('多余位置参数 → exit 2', async () => {
    const r = await runAgent('list foo');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('takes no positional');
  });
});

describe('agent status', () => {
  it('缺 <name> → exit 2', async () => {
    const r = await runAgent('status');
    expect(r.exitCode).toBe(2);
    expect(agentMocks.getStatusInternal).not.toHaveBeenCalled();
  });

  it('Added → human 输出包含 agent_id / emoji / model', async () => {
    agentMocks.getStatusInternal.mockResolvedValue({
      success: true,
      agent_name: 'bot',
      status: 'Added',
      message: 'Agent "bot" is added to the profile.',
      details: { agent_id: 'cid', emoji: '🤖', model: 'gpt-4o' },
    });
    const r = await runAgent('status bot');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Added');
    expect(r.stdout).toContain('agent_id: cid');
    expect(r.stdout).toContain('emoji:');
    expect(r.stdout).toContain('model:   gpt-4o');
  });

  it('NotAdded → 仍 exit 0', async () => {
    agentMocks.getStatusInternal.mockResolvedValue({
      success: true,
      agent_name: 'bot',
      status: 'NotAdded',
      message: 'Agent "bot" is not added to the profile.',
    });
    const r = await runAgent('status bot');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('NotAdded');
  });

  it('internal failure → exit 1', async () => {
    agentMocks.getStatusInternal.mockResolvedValue({
      success: false,
      agent_name: 'bot',
      status: 'NotAdded',
      message: 'profile load failed',
    });
    const r = await runAgent('status bot');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('profile load failed');
  });

  it('--json + success=false → exit 1 但 stdout 仍是 JSON', async () => {
    agentMocks.getStatusInternal.mockResolvedValue({
      success: false,
      agent_name: 'bot',
      status: 'NotAdded',
      message: 'oh no',
    });
    const r = await runAgent('status bot --json');
    expect(r.exitCode).toBe(1);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});

describe('agent set-primary', () => {
  it('缺 <name> → exit 2', async () => {
    const r = await runAgent('set-primary');
    expect(r.exitCode).toBe(2);
    expect(agentMocks.setPrimaryInternal).not.toHaveBeenCalled();
  });

  it('happy path → 调 setPrimaryInternal + 透传 message', async () => {
    agentMocks.setPrimaryInternal.mockResolvedValue({
      success: true,
      primaryAgent: 'bot',
      previousPrimaryAgent: '',
      message: 'Successfully set "bot" as the primary agent.',
    });
    const r = await runAgent('set-primary bot');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Successfully set "bot"');
    expect(agentMocks.setPrimaryInternal).toHaveBeenCalledWith(
      { agent_name: 'bot' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('agent 不存在 → exit 1', async () => {
    agentMocks.setPrimaryInternal.mockResolvedValue({
      success: false,
      primaryAgent: '',
      previousPrimaryAgent: '',
      message: 'Agent "bot" not found.',
    });
    const r = await runAgent('set-primary bot');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not found');
  });
});

describe('agent add', () => {
  it('缺 <name> → exit 2', async () => {
    const r = await runAgent('add');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('missing required <name>');
  });

  it('多余位置参数 → exit 2', async () => {
    const r = await runAgent('add foo bar');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('too many positional');
  });

  it('happy path: 纯名字 → version=1.0.0', async () => {
    agentMocks.createAgentInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      agent_name: 'bot',
      agent_id: 'cid',
    });
    const r = await runAgent('add bot');
    expect(r.exitCode).toBe(0);
    const callArgs = agentMocks.createAgentInternal.mock.calls[0][0];
    expect(callArgs.name).toBe('bot');
    expect(callArgs.version).toBe('1.0.0');
  });

  it('happy path: overrides 全套', async () => {
    agentMocks.createAgentInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      agent_id: 'cid',
    });
    const r = await runAgent([
      'add',
      'bot',
      '--model',
      'gpt-4o',
      '--emoji',
      '🤖',
      '--system-prompt',
      'Be concise.',
      '--skill',
      'foo',
      '--skill',
      'bar',
      '--mcp-server',
      'git',
      '--mcp-tool',
      'git:status',
      '--greeting',
      'Hi',
    ]);
    expect(r.exitCode).toBe(0);
    const callArgs = agentMocks.createAgentInternal.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4o');
    expect(callArgs.emoji).toBe('🤖');
    expect(callArgs.system_prompt).toBe('Be concise.');
    expect(callArgs.skills).toEqual(['foo', 'bar']);
    expect(callArgs.mcp_servers).toEqual([{ name: 'git', tools: ['status'] }]);
    expect(callArgs.zero_states?.greeting).toBe('Hi');
  });

  it('--mcp-tool 缺 `:` → exit 2 + 不调 create', async () => {
    const r = await runAgent('add bot --mcp-tool malformed');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('invalid --mcp-tool');
    expect(agentMocks.createAgentInternal).not.toHaveBeenCalled();
  });

  it('--quick-start 缺段 → exit 2', async () => {
    const r = await runAgent(['add', 'bot', '--quick-start', 'only-title']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--quick-start');
  });

  it('--dry-run 不调 create', async () => {
    const r = await runAgent('add bot --model gpt-4o --dry-run');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('[dry-run]');
    expect(agentMocks.createAgentInternal).not.toHaveBeenCalled();
  });

  it('--dry-run --json 输出结构化', async () => {
    const r = await runAgent('add bot --model gpt-4o --dry-run --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.action).toBe('add');
    expect(parsed.config.model).toBe('gpt-4o');
  });

  it('create 失败 → exit 1 + 透传 message', async () => {
    agentMocks.createAgentInternal.mockResolvedValue({
      success: false,
      message: 'an agent with name "bot" already exists',
    });
    const r = await runAgent('add bot');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('already exists');
  });

  it('signal 透传到 createAgentInternal', async () => {
    agentMocks.createAgentInternal.mockResolvedValue({ success: true, message: 'ok' });
    const ctrl = new AbortController();
    await runAgent('add bot', { signal: ctrl.signal });
    const opts = agentMocks.createAgentInternal.mock.calls[0][1];
    expect(opts.signal).toBe(ctrl.signal);
  });
});
