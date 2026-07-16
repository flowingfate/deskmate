/**
 * `write` 工具:internal URL 路径的 mode 集成测试。
 *
 * 重点验证 `writeInternal` 在 internal URL 分支下,4 种 mode(overwrite /
 * append / prepend / insert)的最终落盘内容正确 —— 因为 mode 计算逻辑跨
 * filesystem 与 internal URL 共享,要保证 internal URL 路径下读原文走的是
 * `router.resolve` 而不是 `fs.readFile`(该错误原本会让 append/prepend/insert
 * 静默退化成 overwrite "新建" 形态)。
 *
 * 用真盘 + 真 SQLite + 真 LocalProtocolHandler 链路。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { writeInternal, clearAllWriteSessions } from '../write';
import type { ToolContext } from '../types';

import { Profile } from '@main/persist/profile';
import { Profiles } from '@main/persist/profiles';
import { setRootForTesting } from '@main/persist/lib/root';
import { ProfileDb } from '@main/persist/lib/db/db';
import { InternalUrlRouter } from '@main/pi/internal-urls';
import { LocalProtocolHandler } from '@main/pi/internal-urls/handlers/local-protocol';
import { SkillProtocolHandler } from '@main/pi/internal-urls/handlers/skill-protocol';
import { Tracer } from '@shared/log/trace';

let tmpRoot = '';
let profileId = '';
let agentId = '';
let sessionId = '';

async function seed(): Promise<void> {
  const profile = await Profile.getOrLoad(profileId);
  const agent = await profile.createAgent({ name: 'WriteTest', version: '1.0.0' });
  agentId = agent.id;
  const session = await agent.createSession({ title: 'sandbox' });
  sessionId = session.id;
}

function makeCtx(): ToolContext {
  return {
    mode: 'agent',
    profileId,
    agentId,
    sessionId,
    signal: new AbortController().signal,
    eventSender: null,
    tracer: Tracer.noop,
    callId: 'c_test',
    chunkStream: null,
  };
}

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'write-internal-url-it-'));
  setRootForTesting(tmpRoot);
  Profiles.resetForTesting();
  ProfileDb.closeAll();
  ProfileDb.resetForTesting();
  InternalUrlRouter.resetForTesting();
  clearAllWriteSessions();

  // 注册 LocalProtocolHandler —— 测试用例显式管理 router,不走 index.ts 的
  // 全局 register(避免与重置的 router 单例冲突)。
  InternalUrlRouter.get().register(new LocalProtocolHandler());

  profileId = `p_TEST_${Math.random().toString(36).slice(2, 8)}`;
  await seed();
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
  clearAllWriteSessions();
});

describe('writeInternal — internal URL dispatch', () => {
  it('overwrite 模式:首次写 → 文件存在;再写 → 内容覆盖', async () => {
    const r1 = await writeInternal(
      {
        description: 'create',
        fileUri: 'local://notes.md',
        content: 'first',
      },
      { ctx: makeCtx() },
    );
    expect(r1.success).toBe(true);
    expect(r1.fileUri).toBe('local://notes.md');
    expect(r1.bytesWritten).toBe(Buffer.byteLength('first', 'utf-8'));

    const r2 = await writeInternal(
      {
        description: 'overwrite',
        fileUri: 'local://notes.md',
        content: 'second',
      },
      { ctx: makeCtx() },
    );
    expect(r2.success).toBe(true);

    const onDisk = await readFromSandbox('notes.md');
    expect(onDisk).toBe('second');
  });

  it('append 模式:在已有内容后追加(读 router.resolve 拿到原文)', async () => {
    await writeInternal(
      {
        description: 'init',
        fileUri: 'local://log.txt',
        content: 'line1',
      },
      { ctx: makeCtx() },
    );

    const r = await writeInternal(
      {
        description: 'append',
        fileUri: 'local://log.txt',
        content: 'line2',
        mode: 'append',
        addNewlineBefore: true,
        addNewlineAfter: false,
      },
      { ctx: makeCtx() },
    );
    expect(r.success).toBe(true);
    expect(r.chunkNumber).toBe(1);

    const onDisk = await readFromSandbox('log.txt');
    expect(onDisk).toBe('line1\nline2');
  });

  it('prepend 模式:在已有内容前插入', async () => {
    await writeInternal(
      {
        description: 'init',
        fileUri: 'local://doc.md',
        content: 'body',
      },
      { ctx: makeCtx() },
    );

    const r = await writeInternal(
      {
        description: 'prepend header',
        fileUri: 'local://doc.md',
        content: 'HEADER\n',
        mode: 'prepend',
      },
      { ctx: makeCtx() },
    );
    expect(r.success).toBe(true);

    const onDisk = await readFromSandbox('doc.md');
    expect(onDisk).toBe('HEADER\nbody');
  });

  it('insert by line:在第 N 行前插入', async () => {
    await writeInternal(
      {
        description: 'init',
        fileUri: 'local://list.txt',
        content: 'one\ntwo\nthree',
      },
      { ctx: makeCtx() },
    );

    const r = await writeInternal(
      {
        description: 'insert',
        fileUri: 'local://list.txt',
        content: 'inserted',
        mode: 'insert',
        insertLine: 2,
      },
      { ctx: makeCtx() },
    );
    expect(r.success).toBe(true);

    const onDisk = await readFromSandbox('list.txt');
    expect(onDisk).toBe('one\ninserted\ntwo\nthree');
  });

  it('append 新文件:原 router.resolve ENOENT → 等价当 originalContent=""', async () => {
    const r = await writeInternal(
      {
        description: 'append to new',
        fileUri: 'local://newlog.txt',
        content: 'hello',
        mode: 'append',
        addNewlineAfter: false,
      },
      { ctx: makeCtx() },
    );
    expect(r.success).toBe(true);
    expect(r.chunkNumber).toBe(1);

    const onDisk = await readFromSandbox('newlog.txt');
    expect(onDisk).toBe('hello');
  });

  it('subdirectory 路径:自动创建中间目录(handler 全权处理)', async () => {
    const r = await writeInternal(
      {
        description: 'nested',
        fileUri: 'local://uploads/2026/06/file.txt',
        content: 'nested ok',
      },
      { ctx: makeCtx() },
    );
    expect(r.success).toBe(true);

    const onDisk = await readFromSandbox('uploads/2026/06/file.txt');
    expect(onDisk).toBe('nested ok');
  });

  it('沙盒越界 → 失败但不抛(返回 success=false + error)', async () => {
    const r = await writeInternal(
      {
        description: 'evil',
        fileUri: 'local://../../etc/passwd',
        content: 'pwn',
      },
      { ctx: makeCtx() },
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/escapes the local:\/\/ sandbox/);
  });

  it('缺 ctx → 失败明确报错(防默默走错支)', async () => {
    const r = await writeInternal({
      description: 'no-ctx',
      fileUri: 'local://x.md',
      content: 'oops',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/requires a tool context/);
  });

  it('skill:// 是 read-only,write 拒绝(透传 router 错误)', async () => {
    // 注入 skill handler 到当前 router 单例(LocalProtocolHandler 已在
    // beforeEach 注册)。
    InternalUrlRouter.get().register(new SkillProtocolHandler());

    const r = await writeInternal(
      {
        description: 'try write skill',
        fileUri: 'skill://my-skill',
        content: 'no',
      },
      { ctx: makeCtx() },
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/read-only/);
  });

  it('validateJson 仍生效(内容层校验,与 I/O 层解耦)', async () => {
    const r = await writeInternal(
      {
        description: 'bad json',
        fileUri: 'local://config.json',
        content: '{ not json',
        validateJson: true,
      },
      { ctx: makeCtx() },
    );
    expect(r.success).toBe(false);
    expect(r.jsonValid).toBe(false);
    expect(r.error).toMatch(/Invalid JSON/);
  });
});

// ---------------------------------------------------------------------------
// helper —— 读 session sandbox 内的物理文件,绕过 router(测试要看真落盘)
// ---------------------------------------------------------------------------
async function readFromSandbox(relPath: string): Promise<string> {
  const profile = await Profile.getOrLoad(profileId);
  const agent = await profile.getAgent(agentId);
  const session = await agent!.getSession(sessionId);
  const abs = path.join(session!.filesDir(), relPath);
  return fs.promises.readFile(abs, 'utf-8');
}
