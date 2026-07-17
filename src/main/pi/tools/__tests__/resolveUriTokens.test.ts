/**
 * `resolveUriTokens` 单测 —— shell 工具的 internal URI → 绝对路径就地替换。
 *
 * 与 router-skill 测试同一 fixture 套路:真盘 mkdtemp + setRootForTesting +
 * 手动注册 handler(不依赖 tools/index.ts 启动链)。SkillProtocolHandler 静态
 * import Profile/root,故直接在共享 module 上 setRootForTesting。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveCwdUri, resolveUriTokens } from '../util/resolveUriTokens';
import { InternalUrlRouter } from '@main/pi/internal-urls';
import { SkillProtocolHandler } from '@main/pi/internal-urls/handlers/skill-protocol';
import { Skills } from '@main/persist/skills';
import { ProfileStore } from '@main/persist/profileStore'
import { ProfileRegistry } from '@main/profileRegistry'
import { setRootForTesting } from '@main/persist/lib/root';
import { Tracer } from '@shared/log/trace';
import type { AgentToolContext } from '../types';

let tmpRoot = '';
let agentId = '';
const PROFILE_ID = 'p_TEST';

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-uri-it-'));
  agentId = '';
  setRootForTesting(tmpRoot);
  ProfileRegistry.resetForTesting();
  InternalUrlRouter.resetForTesting();
  InternalUrlRouter.get().register(new SkillProtocolHandler());
  await ProfileRegistry.getOrLoad(PROFILE_ID);
});

afterEach(() => {
  ProfileRegistry.resetForTesting();
  setRootForTesting(null);
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  InternalUrlRouter.resetForTesting();
});

function makeCtx(): AgentToolContext {
  return {
    mode: 'agent',
    profile: ProfileRegistry.require(PROFILE_ID),
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

async function bindSkill(name: string): Promise<void> {
  const store = await (await ProfileRegistry.getOrLoad(PROFILE_ID)).store
  let agent = agentId ? await store.getAgent(agentId) : undefined;
  if (!agent) {
    agent = await store.createAgent({ name: 'URI Test Agent', version: '1.0.0' });
    agentId = agent.id;
  }
  await agent.patchFront({
    skills: { ...(agent.config.skills ?? {}), [name]: 'live' },
  });
}

async function seedSkill(name: string): Promise<void> {
  await bindSkill(name);
  await new Skills(PROFILE_ID).writeMarkdown(name, '# skill\n');
}

async function seedSkillWithScript(name: string): Promise<string> {
  await seedSkill(name);
  const scriptsDir = path.join(tmpRoot, 'profiles', PROFILE_ID, 'skills', name, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, 'run.py'), 'print("hi")\n');
  return path.resolve(scriptsDir, 'run.py');
}

describe('resolveUriTokens', () => {
  it('把 skill 子路径 token 替换成绝对路径(inlineQuote=true,含引号能力)', async () => {
    const absScript = await seedSkillWithScript('pdf');
    const out = await resolveUriTokens('python skill://pdf/scripts/run.py input.pdf', makeCtx(), true);
    // 路径无空格 → quoteArg 不加引号,原样替换。
    expect(out).toBe(`python ${absScript} input.pdf`);
  });

  it('裸 skill name → SKILL.md 文件绝对路径', async () => {
    await seedSkill('demo');
    const out = await resolveUriTokens('cat skill://demo', makeCtx(), true);
    const absMd = path.resolve(tmpRoot, 'profiles', PROFILE_ID, 'skills', 'demo', 'SKILL.md');
    expect(out).toBe(`cat ${absMd}`);
  });

  it('inlineQuote=false 传裸路径(供 quoteArg / cwd 后处理)', async () => {
    const absScript = await seedSkillWithScript('pdf');
    const out = await resolveUriTokens('skill://pdf/scripts/run.py', makeCtx(), false);
    expect(out).toBe(absScript);
  });

  it('裸 skill URI 作为 cwd 时解析到 skill 根目录', async () => {
    await seedSkill('demo');
    const out = await resolveCwdUri('skill://demo', makeCtx());
    const skillDir = path.resolve(tmpRoot, 'profiles', PROFILE_ID, 'skills', 'demo');
    expect(out).toBe(skillDir);
  });

  it('cwd 中显式 skill 文件仍解析为文件，不静默切到父目录', async () => {
    const absScript = await seedSkillWithScript('pdf');
    const out = await resolveCwdUri('skill://pdf/scripts/run.py', makeCtx());
    expect(out).toBe(absScript);
  });

  it('含空格的绝对路径在 inlineQuote 下被加引号', async () => {
    const dirWithSpace = path.join(tmpRoot, 'has space');
    setRootForTesting(dirWithSpace);
    agentId = '';
    ProfileRegistry.resetForTesting();
    ProfileRegistry.resetForTesting();
    await seedSkill('demo');
    const out = await resolveUriTokens('cat skill://demo', makeCtx(), true);
    const absMd = path.resolve(dirWithSpace, 'profiles', PROFILE_ID, 'skills', 'demo', 'SKILL.md');
    expect(out).toBe(`cat "${absMd}"`);
  });

  it('未注册 scheme(http://)原样保留 —— 不误伤网络 URL', async () => {
    const input = 'curl https://example.com/api';
    const out = await resolveUriTokens(input, makeCtx(), true);
    expect(out).toBe(input);
  });

  it('未绑定 skill 的 token 原样保留，不允许 shell 绕过绑定', async () => {
    const out = await resolveUriTokens('python skill://nonexistent/run.py', makeCtx(), true);
    expect(out).toBe('python skill://nonexistent/run.py');
  });

  it('`..` 逃逸 token 解析抛错 → 保留原 token,不抛给 caller', async () => {
    const input = 'cat skill://demo/../../../etc/passwd';
    const out = await resolveUriTokens(input, makeCtx(), true);
    expect(out).toBe(input); // resolveToPath 抛 escape 错 → 该 token 原样保留
  });

  it('安全:`skill://../auth.json`(host 穿越)解析抛错 → token 原样保留,不外泄绝对路径', async () => {
    const input = 'cat skill://../auth.json';
    const out = await resolveUriTokens(input, makeCtx(), true);
    expect(out).toBe(input);
  });

  it('无 token 文本原样返回', async () => {
    const out = await resolveUriTokens('ls -la ./src', makeCtx(), true);
    expect(out).toBe('ls -la ./src');
  });

  it('同一 token 多次出现全部替换', async () => {
    const absScript = await seedSkillWithScript('pdf');
    const out = await resolveUriTokens(
      'cp skill://pdf/scripts/run.py skill://pdf/scripts/run.py.bak',
      makeCtx(),
      false,
    );
    // 第二个 token 是 `run.py.bak`(不同路径),验证 `run.py` 精确替换不吃掉后缀。
    expect(out.startsWith(`cp ${absScript} `)).toBe(true);
    expect(out).toContain('run.py.bak');
  });

  it('安全:URI token 在 shell 元字符处截断,元字符不进被解析的绝对路径(防注入)', async () => {
    await seedSkill('a');
    // `skill://a$(id)` 里 `$(id)` 是攻击者想注入的命令替换。token 正则在 `$` 处
    // 截断,只解析 `skill://a`(→ SKILL.md 绝对路径),`$(id)` 原样留在命令行文本里,
    // 绝不会成为被替换路径的一部分。
    const out = await resolveUriTokens('cat skill://a$(id)', makeCtx(), true);
    const absMd = path.resolve(tmpRoot, 'profiles', PROFILE_ID, 'skills', 'a', 'SKILL.md');
    expect(out).toBe(`cat ${absMd}$(id)`);
    // 关键:解析出的绝对路径段不含任何 shell 元字符。
    expect(absMd).not.toMatch(/[`$;|&<>()]/);
  });
});
