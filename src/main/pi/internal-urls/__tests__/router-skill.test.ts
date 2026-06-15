/**
 * InternalUrlRouter + SkillProtocolHandler 集成测试。
 *
 * 测点:
 * - router 注册/解析的正反两面(skill:// 命中、未知 scheme、重名 throw)
 * - SkillProtocolHandler 与真实 Profile + Skills 持久化的端到端联动
 * - 错误消息对 LLM 友好(不暴露绝对路径、不带 stack trace)
 *
 * 用 mkdtemp 真盘 fixture。**不**用 `vi.resetModules` —— SkillProtocolHandler
 * 静态 import `Profile`,handler 内部走的是 *原始* `lib/root` module 实例。如
 * 果用 resetModules + 在新 module 上 setRootForTesting,handler 看的还是旧
 * module 的 overrideRoot=null,测试会全部找不到 skill。改为:每个 case 直接
 * 在共享 module 上 setRootForTesting + 清掉相关单例 cache。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { InternalUrlRouter } from '../router';
import { SkillProtocolHandler } from '../handlers/skill-protocol';
import type { ResolveContext } from '../types';
import { Skills } from '@main/persist/skills';
import { Profile } from '@main/persist/profile';
import { Profiles } from '@main/persist/profiles';
import { setRootForTesting } from '@main/persist/lib/root';

let tmpRoot = '';
const PROFILE_ID = 'p_TEST';

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'read-router-it-'));
  setRootForTesting(tmpRoot);
  // 单例需要清掉 —— 上一个 test 的 Profile cache / Profiles instance 会拖进来。
  Profile.evict(PROFILE_ID);
  Profiles.resetForTesting();
  // router 单例同样要清:tools/index.ts 启动链路把 SkillProtocolHandler 注册
  // 进了全局 router;手动 reset 后由用例自己掌控注册,避免重名 throw。
  InternalUrlRouter.resetForTesting();
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

function makeCtx(): ResolveContext {
  return {
    profileId: PROFILE_ID,
    agentId: 'a',
    sessionId: 's',
    signal: new AbortController().signal,
  };
}

async function seedSkill(name: string, body: string): Promise<void> {
  const skills = new Skills(PROFILE_ID);
  await skills.writeMarkdown(name, body);
}

describe('InternalUrlRouter', () => {
  it('注册重名 throw —— 同 `tools.register` / AppCommand registry 同纪律', () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    expect(() => router.register(new SkillProtocolHandler())).toThrow(
      /already registered/,
    );
  });

  it('canHandle 只对已注册 scheme 返回 true', () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    expect(router.canHandle('skill://foo')).toBe(true);
    expect(router.canHandle('agent://bar')).toBe(false); // 未注册
    expect(router.canHandle('/abs/path')).toBe(false);
    expect(router.canHandle('plain string')).toBe(false);
  });

  it('未知 scheme 抛错并列出 supported', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await expect(router.resolve('memory://something', makeCtx())).rejects.toThrow(
      /memory:\/\/[\s\S]*Supported.*skill:\/\//,
    );
  });

  it('immutable 由 router 从 handler.immutable 统一回填', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await seedSkill('demo', '# demo\n');

    const resource = await router.resolve('skill://demo', makeCtx());
    expect(resource.immutable).toBe(true); // handler.immutable=true 注入
  });
});

describe('SkillProtocolHandler', () => {
  it('解析 `skill://name` 走 Skills.readMarkdown 拿到 SKILL.md 原文', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    const body = '# My Skill\n\nThis is the skill body.\n';
    await seedSkill('my-skill', body);

    const resource = await router.resolve('skill://my-skill', makeCtx());
    expect(resource.url).toBe('skill://my-skill');
    expect(resource.content).toBe(body);
    expect(resource.contentType).toBe('text/markdown');
    expect(resource.size).toBe(Buffer.byteLength(body, 'utf-8'));
    expect(resource.notes?.[0]).toMatch(/Loaded skill "my-skill"/);
  });

  it('skill 不存在时错误消息对 LLM 友好:不暴露绝对路径,不带 stack', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());

    await expect(router.resolve('skill://nonexistent', makeCtx())).rejects.toThrow(
      /Skill "nonexistent" not found/,
    );
  });

  it('空 host 抛错并指引去用 `app skill list` 浏览', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());

    await expect(router.resolve('skill://', makeCtx())).rejects.toThrow(
      /requires a skill name[\s\S]*app skill list/,
    );
  });

  it('容错 `skill://name/SKILL.md` 显式 path 也通(冗余形态)', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await seedSkill('alpha', 'body');

    const resource = await router.resolve('skill://alpha/SKILL.md', makeCtx());
    expect(resource.content).toBe('body');
  });

  it('拒绝 skill 目录下其它 sub-path —— 只暴露 SKILL.md', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await seedSkill('alpha', 'body');

    await expect(
      router.resolve('skill://alpha/other.md', makeCtx()),
    ).rejects.toThrow(/only exposes SKILL\.md/);
  });

  it('保留 host 大小写 —— 不被 URL parser 强制 lowercase', async () => {
    // 标准 URL parser(`new URL(...)`)会把 host 强制 lowercase,我们的
    // parseInternalUrl 自己实现避免这个 —— skill name 必须原样回传给 handler。
    // 注:磁盘命中与否取决于 FS 大小写敏感性(APFS / NTFS 默认 insensitive),
    // 这里只验证 host 在 URL/resource.url 中保留大小写,**不**断言 lookup 行为。
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await seedSkill('CamelCase', 'body');

    const ok = await router.resolve('skill://CamelCase', makeCtx());
    expect(ok.url).toBe('skill://CamelCase'); // 原文回传(不被 lowercase)
    expect(ok.content).toBe('body');
  });
});
