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
let agentId = '';
const PROFILE_ID = 'p_TEST';

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'read-router-it-'));
  agentId = '';
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
    mode: 'agent',
    profileId: PROFILE_ID,
    agentId,
    sessionId: 's',
    signal: new AbortController().signal,
  };
}

async function bindSkill(name: string): Promise<void> {
  const profile = await Profile.getOrLoad(PROFILE_ID);
  let agent = agentId ? await profile.getAgent(agentId) : undefined;
  if (!agent) {
    agent = await profile.createAgent({ name: 'Router Test Agent', version: '1.0.0' });
    agentId = agent.id;
  }
  await agent.patchFront({
    skills: { ...(agent.config.skills ?? {}), [name]: 'live' },
  });
}

async function seedSkill(name: string, body: string): Promise<void> {
  await bindSkill(name);
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

  it('已绑定但不存在的 skill 返回不泄漏路径的 not-found 错误', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await bindSkill('nonexistent');

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

  it('读 skill 目录内子文件 `skill://name/scripts/run.py`', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await seedSkill('alpha', 'body');
    // 在 skill 目录里落一个脚本文件。
    const scriptDir = path.join(tmpRoot, 'profiles', PROFILE_ID, 'skills', 'alpha', 'scripts');
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(path.join(scriptDir, 'run.py'), 'print("hi")\n');

    const resource = await router.resolve('skill://alpha/scripts/run.py', makeCtx());
    expect(resource.url).toBe('skill://alpha/scripts/run.py');
    expect(resource.content).toBe('print("hi")\n');
    expect(resource.contentType).toBe('text/plain');
  });

  it('子文件不存在 → 友好 not found(不暴露绝对路径)', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await seedSkill('alpha', 'body');

    const err = await router
      .resolve('skill://alpha/nope.md', makeCtx())
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/skill:\/\/alpha\/nope\.md not found/);
    expect((err as Error).message).not.toContain(tmpRoot);
  });

  it('`..` 逃逸被拒 —— 限制在 skill 目录内', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await seedSkill('alpha', 'body');

    await expect(
      router.resolve('skill://alpha/../../../etc/passwd', makeCtx()),
    ).rejects.toThrow(/escapes the skill:\/\/ directory/);
  });

  it('安全:`skill://../auth.json`(host=`..`)被拒 —— 挡 profile 认证文件穿越', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    // 落一个 profile 级敏感文件到 skills 目录的父级,验证读不到。
    const profileDir = path.join(tmpRoot, 'profiles', PROFILE_ID);
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'auth.json'), '{"secret":"token"}');

    await expect(
      router.resolve('skill://../auth.json', makeCtx()),
    ).rejects.toThrow(/Invalid skill name/);
  });

  it('安全:host=`..` 裸读(readMarkdown 分支)也被 parse 词法守卫拦下', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());

    await expect(router.resolve('skill://..', makeCtx())).rejects.toThrow(
      /Invalid skill name/,
    );
  });

  it('安全:resolveToPath 上 host=`..` 同样被拒(shell 执行路径)', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());

    await expect(
      router.resolveToPath('skill://../auth.json', makeCtx()),
    ).rejects.toThrow(/Invalid skill name/);
  });

  it('二进制子文件(NUL byte)被拒,只暴露文本', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await seedSkill('alpha', 'body');
    const skillDir = path.join(tmpRoot, 'profiles', PROFILE_ID, 'skills', 'alpha');
    fs.writeFileSync(path.join(skillDir, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02]));

    await expect(
      router.resolve('skill://alpha/blob.bin', makeCtx()),
    ).rejects.toThrow(/appears to be binary/);
  });

  it('主 SKILL.md 也拒绝二进制和超限内容', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await seedSkill('alpha', 'body');
    const skillDir = path.join(tmpRoot, 'profiles', PROFILE_ID, 'skills', 'alpha');

    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), Buffer.from([0x00, 0x01]));
    await expect(router.resolve('skill://alpha', makeCtx())).rejects.toThrow(/appears to be binary/);

    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), Buffer.alloc(1024 * 1024 + 1, 'a'));
    await expect(router.resolve('skill://alpha', makeCtx())).rejects.toThrow(/exceeds .* byte limit/);
  });

  it('主 SKILL.md 的内层 symlink 逃逸被拒', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    const secretPath = path.join(tmpRoot, 'outside-secret');
    fs.writeFileSync(secretPath, 'PRIVATE KEY MATERIAL');

    const externalSkill = path.join(tmpRoot, 'external-skill');
    fs.mkdirSync(externalSkill, { recursive: true });
    fs.symlinkSync(secretPath, path.join(externalSkill, 'SKILL.md'), 'file');
    const skillsRoot = path.join(tmpRoot, 'profiles', PROFILE_ID, 'skills');
    fs.mkdirSync(skillsRoot, { recursive: true });
    fs.symlinkSync(externalSkill, path.join(skillsRoot, 'linked'), 'dir');
    await bindSkill('linked');

    await expect(router.resolve('skill://linked', makeCtx())).rejects.toThrow(
      /escapes the skill:\/\/ directory/,
    );
  });

  it('未绑定的 skill 不能读取或解析执行路径', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await seedSkill('enabled', 'body');
    await new Skills(PROFILE_ID).writeMarkdown('off', 'body');

    await expect(router.resolve('skill://off', makeCtx())).rejects.toThrow(/not enabled/);
    await expect(router.resolveToPath('skill://off', makeCtx())).rejects.toThrow(/not enabled/);
  });

  it('resolveToPath:裸 name → SKILL.md 文件路径(非目录)', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await seedSkill('alpha', 'body');

    const abs = await router.resolveToPath('skill://alpha', makeCtx());
    expect(abs).toBe(
      path.resolve(tmpRoot, 'profiles', PROFILE_ID, 'skills', 'alpha', 'SKILL.md'),
    );
  });

  it('resolveToPath:子路径 → 目录内文件绝对路径', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await seedSkill('alpha', 'body');

    const abs = await router.resolveToPath('skill://alpha/scripts/run.py', makeCtx());
    expect(abs).toBe(
      path.resolve(tmpRoot, 'profiles', PROFILE_ID, 'skills', 'alpha', 'scripts', 'run.py'),
    );
  });

  it('resolveToPath:`..` 逃逸同样被拒', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());
    await seedSkill('alpha', 'body');

    await expect(
      router.resolveToPath('skill://alpha/../evil', makeCtx()),
    ).rejects.toThrow(/escapes the skill:\/\/ directory/);
  });

  it('安全:linked skill 内层 symlink 逃逸到外部机密被拒(resolve 读路径)', async () => {
    // linked skill 的根是指向外部第三方目录的 symlink,其内容 live 可变。攻击场景:
    // 外部目录里藏一个内层 symlink `evil -> <外部机密>`。词法 `..` 检查无法察觉
    // (evil 逻辑上在 skill 目录内),必须靠 realpath containment 拦下。
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());

    const secretDir = path.join(tmpRoot, 'outside-secret');
    fs.mkdirSync(secretDir, { recursive: true });
    fs.writeFileSync(path.join(secretDir, 'id_rsa'), 'PRIVATE KEY MATERIAL');

    const externalSkill = path.join(tmpRoot, 'external-skill');
    fs.mkdirSync(externalSkill, { recursive: true });
    fs.writeFileSync(path.join(externalSkill, 'SKILL.md'), '# linked\n');
    fs.symlinkSync(path.join(secretDir, 'id_rsa'), path.join(externalSkill, 'evil'), 'file');
    fs.symlinkSync(secretDir, path.join(externalSkill, 'evildir'), 'dir');

    // 以 symlink 形式把外部目录 link 进 skills/ —— 复刻 linkSkill 的落地形态。
    const skillsRoot = path.join(tmpRoot, 'profiles', PROFILE_ID, 'skills');
    fs.mkdirSync(skillsRoot, { recursive: true });
    fs.symlinkSync(externalSkill, path.join(skillsRoot, 'linked'), 'dir');
    await bindSkill('linked');

    // 根 SKILL.md 仍可正常读(跟随根链接是预期的)。
    const ok = await router.resolve('skill://linked', makeCtx());
    expect(ok.content).toBe('# linked\n');

    // 内层逃逸链接:文件链接、目录链接下的文件都必须被拒,且错误不含机密内容/绝对路径。
    for (const rel of ['evil', 'evildir/id_rsa']) {
      const err = await router.resolve(`skill://linked/${rel}`, makeCtx()).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/escapes the skill:\/\/ directory/);
      expect((err as Error).message).not.toContain('PRIVATE KEY MATERIAL');
    }
  });

  it('安全:linked skill 内层 symlink 逃逸在 resolveToPath 上也被拒(shell 执行路径)', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());

    const secretDir = path.join(tmpRoot, 'outside-secret');
    fs.mkdirSync(secretDir, { recursive: true });
    fs.writeFileSync(path.join(secretDir, 'key'), 'SECRET');

    const externalSkill = path.join(tmpRoot, 'external-skill');
    fs.mkdirSync(externalSkill, { recursive: true });
    fs.writeFileSync(path.join(externalSkill, 'SKILL.md'), 'ok');
    fs.symlinkSync(path.join(secretDir, 'key'), path.join(externalSkill, 'evil'), 'file');

    const skillsRoot = path.join(tmpRoot, 'profiles', PROFILE_ID, 'skills');
    fs.mkdirSync(skillsRoot, { recursive: true });
    fs.symlinkSync(externalSkill, path.join(skillsRoot, 'linked'), 'dir');
    await bindSkill('linked');

    await expect(
      router.resolveToPath('skill://linked/evil', makeCtx()),
    ).rejects.toThrow(/escapes the skill:\/\/ directory/);
  });

  it('linked skill 内指向自身目录的良性 symlink 不被误伤', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());

    const externalSkill = path.join(tmpRoot, 'external-skill');
    fs.mkdirSync(path.join(externalSkill, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(externalSkill, 'SKILL.md'), 'ok');
    fs.writeFileSync(path.join(externalSkill, 'scripts', 'run.py'), 'print("hi")\n');
    // 良性内部 symlink:别名指向同一 skill 目录内的脚本。
    fs.symlinkSync(path.join(externalSkill, 'scripts', 'run.py'), path.join(externalSkill, 'alias.py'), 'file');

    const skillsRoot = path.join(tmpRoot, 'profiles', PROFILE_ID, 'skills');
    fs.mkdirSync(skillsRoot, { recursive: true });
    fs.symlinkSync(externalSkill, path.join(skillsRoot, 'linked'), 'dir');
    await bindSkill('linked');

    const resource = await router.resolve('skill://linked/alias.py', makeCtx());
    expect(resource.content).toBe('print("hi")\n');
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
