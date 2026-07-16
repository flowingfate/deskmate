/**
 * `read` 工具端到端集成测试 —— filesystem + internal-url 两条 backend。
 *
 * Office backend 单独测在 `office-backend.test.ts`(需要 vi.mock 拦截
 * `impl/readOfficeFile` 重模块顶层 import,放在独立文件让本测试保持轻
 * dependencies)。
 *
 * 重点覆盖:
 * - 本地文件 + range/page selector → filesystem backend(office 走自己的 test)
 * - skill:// + selector → InternalUrlRouter 路径,返回 InternalUrlReadResult
 * - selector 错误形态 → ToolResult 透传错误
 *
 * 与 router-skill 测试共用 mkdtemp + setRootForTesting 套路(同理由:不能
 * 用 vi.resetModules,handler 静态 import Profile)。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { read } from '../../read';
import { InternalUrlRouter } from '@main/pi/internal-urls/router';
import { SkillProtocolHandler } from '@main/pi/internal-urls/handlers/skill-protocol';
import { Profile } from '@main/persist/profile';
import { Profiles } from '@main/persist/profiles';
import { Skills } from '@main/persist/skills';
import { setRootForTesting } from '@main/persist/lib/root';
import type { ToolContext } from '../../types';
import { Tracer } from '@shared/log/trace';

let tmpRoot = '';
let agentId = '';
const PROFILE_ID = 'p_TEST';

function makeCtx(): ToolContext {
  return {
    mode: 'agent',
    profileId: PROFILE_ID,
    agentId,
    sessionId: 's',
    signal: new AbortController().signal,
    eventSender: null,
    tracer: Tracer.noop,
    callId: 'c',
    chunkStream: null,
  };
}

async function seedSkill(name: string, content: string): Promise<void> {
  const profile = await Profile.getOrLoad(PROFILE_ID);
  let agent = agentId ? await profile.getAgent(agentId) : undefined;
  if (!agent) {
    agent = await profile.createAgent({ name: 'Read Tool Test Agent', version: '1.0.0' });
    agentId = agent.id;
  }
  await agent.patchFront({
    skills: { ...(agent.config.skills ?? {}), [name]: 'live' },
  });
  await new Skills(PROFILE_ID).writeMarkdown(name, content);
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'read-tool-it-'));
  agentId = '';
  setRootForTesting(tmpRoot);
  Profile.evict(PROFILE_ID);
  Profiles.resetForTesting();
  InternalUrlRouter.resetForTesting();
  // 本测试需要 router 真注册 skill handler,因为 read.handler 走 dispatch →
  // internal-url backend → router.resolve。
  InternalUrlRouter.get().register(new SkillProtocolHandler());
});

afterEach(() => {
  Profile.evict(PROFILE_ID);
  setRootForTesting(null);
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  InternalUrlRouter.resetForTesting();
});

function parseToolResultContent(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

describe('read tool — filesystem backend', () => {
  it('读普通文本文件,默认 selector → 全文返回', async () => {
    const file = path.join(tmpRoot, 'hello.txt');
    fs.writeFileSync(file, 'line1\nline2\nline3\n');

    const result = await read.handler({ path: file }, makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return; // type narrow
    const parsed = parseToolResultContent(result.content);
    expect(parsed.content).toBe('line1\nline2\nline3');
    expect(parsed.startLine).toBe(1);
    expect(parsed.endLine).toBe(3);
    expect(parsed.fileName).toBe('hello.txt');
  });

  it('读带 range selector:path:2-3 → 切到第 2-3 行', async () => {
    const file = path.join(tmpRoot, 'multi.txt');
    fs.writeFileSync(file, 'l1\nl2\nl3\nl4\nl5\n');

    const result = await read.handler({ path: `${file}:2-3` }, makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseToolResultContent(result.content);
    expect(parsed.content).toBe('l2\nl3');
    expect(parsed.startLine).toBe(2);
    expect(parsed.endLine).toBe(3);
  });

  it('单行 anchor:path:N → 只返回那一行(N+1 形态等价)', async () => {
    const file = path.join(tmpRoot, 'single.txt');
    fs.writeFileSync(file, 'a\nb\nc\nd\n');

    const result = await read.handler({ path: `${file}:2` }, makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseToolResultContent(result.content);
    expect(parsed.content).toBe('b');
    expect(parsed.startLine).toBe(2);
    expect(parsed.endLine).toBe(2);
  });

  it('count 形态:path:N+K → K 行起于第 N 行', async () => {
    const file = path.join(tmpRoot, 'count.txt');
    fs.writeFileSync(file, ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'].join('\n'));

    const result = await read.handler({ path: `${file}:3+2` }, makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseToolResultContent(result.content);
    expect(parsed.content).toBe('l3\nl4');
    expect(parsed.startLine).toBe(3);
    expect(parsed.endLine).toBe(4);
  });

  it('selector 范围越界(end<start)→ 抛错被 registry 收成 ok:false', async () => {
    // `path:50-1` 中 `50-1` 匹配 SELECTOR_CHUNK_RE,但 parseLineRangeChunk
    // 看到 end < start 抛 Error(消息含 "must be >= start")。这是 parser
    // 的"严格越界检查"红线。注:像 `:bogus` 这种"看起来就不是 selector"
    // 的尾段 splitPathAndSel 直接当 path 处理(failsafe),不算 selector 错。
    const file = path.join(tmpRoot, 'x.txt');
    fs.writeFileSync(file, 'x');
    await expect(read.handler({ path: `${file}:50-1` }, makeCtx())).rejects.toThrow(
      /must be >= start/,
    );
  });
});

describe('read tool — internal-url backend (skill://)', () => {
  it('读 skill://name → router 返回的 markdown 进 content', async () => {
    const body = '# Skill Title\n\nbody line 1\nbody line 2\n';
    await seedSkill('demo', body);
    const result = await read.handler({ path: 'skill://demo' }, makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseToolResultContent(result.content);
    expect(parsed.content).toBe(body); // split('\n').join('\n') 是无损 round-trip
    expect(parsed.contentType).toBe('text/markdown');
    expect(parsed.url).toBe('skill://demo');
    expect(parsed.immutable).toBe(true);
    expect(parsed.fileName).toBe('demo');
  });

  it('skill://name + range selector → 在 markdown 上按行切片', async () => {
    const body = 'L1\nL2\nL3\nL4\nL5';
    await seedSkill('multi', body);
    const result = await read.handler({ path: 'skill://multi:2-3' }, makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseToolResultContent(result.content);
    expect(parsed.content).toBe('L2\nL3');
    expect(parsed.startLine).toBe(2);
    expect(parsed.endLine).toBe(3);
    expect(parsed.totalLines).toBe(5);
  });

  it('已绑定但不存在的 skill → 抛错(handler 透传,registry 在外层落 ok:false)', async () => {
    await seedSkill('nonexistent', 'placeholder');
    fs.rmSync(path.join(tmpRoot, 'profiles', PROFILE_ID, 'skills', 'nonexistent'), { recursive: true });
    await expect(
      read.handler({ path: 'skill://nonexistent' }, makeCtx()),
    ).rejects.toThrow(/not found/);
  });

  it('未注册 scheme(memory://) → 抛错列出 supported', async () => {
    await expect(
      read.handler({ path: 'memory://something' }, makeCtx()),
    ).rejects.toThrow(/Supported.*skill:\/\//);
  });
});
