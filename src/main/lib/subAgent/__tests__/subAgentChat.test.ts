/**
 * SubAgentChat unit tests (wrapper-level)
 *
 * 老的 ~2800 行测试覆盖的私有方法（SSE 解析、tool args 修复、orphan 清理等）
 * 已经随着切到 pi.Session 整体下线（pi-ai 在底层已经处理这些场景）。
 *
 * 新测试聚焦 wrapper 仍持有的特化能力：
 * - 4 层 system prompt 拼装
 * - 动态 turn-progress hint
 * - shouldContinueAfterTextResponse / looksLikeIntentNotResult 启发式
 * - trackDeliverables / formatDeliverablesSection / extractFinalResult
 * - truncateToLines 工具函数
 */

import { vi } from 'vitest';

// ─── Mock dependencies ───
vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../../mcpRuntime/mcpClientManager', async () => ({
  // Mock 整个模块,wrapper 测试不触达任何 mcpClientManager 方法;
  // 留一个空对象避免 import 阶段炸。Phase 3 移除已废弃的 getToolsForSubAgent。
  mcpClientManager: {},
}));

vi.mock('../../skill/skillManager', async () => ({
  skillManager: {
    getSkillMetadata: vi.fn(() => ({ metadata: { description: 'mock skill', version: '1.0' } })),
  },
}));

vi.mock('@main/persist/lib/path', async () => ({
  getProfileSkillsDir: vi.fn(() => '/mock/skills'),
}));

// 不需要走真实 pi —— SubAgentSession 由 wrapper 内部构造，但本测试组只覆盖
// wrapper 自己的纯函数，不调用 run() 触发 pi 路径，故无需 mock @main/pi。

import { SubAgentChat, truncateToLines } from '../subAgentChat';
import type { SubAgentChatOptions } from '../types';
import type { SubAgentConfig } from '@shared/types/profileTypes';
import type { Message } from '@shared/types/message'

// ─── Test helpers ───

function makeConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    name: 'test-agent',
    display_name: 'Test Agent',
    description: 'Test sub-agent',
    emoji: '🧪',
    version: '1.0.0',
    
    system_prompt: 'You are a test agent',
    mcpServers: [],
    context_access: 'isolated',
    maxTurns: 5,
    ...overrides,
  };
}

function makeOptions(overrides: Partial<SubAgentChatOptions> = {}): SubAgentChatOptions {
  return {
    subAgent: {
      config: makeConfig(),
      inheritedModel: 'github-copilot::gpt-4o',
      parentAgentId: 'parent-agent-1',
      parentSessionId: 'parent-session-1',
      profileId: 'test-profile',
      resolvedMcpServers: [],
      resolvedSkills: [],
      taskId: 'task-test-1',
    },
    task: 'Do the thing',
    cancellationSignal: new AbortController().signal,
    profileId: 'test-profile',
    ...overrides,
  };
}

interface SubAgentChatInternal {
  buildSystemPrompt(): string;
  buildWorkspaceAndSkillsInfo(config: SubAgentConfig): string;
  buildTurnProgressHint(): string;
  looksLikeIntentNotResult(text: string | null | undefined): boolean;
  shouldContinueAfterTextResponse(
    summary: { textContent: string; stopReason: string; hadToolCalls: boolean },
    consecutiveTextOnlyRounds: number,
    hasTools: boolean,
  ): boolean;
  trackDeliverables(toolName: string, toolArgs: Record<string, unknown>): void;
  formatDeliverablesSection(): string;
  extractFinalResult(): string;
  summarizeToolArgs(toolName: string, toolArgs: Record<string, unknown>): string;
  getDeliverablesPath(): string | null;
  deliverables: string[];
  turnCount: number;
  session: { snapshotMessages(): Message[] };
}

/** 反射式访问私有成员：测试聚焦行为；类型守卫只到方法接口。 */
function inner(chat: SubAgentChat): SubAgentChatInternal {
  return chat as unknown as SubAgentChatInternal;
}

// ─── truncateToLines ───

describe('truncateToLines', () => {
  it('returns empty string for empty input', () => {
    expect(truncateToLines('', 4, 100)).toBe('');
  });

  it('keeps text under both limits unchanged', () => {
    expect(truncateToLines('hello\nworld', 4, 100)).toBe('hello\nworld');
  });

  it('truncates by character cap', () => {
    const result = truncateToLines('a'.repeat(50), 4, 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.endsWith('...')).toBe(true);
  });

  it('truncates by line cap and appends ellipsis', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    const result = truncateToLines(lines, 3, 500);
    expect(result.split('\n')).toHaveLength(3);
    expect(result.endsWith('...')).toBe(true);
  });

  it('drops blank lines before counting', () => {
    const text = 'a\n\n\nb\n\nc';
    expect(truncateToLines(text, 10, 100)).toBe('a\nb\nc');
  });
});

// ─── buildSystemPrompt ───

describe('buildSystemPrompt', () => {
  it('includes 4 layers: identity, task, operating rules, efficiency', () => {
    const chat = new SubAgentChat(makeOptions());
    const prompt = inner(chat).buildSystemPrompt();
    expect(prompt).toContain('# Sub-Agent: Test Agent');
    expect(prompt).toContain('You are a test agent');
    expect(prompt).toContain('## Current Task');
    expect(prompt).toContain('## Operating Rules');
    expect(prompt).toContain('## Efficiency Guidelines');
  });

  it('includes parent context block when provided', () => {
    const chat = new SubAgentChat(makeOptions({ parentContext: 'The user wants X.' }));
    const prompt = inner(chat).buildSystemPrompt();
    expect(prompt).toContain('## Parent Agent Context');
    expect(prompt).toContain('The user wants X.');
  });

  it('omits parent context block when not provided', () => {
    const chat = new SubAgentChat(makeOptions({ parentContext: undefined }));
    const prompt = inner(chat).buildSystemPrompt();
    expect(prompt).not.toContain('## Parent Agent Context');
  });

  it('injects deliverables rule when deliverablesPath set', () => {
    const chat = new SubAgentChat(makeOptions({ deliverablesPath: '/deliverables' }));
    const prompt = inner(chat).buildSystemPrompt();
    expect(prompt).toContain('/deliverables');
    expect(prompt).toContain('always mention the file paths');
  });

  it('omits deliverables rule when no path available', () => {
    const chat = new SubAgentChat(makeOptions({
      deliverablesPath: undefined,
      subAgent: {
        ...makeOptions().subAgent,
        config: makeConfig({ workspace: undefined }),
      },
    }));
    const prompt = inner(chat).buildSystemPrompt();
    expect(prompt).not.toContain('use the deliverables directory');
  });
});

// ─── buildWorkspaceAndSkillsInfo ───

describe('buildWorkspaceAndSkillsInfo', () => {
  it('returns empty string when no workspace/skills/KB', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(inner(chat).buildWorkspaceAndSkillsInfo(makeConfig())).toBe('');
  });

  it('includes workspace section when configured', () => {
    const chat = new SubAgentChat(makeOptions());
    const info = inner(chat).buildWorkspaceAndSkillsInfo(makeConfig({ workspace: '/ws' }));
    expect(info).toContain('## Workspace');
    expect(info).toContain('/ws');
  });

  it('includes skills section using resolvedSkills (with inherited tag)', () => {
    const chat = new SubAgentChat(makeOptions({
      subAgent: {
        ...makeOptions().subAgent,
        resolvedSkills: [{ name: 'skill-a', installed: true, inherited: true }],
      },
    }));
    const info = inner(chat).buildWorkspaceAndSkillsInfo(makeConfig({ skills: ['skill-a'] }));
    expect(info).toContain('## Available Skills');
    expect(info).toContain('skill-a (inherited from parent)');
  });

  it('falls back to config.skills when resolvedSkills empty', () => {
    const chat = new SubAgentChat(makeOptions());
    const info = inner(chat).buildWorkspaceAndSkillsInfo(makeConfig({ skills: ['plain-skill'] }));
    expect(info).toContain('plain-skill');
  });

  it('includes knowledge base when resolvedKnowledgeBase set', () => {
    const chat = new SubAgentChat(makeOptions({
      subAgent: {
        ...makeOptions().subAgent,
        resolvedKnowledgeBase: '/kb',
      },
    }));
    const info = inner(chat).buildWorkspaceAndSkillsInfo(makeConfig());
    expect(info).toContain('## Knowledge Base');
    expect(info).toContain('/kb');
  });
});

// ─── buildTurnProgressHint ───

describe('buildTurnProgressHint', () => {
  function chatWithTurns(maxTurns: number, turnsDone: number): SubAgentChat {
    const chat = new SubAgentChat(makeOptions({
      subAgent: {
        ...makeOptions().subAgent,
        config: makeConfig({ maxTurns }),
      },
    }));
    inner(chat).turnCount = turnsDone;
    return chat;
  }

  it('announces total budget on first turn', () => {
    const hint = inner(chatWithTurns(25, 0)).buildTurnProgressHint();
    expect(hint).toContain('[Turn 1/25]');
    expect(hint).toContain('You have 25 turns total');
  });

  it('shows remaining mid-conversation', () => {
    const hint = inner(chatWithTurns(25, 5)).buildTurnProgressHint();
    expect(hint).toContain('[Turn 6/25]');
    expect(hint).toContain('20 turns remaining');
  });

  it('warns strongly at 3 turns remaining', () => {
    const hint = inner(chatWithTurns(25, 22)).buildTurnProgressHint();
    expect(hint).toContain('[Turn 23/25]');
    expect(hint).toContain('ONLY 3 turn(s) remaining');
    expect(hint).toContain('produce your final result NOW');
  });

  it('warns strongly with 1 turn remaining', () => {
    const hint = inner(chatWithTurns(25, 24)).buildTurnProgressHint();
    expect(hint).toContain('ONLY 1 turn(s) remaining');
  });
});

// ─── shouldContinueAfterTextResponse ───

describe('shouldContinueAfterTextResponse', () => {
  function summary(over: { textContent?: string; stopReason?: 'stop' | 'length' | 'toolUse' | 'aborted' } = {}) {
    return {
      textContent: over.textContent ?? '',
      stopReason: over.stopReason ?? 'stop',
      hadToolCalls: false,
    };
  }

  it('continues when stopReason is length (token truncated)', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(inner(chat).shouldContinueAfterTextResponse(summary({ stopReason: 'length' }), 1, true)).toBe(true);
  });

  it('stops when no tools available', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(inner(chat).shouldContinueAfterTextResponse(summary(), 1, false)).toBe(false);
  });

  it('stops after 2+ consecutive text-only rounds', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(inner(chat).shouldContinueAfterTextResponse(
      summary({ textContent: 'Let me search for that' }),
      2,
      true,
    )).toBe(false);
  });

  it('continues on first text-only round if text looks like intent', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(inner(chat).shouldContinueAfterTextResponse(
      summary({ textContent: "I'll conduct a deep research into this topic. Let me gather information." }),
      1,
      true,
    )).toBe(true);
  });

  it('stops on first text-only round if text looks like final result', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(inner(chat).shouldContinueAfterTextResponse(
      summary({ textContent: 'The answer is 42. This is the result of the computation.' }),
      1,
      true,
    )).toBe(false);
  });
});

describe('looksLikeIntentNotResult', () => {
  it('detects intent markers', () => {
    const chat = new SubAgentChat(makeOptions());
    const i = inner(chat);
    expect(i.looksLikeIntentNotResult('Let me search for that.')).toBe(true);
    expect(i.looksLikeIntentNotResult("I'll gather the data now.")).toBe(true);
    expect(i.looksLikeIntentNotResult('I will conduct research.')).toBe(true);
    expect(i.looksLikeIntentNotResult('Step 1: analyze the input.')).toBe(true);
    expect(i.looksLikeIntentNotResult('I need to find the relevant files.')).toBe(true);
  });

  it('rejects final-result style text', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(inner(chat).looksLikeIntentNotResult('The result is 42.')).toBe(false);
  });

  it('rejects very short / empty / nullish text', () => {
    const chat = new SubAgentChat(makeOptions());
    const i = inner(chat);
    expect(i.looksLikeIntentNotResult('Done.')).toBe(false);
    expect(i.looksLikeIntentNotResult('')).toBe(false);
    expect(i.looksLikeIntentNotResult(null)).toBe(false);
    expect(i.looksLikeIntentNotResult(undefined)).toBe(false);
  });
});

// ─── trackDeliverables / formatDeliverablesSection ───

describe('trackDeliverables', () => {
  it('tracks write fileUri', () => {
    const chat = new SubAgentChat(makeOptions());
    inner(chat).trackDeliverables('write', { fileUri: '/path/file.md', content: 'hi' });
    expect(inner(chat).deliverables).toEqual(['/path/file.md']);
  });

  // 旧 `create_file` / `append_to_file` wrapper 从未实际注册,Phase 8a
  // 把它们从 `FILE_OUTPUT_TOOLS` 里清除,对应测试一并下线 —— 留着会因为
  // 名字落到 default 分支而失败,且对真实行为零覆盖。


  it('tracks download_file from saveDirectory + filename', () => {
    const chat = new SubAgentChat(makeOptions());
    inner(chat).trackDeliverables('download_file', { saveDirectory: '/d', filename: 'a.png' });
    expect(inner(chat).deliverables).toEqual(['/d/a.png']);
  });

  it('tracks download_file with local:// (default sandbox) → URI-form deliverable', () => {
    const chat = new SubAgentChat(makeOptions());
    inner(chat).trackDeliverables('download_file', { saveDirectory: 'local://', filename: 'a.png' });
    expect(inner(chat).deliverables).toEqual(['local://a.png']);
  });

  it('tracks download_file with local:// sub-path → URI sub-path/filename', () => {
    const chat = new SubAgentChat(makeOptions());
    inner(chat).trackDeliverables('download_file', { saveDirectory: 'local://reports', filename: 'q3.json' });
    expect(inner(chat).deliverables).toEqual(['local://reports/q3.json']);
  });

  it('tracks download_file with knowledge:// → URI form', () => {
    const chat = new SubAgentChat(makeOptions());
    inner(chat).trackDeliverables('download_file', { saveDirectory: 'knowledge://', filename: 'manual.pdf' });
    expect(inner(chat).deliverables).toEqual(['knowledge://manual.pdf']);
  });

  it('tracks download_file with omitted saveDirectory → defaults to local:// URI', () => {
    const chat = new SubAgentChat(makeOptions());
    inner(chat).trackDeliverables('download_file', { filename: 'fallback.png' });
    expect(inner(chat).deliverables).toEqual(['local://fallback.png']);
  });

  it('tracks present_deliverables fileUris array', () => {
    const chat = new SubAgentChat(makeOptions());
    inner(chat).trackDeliverables('present_deliverables', { fileUris: ['/a.md', '/b.md'] });
    expect(inner(chat).deliverables).toEqual(['/a.md', '/b.md']);
  });

  it('deduplicates repeated entries', () => {
    const chat = new SubAgentChat(makeOptions());
    inner(chat).trackDeliverables('write', { fileUri: '/dup.md' });
    inner(chat).trackDeliverables('write', { fileUri: '/dup.md' });
    expect(inner(chat).deliverables).toEqual(['/dup.md']);
  });

  it('ignores non-file tools', () => {
    // 历史:此处用 `bing_web_search` → `get_current_datetime` 等反例(它们
    // 从来不输出文件)。web / datetime 工具已下线,改用 `present_deliverables`
    // 作为稳定反例 —— 它本身就是个标记工具,从不写盘,但又是常驻注册。
    const chat = new SubAgentChat(makeOptions());
    inner(chat).trackDeliverables('present_deliverables', {});
    expect(inner(chat).deliverables).toEqual([]);
  });

  it('does not throw on missing args', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(() => inner(chat).trackDeliverables('write', {})).not.toThrow();
    expect(inner(chat).deliverables).toEqual([]);
  });
});

describe('formatDeliverablesSection', () => {
  it('returns empty string with no deliverables', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(inner(chat).formatDeliverablesSection()).toBe('');
  });

  it('formats single deliverable', () => {
    const chat = new SubAgentChat(makeOptions());
    inner(chat).deliverables.push('/report.md');
    const section = inner(chat).formatDeliverablesSection();
    expect(section).toContain('Deliverables');
    expect(section).toContain('1 file(s) created/modified');
    expect(section).toContain('/report.md');
  });

  it('formats multiple deliverables', () => {
    const chat = new SubAgentChat(makeOptions());
    inner(chat).deliverables.push('/a.md', '/b.json', '/c.txt');
    const section = inner(chat).formatDeliverablesSection();
    expect(section).toContain('3 file(s) created/modified');
    expect(section).toContain('/a.md');
    expect(section).toContain('/b.json');
    expect(section).toContain('/c.txt');
  });
});

// ─── extractFinalResult ───

describe('extractFinalResult', () => {
  function withMessages(messages: Message[], turnCount = 1): SubAgentChat {
    const chat = new SubAgentChat(makeOptions());
    inner(chat).turnCount = turnCount;
    const fakeSession = { snapshotMessages: () => messages };
    inner(chat).session = fakeSession;
    return chat;
  }

  it('returns last assistant message text', () => {
    const chat = withMessages([
      { id: 'm1', role: 'user', time: 0, content: 'q', attachments: [] },
      { id: 'm2', role: 'assistant', time: 0, think: '', content: 'answer 1', tool_calls: [] },
      { id: 'm3', role: 'assistant', time: 0, think: '', content: 'answer 2 (final)', tool_calls: [] },
    ]);
    const result = inner(chat).extractFinalResult();
    expect(result).toContain('answer 2 (final)');
  });

  it('appends max turns warning when limit reached', () => {
    const chat = withMessages(
      [{ id: 'm1', role: 'assistant', time: 0, think: '', content: 'final', tool_calls: [] }],
      5, // max_turns = 5 in mock config → limit reached
    );
    const result = inner(chat).extractFinalResult();
    expect(result).toContain('final');
    expect(result).toContain('reached max turns limit');
  });

  it('returns fallback string when no assistant text present', () => {
    const chat = withMessages([
      { id: 'm1', role: 'user', time: 0, content: 'q', attachments: [] },
    ]);
    const result = inner(chat).extractFinalResult();
    expect(result).toContain('completed without producing a text result');
  });

  it('appends deliverables section when files tracked', () => {
    const chat = withMessages([
      { id: 'm1', role: 'assistant', time: 0, think: '', content: 'done', tool_calls: [] },
    ]);
    inner(chat).deliverables.push('/out.md');
    const result = inner(chat).extractFinalResult();
    expect(result).toContain('done');
    expect(result).toContain('Deliverables');
    expect(result).toContain('/out.md');
  });
});

// ─── summarizeToolArgs ───

describe('summarizeToolArgs', () => {
  it('uses priority key when present', () => {
    const chat = new SubAgentChat(makeOptions());
    // toolName 与 deliverable tracking 无关 —— 这里只测 summarize 拼接逻辑。
    expect(inner(chat).summarizeToolArgs('shell', { command: 'echo hi' }))
      .toBe('shell: echo hi');
  });

  it('falls back to first string arg when no priority key matches', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(inner(chat).summarizeToolArgs('custom', { foo: 'bar' })).toBe('custom: bar');
  });

  it('returns bare tool name when no string args', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(inner(chat).summarizeToolArgs('noargs', {})).toBe('noargs');
    expect(inner(chat).summarizeToolArgs('numarg', { count: 42 })).toBe('numarg');
  });

  it('truncates long summaries to 200 chars', () => {
    const chat = new SubAgentChat(makeOptions());
    const longContent = 'x'.repeat(300);
    const result = inner(chat).summarizeToolArgs('write', { content: longContent });
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith('...')).toBe(true);
  });
});

// ─── getDeliverablesPath ───

describe('getDeliverablesPath', () => {
  it('prefers explicit deliverablesPath option', () => {
    const chat = new SubAgentChat(makeOptions({
      deliverablesPath: '/explicit',
      subAgent: {
        ...makeOptions().subAgent,
        config: makeConfig({ workspace: '/ws' }),
      },
    }));
    expect(inner(chat).getDeliverablesPath()).toBe('/explicit');
  });

  it('falls back to subAgent workspace when no explicit path', () => {
    const chat = new SubAgentChat(makeOptions({
      deliverablesPath: undefined,
      subAgent: {
        ...makeOptions().subAgent,
        config: makeConfig({ workspace: '/ws' }),
      },
    }));
    expect(inner(chat).getDeliverablesPath()).toBe('/ws');
  });

  it('returns null when neither path is configured', () => {
    const chat = new SubAgentChat(makeOptions({
      deliverablesPath: undefined,
      subAgent: {
        ...makeOptions().subAgent,
        config: makeConfig({ workspace: undefined }),
      },
    }));
    expect(inner(chat).getDeliverablesPath()).toBeNull();
  });
});

// ─── lifecycle smoke ───

describe('lifecycle', () => {
  it('exposes turn count starting at 0', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(chat.getTurnCount()).toBe(0);
  });

  it('dispose is idempotent', () => {
    const chat = new SubAgentChat(makeOptions());
    expect(() => { chat.dispose(); chat.dispose(); }).not.toThrow();
  });
});
