/**
 * 回归:带附件发送到「尚未落盘的新会话」。
 *
 * 新会话走 lazy-create —— renderer 在 "New Chat" 时只本地生成 sessionId 并 navigate,
 * 直到首条消息才落盘。带附件发送时,附件物化先于 `streamMessage`,此刻 session 的
 * `data.json` 尚不存在,`local://` handler 的 `resolveBaseDir` 会抛 "Session not found"。
 * 修复:attachment IPC handler 在物化前用同一 sessionId 补建 regular session
 * (`ensureSandboxSession`)。本测试锁定该机制:补建后 session 可见、附件能真正落盘。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ensureSandboxSession } from '../attachment';
import { attachFromBytes } from '@main/lib/attachment';
import { Profile } from '@main/persist/profile';
import { Profiles } from '@main/persist/profiles';
import { setRootForTesting } from '@main/persist/lib/root';
import { ProfileDb } from '@main/persist/lib/db/db';
import { InternalUrlRouter, LocalProtocolHandler } from '@main/pi';

let tmpRoot = '';
let profileId = '';
let agentId = '';
let profile: Profile;

// renderer 端 "New Chat" 用 newEntityId('s') 生成的占位 id —— 这里固定一个,模拟
// 一个从未走过 createSession 的会话。
const LAZY_SESSION_ID = 's_TESTLAZYCREATE0000000000';

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-ensure-'));
  setRootForTesting(tmpRoot);
  Profiles.resetForTesting();
  ProfileDb.closeAll();
  ProfileDb.resetForTesting();
  InternalUrlRouter.resetForTesting();
  InternalUrlRouter.get().register(new LocalProtocolHandler());

  profileId = `p_TEST_${Math.random().toString(36).slice(2, 8)}`;
  profile = await Profile.getOrLoad(profileId);
  const agent = await profile.createAgent({ name: 'EnsureSessionTest', version: '1.0.0' });
  agentId = agent.id;
});

afterEach(() => {
  ProfileDb.closeAll();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ensureSandboxSession', () => {
  it('未落盘的 sessionId → 补建 regular session,之后附件能物化进其 sandbox', async () => {
    const agent = await profile.getAgent(agentId);
    expect(agent).toBeDefined();
    // 前置:该 session 既不在 regular 索引也不在 jobRun 索引。
    expect(await agent!.findSessionAcrossKinds(LAZY_SESSION_ID)).toBeUndefined();

    await ensureSandboxSession(profile, agentId, LAZY_SESSION_ID);

    const created = await agent!.findSessionAcrossKinds(LAZY_SESSION_ID);
    expect(created).toBeDefined();
    expect(created!.id).toBe(LAZY_SESSION_ID);

    // 物化真的能写进 session sandbox(修复前这里会因 "Session not found" 抛错)。
    const outcome = await attachFromBytes(
      Buffer.from('hello world'),
      'note.txt',
      { agentId, sessionId: LAZY_SESSION_ID },
      profileId,
    );
    expect(outcome.uri).toBe('local://uploads/note.txt');
    expect(fs.existsSync(path.join(created!.filesDir(), 'uploads', 'note.txt'))).toBe(true);
  });

  it('幂等:已存在的 session 不重复创建(createdAt 不变)', async () => {
    const agent = await profile.getAgent(agentId);
    const first = await agent!.createSession({ id: LAZY_SESSION_ID });
    const createdAt = first.config.createdAt;

    await ensureSandboxSession(profile, agentId, LAZY_SESSION_ID);

    const after = await agent!.findSessionAcrossKinds(LAZY_SESSION_ID);
    expect(after!.id).toBe(LAZY_SESSION_ID);
    expect((after as typeof first).config.createdAt).toBe(createdAt);
  });
});
