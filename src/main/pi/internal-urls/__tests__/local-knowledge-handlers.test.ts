/**
 * LocalProtocolHandler + KnowledgeProtocolHandler + InternalUrlRouter.write
 * 端到端测试。
 *
 * 用真盘 + 真 SQLite(同 router-skill.test.ts 模式),通过实际 Profile /
 * Agent / RegularSession API 创建 fixture —— 不 mock fs / db,因为我们要验证
 * handler 与 sandbox(`session.filesDir()` / agent KB 解析)的真实联动。
 *
 * 测点矩阵:
 * - LocalProtocolHandler:resolve / write 双向 / 沙盒边界 / 空 path / binary 拒绝 /
 *   1MB 上限 / 不存在文件抛 ResourceNotFoundError / 跨 session ctx 隔离
 * - KnowledgeProtocolHandler:KB 始终 = `${agentRoot}/knowledge`(已撤掉自定义)/
 *   sandbox / 空 path / 不存在文件
 * - InternalUrlRouter.write:dispatch 到 handler / read-only scheme(skill) 拒写 /
 *   未注册 scheme 错误消息列出 supported
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { InternalUrlRouter } from '../router';
import { LocalProtocolHandler } from '../handlers/local-protocol';
import { KnowledgeProtocolHandler } from '../handlers/knowledge-protocol';
import { SkillProtocolHandler } from '../handlers/skill-protocol';
import { ResourceNotFoundError } from '../types';
import type { ResolveContext, WriteContext } from '../types';

import { Profile } from '@main/persist/profile';
import { Profiles } from '@main/persist/profiles';
import { setRootForTesting } from '@main/persist/lib/root';
import { ProfileDb } from '@main/persist/lib/db/db';
import { PERSIST_PATH } from '@shared/persist/path';

let tmpRoot = '';
let profileId = '';
let agentId = '';
let sessionId = '';

async function seedProfileAgentSession(): Promise<void> {
  // 真盘 + 真 SQLite。Profile.getOrLoad 会创建 ProfileDb(better-sqlite3),
  // 测试环境下走 ELECTRON_RUN_AS_NODE=1 跑 vitest(见 CLAUDE.md)。
  const profile = await Profile.getOrLoad(profileId);
  const agent = await profile.createAgent({
    name: 'TestAgent',
    version: '1.0.0',
  });
  agentId = agent.id;
  const session = await agent.createSession({ title: 'sandbox' });
  sessionId = session.id;
  // session.filesDir() 写入时按需创建,但我们手动 ensure 一次,让"读不存在文件"
  // 路径有清晰的 ENOENT(而不是因目录缺失生出 EISDIR 之类)。
  await fsp.mkdir(session.filesDir(), { recursive: true });
}

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-knowledge-it-'));
  setRootForTesting(tmpRoot);
  // 跨用例污染清理 —— Profile / Profiles / DB / router 各自单例。
  Profiles.resetForTesting();
  ProfileDb.closeAll();
  ProfileDb.resetForTesting();
  InternalUrlRouter.resetForTesting();

  profileId = `p_TEST_${Math.random().toString(36).slice(2, 8)}`;
  await seedProfileAgentSession();
});

afterEach(() => {
  Profile.evict(profileId);
  Profiles.resetForTesting();
  ProfileDb.closeAll();
  ProfileDb.resetForTesting();
  setRootForTesting(null);
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  InternalUrlRouter.resetForTesting();
});

function makeCtx(): ResolveContext & WriteContext {
  return {
    mode: 'agent',
    profileId,
    agentId,
    sessionId,
    signal: new AbortController().signal,
  };
}

// ---------------------------------------------------------------------------
// LocalProtocolHandler
// ---------------------------------------------------------------------------

describe('LocalProtocolHandler', () => {
  it('write 后 resolve 能拿到完整内容(roundtrip)', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    const body = '# notes\n\nhello world\n';
    await router.write('local://notes.md', body, makeCtx());

    const resource = await router.resolve('local://notes.md', makeCtx());
    expect(resource.url).toBe('local://notes.md');
    expect(resource.content).toBe(body);
    expect(resource.contentType).toBe('text/markdown');
    expect(resource.immutable).toBe(false);
  });

  it('resolve 不存在文件抛 ResourceNotFoundError', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    await expect(router.resolve('local://nope.md', makeCtx())).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it('subdirectory 可写 + 可读', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    await router.write('local://uploads/photo.txt', 'fake', makeCtx());
    const resource = await router.resolve('local://uploads/photo.txt', makeCtx());
    expect(resource.content).toBe('fake');
    expect(resource.url).toBe('local://uploads/photo.txt');
  });

  it('沙盒边界:`..` 越界写入抛错', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    await expect(
      router.write('local://../../etc/passwd', 'pwn', makeCtx()),
    ).rejects.toThrow(/escapes the local:\/\/ sandbox/);
  });

  it('沙盒边界:`..` 越界读取抛错', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    await expect(
      router.resolve('local://../../etc/hosts', makeCtx()),
    ).rejects.toThrow(/escapes the local:\/\/ sandbox/);
  });

  it('空 path 抛友好错误', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    await expect(router.resolve('local://', makeCtx())).rejects.toThrow(
      /requires a path/,
    );
  });

  it('binary 文件(NUL byte)拒绝', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    // 直接写一个含 NUL 的二进制文件到 session sandbox(绕开 handler.write 走真 fs)
    const profile = await Profile.getOrLoad(profileId);
    const agent = await profile.getAgent(agentId);
    const session = await agent!.getSession(sessionId);
    const filesDir = session!.filesDir();
    await fsp.mkdir(filesDir, { recursive: true });
    const binPath = path.join(filesDir, 'image.bin');
    await fsp.writeFile(binPath, Buffer.from([0x42, 0x00, 0x42, 0x42]));

    await expect(router.resolve('local://image.bin', makeCtx())).rejects.toThrow(
      /appears to be binary/,
    );
  });

  it('1MB 上限:超过抛错', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    // 写 1MB + 1 byte 文件,绕 handler 直写盘以快速触发 size 守卫(handler.write
    // 自身没装 size cap;cap 是 read 路径的;这里只测 read 路径)。
    const profile = await Profile.getOrLoad(profileId);
    const agent = await profile.getAgent(agentId);
    const session = await agent!.getSession(sessionId);
    const filesDir = session!.filesDir();
    await fsp.mkdir(filesDir, { recursive: true });
    const big = path.join(filesDir, 'big.txt');
    await fsp.writeFile(big, 'x'.repeat(1 * 1024 * 1024 + 1));

    await expect(router.resolve('local://big.txt', makeCtx())).rejects.toThrow(
      /exceeds 1048576 byte limit/,
    );
  });

  it('directory(非文件)拒绝', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    const profile = await Profile.getOrLoad(profileId);
    const agent = await profile.getAgent(agentId);
    const session = await agent!.getSession(sessionId);
    await fsp.mkdir(path.join(session!.filesDir(), 'sub'), { recursive: true });

    await expect(router.resolve('local://sub', makeCtx())).rejects.toThrow(
      /is a directory/,
    );
  });

  it('immutable=false(scheme-level) —— router 回填', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    await router.write('local://m.md', 'x', makeCtx());
    const resource = await router.resolve('local://m.md', makeCtx());
    expect(resource.immutable).toBe(false);
  });

  it('跨 session 隔离 —— session A 写的文件 session B 读不到', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    // 写到 sessionA
    await router.write('local://shared.md', 'A wrote this', makeCtx());

    // 切到第二个 session
    const profile = await Profile.getOrLoad(profileId);
    const agent = await profile.getAgent(agentId);
    const sessionB = await agent!.createSession({ title: 'B' });
    const ctxB: ResolveContext = {
      mode: 'agent',
      profileId,
      agentId,
      sessionId: sessionB.id,
      signal: new AbortController().signal,
    };

    await expect(router.resolve('local://shared.md', ctxB)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// KnowledgeProtocolHandler
// ---------------------------------------------------------------------------

describe('KnowledgeProtocolHandler', () => {
  it('default KB(无 config)→ ${agentRoot}/knowledge', async () => {
    const router = InternalUrlRouter.get();
    router.register(new KnowledgeProtocolHandler());

    const body = '# kb entry\n';
    await router.write('knowledge://entry.md', body, makeCtx());

    // 验证落盘位置 = ${agentRoot}/knowledge/entry.md
    const expected = path.join(
      PERSIST_PATH.agentKnowledge(tmpRoot, profileId, agentId),
      'entry.md',
    );
    const onDisk = await fsp.readFile(expected, 'utf-8');
    expect(onDisk).toBe(body);

    const resource = await router.resolve('knowledge://entry.md', makeCtx());
    expect(resource.url).toBe('knowledge://entry.md');
    expect(resource.content).toBe(body);
    expect(resource.contentType).toBe('text/markdown');
    expect(resource.immutable).toBe(false);
  });


  it('resolve 不存在文件抛 ResourceNotFoundError', async () => {
    const router = InternalUrlRouter.get();
    router.register(new KnowledgeProtocolHandler());

    await expect(router.resolve('knowledge://nope.md', makeCtx())).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it('沙盒边界:`..` 越界拒绝', async () => {
    const router = InternalUrlRouter.get();
    router.register(new KnowledgeProtocolHandler());

    await expect(
      router.write('knowledge://../escape.md', 'x', makeCtx()),
    ).rejects.toThrow(/escapes the knowledge:\/\/ sandbox/);
  });

  it('空 path 抛友好错误', async () => {
    const router = InternalUrlRouter.get();
    router.register(new KnowledgeProtocolHandler());

    await expect(router.resolve('knowledge://', makeCtx())).rejects.toThrow(
      /requires a path/,
    );
  });
});

// ---------------------------------------------------------------------------
// InternalUrlRouter.write dispatch
// ---------------------------------------------------------------------------

describe('InternalUrlRouter.write', () => {
  it('dispatch 到对应 handler.write', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    await router.write('local://dispatched.md', 'ok', makeCtx());
    const resource = await router.resolve('local://dispatched.md', makeCtx());
    expect(resource.content).toBe('ok');
  });

  it('read-only scheme(skill://)拒绝写入,错误对 LLM 友好', async () => {
    const router = InternalUrlRouter.get();
    router.register(new SkillProtocolHandler());

    await expect(router.write('skill://foo', 'x', makeCtx())).rejects.toThrow(
      /read-only/,
    );
  });

  it('未注册 scheme 抛错并列出 supported', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    await expect(
      router.write('memory://something', 'x', makeCtx()),
    ).rejects.toThrow(/memory:\/\/[\s\S]*Supported.*local:\/\//);
  });

  it('非 internal URL 输入 → parser 抛(透传)', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    await expect(router.write('/abs/path', 'x', makeCtx())).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// LocalProtocolHandler × JobRun
//
// 调度任务的 turn loop 注入 ToolContext.sessionId = JobRun.id;handler 必须能
// 解析到 `agents/{a}/schedules/{j}/runs/{ym}/{s}/files/`(与 RegularSession 的
// `agents/{a}/sessions/{ym}/{s}/files/` 物理隔离)。
// ---------------------------------------------------------------------------

describe('LocalProtocolHandler × JobRun', () => {
  async function seedJobRun(): Promise<{ jobId: string; runId: string; runFilesDir: string }> {
    const profile = await Profile.getOrLoad(profileId);
    const agent = await profile.getAgent(agentId);
    if (!agent) throw new Error('seed: agent missing');
    const job = await agent.createJob({
      scheduleType: 'cron',
      name: 'nightly',
      message: 'run',
      enabled: true,
      cron: '0 0 * * *',
    });
    const run = await job.startRun({ startedAt: new Date().toISOString() });
    // 与 RegularSession fixture 一致:filesDir() 在写入时按需创建,这里手动 ensure
    // 让"读不存在文件"得到清晰 ENOENT。
    await fsp.mkdir(run.filesDir(), { recursive: true });
    return { jobId: job.id, runId: run.id, runFilesDir: run.filesDir() };
  }

  function ctxFor(runId: string): ResolveContext & WriteContext {
    return {
      mode: 'agent',
      profileId,
      agentId,
      sessionId: runId,
      signal: new AbortController().signal,
    };
  }

  it('write/read roundtrip —— sessionId 是 JobRun id', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    const { runId, runFilesDir } = await seedJobRun();
    const body = '# job run notes\n';
    await router.write('local://run.md', body, ctxFor(runId));

    // 物理落盘位置 = JobRun.filesDir(),与 RegularSession 完全独立
    const onDisk = await fsp.readFile(path.join(runFilesDir, 'run.md'), 'utf-8');
    expect(onDisk).toBe(body);

    const resource = await router.resolve('local://run.md', ctxFor(runId));
    expect(resource.url).toBe('local://run.md');
    expect(resource.content).toBe(body);
  });

  it('resolveToPath 命中 JobRun.filesDir() 而非 RegularSession 路径', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    const { runId, runFilesDir } = await seedJobRun();
    const dir = await router.resolveToPath('local://', ctxFor(runId));
    // 实际路径必须落在 schedules/{j}/runs/{ym}/{s}/ 树下,不在 sessions/ 树下。
    // resolveToPath 走 nodePath.resolve → 原生分隔符;filesDir() 是 PERSIST_PATH 正斜杠
    // 拼接,Windows 上两者分隔符不同(但指向同一目录),故比较前统一 resolve。
    expect(path.resolve(dir)).toBe(path.resolve(runFilesDir));
    const normDir = dir.split(path.sep).join('/');
    expect(normDir).toContain('/schedules/');
    expect(normDir).not.toContain('/sessions/');
  });

  it('沙盒边界:JobRun ctx 下 `..` 越界仍拒绝', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    const { runId } = await seedJobRun();
    await expect(
      router.write('local://../../etc/passwd', 'pwn', ctxFor(runId)),
    ).rejects.toThrow(/escapes the local:\/\/ sandbox/);
  });

  it('Regular vs JobRun 隔离 —— 同名文件互不可见', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    // RegularSession(seedProfileAgentSession 已建)写入
    await router.write('local://shared.md', 'regular wrote', makeCtx());

    // JobRun 看不到 RegularSession 的文件
    const { runId } = await seedJobRun();
    await expect(router.resolve('local://shared.md', ctxFor(runId))).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );

    // 反向:JobRun 写入,RegularSession 看不到
    await router.write('local://shared.md', 'run wrote', ctxFor(runId));
    const fromRegular = await router.resolve('local://shared.md', makeCtx());
    expect(fromRegular.content).toBe('regular wrote');
    const fromRun = await router.resolve('local://shared.md', ctxFor(runId));
    expect(fromRun.content).toBe('run wrote');
  });

  it('未知 sessionId(既非 regular 也非 job_run)→ Session not found', async () => {
    const router = InternalUrlRouter.get();
    router.register(new LocalProtocolHandler());

    await expect(
      router.resolve('local://x.md', {
        mode: 'agent',
        profileId,
        agentId,
        sessionId: 's_nonexistent_xxx',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/Session not found/);
  });
});
