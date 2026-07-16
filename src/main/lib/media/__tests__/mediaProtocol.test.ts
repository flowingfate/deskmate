/**
 * `media://` protocol handler(`resolveMediaRequest`)端到端测试。
 *
 * 用真盘 + 真 SQLite + 真 InternalUrlRouter(同 local-knowledge-handlers.test.ts
 * 模式)创建 Profile / Agent / Session fixture,验证:
 *   - local 图片字节直供:request → 200 + 正确 Content-Type + 字节逐一致
 *   - percent-encoded 文件名(空格)逐段解码命中
 *   - knowledge authority 走 agent KB sandbox
 *   - 错误矩阵:未知 authority(404)/ 缺 mime(400)/ local 缺 session(400)/
 *     沙盒 `..` 越界(404)/ 文件不存在(404)
 *
 * handler 从 `Profiles.get().active()` 取 profileId(不从 query,防跨 profile),
 * 故 fixture 需把 `activeProfileId` 指到 seed 出来的 profile。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveMediaRequest } from '../mediaProtocol';
import { InternalUrlRouter, KnowledgeProtocolHandler, LocalProtocolHandler } from '@main/pi';

import { Profile } from '@main/persist/profile';
import { Profiles } from '@main/persist/profiles';
import { setRootForTesting } from '@main/persist/lib/root';
import { ProfileDb } from '@main/persist/lib/db/db';

let tmpRoot = '';
let profileId = '';
let agentId = '';
let sessionId = '';
let sessionFilesDir = '';

async function seedProfileAgentSession(): Promise<void> {
  const profile = await Profile.getOrLoad(profileId);
  const agent = await profile.createAgent({ name: 'TestAgent', version: '1.0.0' });
  agentId = agent.id;
  const session = await agent.createSession({ title: 'sandbox' });
  sessionId = session.id;
  sessionFilesDir = session.filesDir();
  await fsp.mkdir(sessionFilesDir, { recursive: true });
  // handler 走 Profiles.active() 取 profileId —— 把 active 指到本 profile。
  Profiles.get().activeProfileId = profileId;
}

function mediaUrl(
  authority: string,
  innerPath: string,
  query: Record<string, string>,
): string {
  const params = new URLSearchParams(query);
  return `media://${authority}/${innerPath}?${params.toString()}`;
}

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-protocol-it-'));
  setRootForTesting(tmpRoot);
  Profiles.resetForTesting();
  ProfileDb.closeAll();
  ProfileDb.resetForTesting();
  InternalUrlRouter.resetForTesting();
  InternalUrlRouter.get().register(new LocalProtocolHandler());
  InternalUrlRouter.get().register(new KnowledgeProtocolHandler());

  profileId = `p_TEST_${Math.random().toString(36).slice(2, 8)}`;
  await seedProfileAgentSession();
});

afterEach(() => {
  Profile.evict(profileId);
  Profiles.resetForTesting();
  ProfileDb.closeAll();
  ProfileDb.resetForTesting();
  setRootForTesting(null);
  InternalUrlRouter.resetForTesting();
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

async function bodyBytes(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

describe('resolveMediaRequest — local', () => {
  it('图片字节直供:200 + Content-Type + 字节一致', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const dir = path.join(sessionFilesDir, 'uploads');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'shot.png'), bytes);

    const res = await resolveMediaRequest(
      mediaUrl('local', 'uploads/shot.png', {
        agent: agentId,
        session: sessionId,
        mime: 'image/png',
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Content-Length')).toBe(String(bytes.length));
    expect((await bodyBytes(res)).equals(bytes)).toBe(true);
  });

  it('percent-encoded 文件名(空格)逐段解码命中', async () => {
    const bytes = Buffer.from([10, 20, 30]);
    const dir = path.join(sessionFilesDir, 'uploads');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'my shot.png'), bytes);

    const res = await resolveMediaRequest(
      mediaUrl('local', `uploads/${encodeURIComponent('my shot.png')}`, {
        agent: agentId,
        session: sessionId,
        mime: 'image/png',
      }),
    );

    expect(res.status).toBe(200);
    expect((await bodyBytes(res)).equals(bytes)).toBe(true);
  });

  it('缺 mime → 400', async () => {
    const res = await resolveMediaRequest(
      mediaUrl('local', 'uploads/shot.png', { agent: agentId, session: sessionId }),
    );
    expect(res.status).toBe(400);
  });

  it('缺 session → 400', async () => {
    const res = await resolveMediaRequest(
      mediaUrl('local', 'uploads/shot.png', { agent: agentId, mime: 'image/png' }),
    );
    expect(res.status).toBe(400);
  });

  it('沙盒 `..` 越界 → 404', async () => {
    const res = await resolveMediaRequest(
      mediaUrl('local', '../../etc/passwd', {
        agent: agentId,
        session: sessionId,
        mime: 'text/plain',
      }),
    );
    expect(res.status).toBe(404);
  });

  it('文件不存在 → 404', async () => {
    const res = await resolveMediaRequest(
      mediaUrl('local', 'uploads/nope.png', {
        agent: agentId,
        session: sessionId,
        mime: 'image/png',
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe('resolveMediaRequest — knowledge', () => {
  it('走 agent KB sandbox,字节直供', async () => {
    const bytes = Buffer.from([42, 43, 44, 45]);
    const absPath = await InternalUrlRouter.get().resolveToPath('knowledge://diagram.png', {
      mode: 'agent',
      profileId,
      agentId,
      sessionId: '',
    });
    await fsp.mkdir(path.dirname(absPath), { recursive: true });
    await fsp.writeFile(absPath, bytes);

    const res = await resolveMediaRequest(
      mediaUrl('knowledge', 'diagram.png', { agent: agentId, mime: 'image/png' }),
    );

    expect(res.status).toBe(200);
    expect((await bodyBytes(res)).equals(bytes)).toBe(true);
  });
});

describe('resolveMediaRequest — authority guard', () => {
  it('未知 authority → 404', async () => {
    const res = await resolveMediaRequest(
      mediaUrl('skill', 'foo.png', { agent: agentId, mime: 'image/png' }),
    );
    expect(res.status).toBe(404);
  });

  it('malformed URL → 400', async () => {
    const res = await resolveMediaRequest('not-a-url');
    expect(res.status).toBe(400);
  });
});
