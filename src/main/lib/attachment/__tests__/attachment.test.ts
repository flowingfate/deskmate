/**
 * `src/main/lib/attachment/` 单元测试。
 *
 * 真盘 + 真 SQLite(同 internal-urls 测试模式),通过实际 Profile / Agent /
 * RegularSession API 创建 fixture —— 不 mock fs,因为我们要验证拷贝物理落到
 * `session.filesDir()/uploads/` 的真实联动。
 *
 * 测点矩阵:
 * - attachFromPath: roundtrip / 内容字节级一致 / 不存在源抛错
 * - attachFromBytes: roundtrip / 字节级一致
 * - 唯一名: 第一次原名,第二次 `_1`,第三次 `_2`(不论 fromPath 还是 fromBytes)
 * - sandbox 边界: `local://uploads/<name>` URI 落到 session.filesDir/uploads/<name>
 * - 错误传出: agent 找不到 / session 找不到 → 抛 throw with name
 * - 跨 session 隔离: 两个 session 各自的 uploads/ 互不影响
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { attachFromPath, attachFromBytes } from '../index';
import type { Profile } from '@main/profile';
import { ProfileRegistry } from '@main/profileRegistry'
import { setRootForTesting } from '@main/persist/lib/root';
import { ProfileDb } from '@main/persist/lib/db/db';

let tmpRoot = '';
let profileId = '';
let profile: Profile;
let agentId = '';
let sessionId = '';
let sessionFilesDir = '';

async function seedProfileAgentSession(): Promise<void> {
  profile = await ProfileRegistry.getOrLoad(profileId);
  const agent = await profile.store.createAgent({ name: 'AttachTestAgent', version: '1.0.0' });
  agentId = agent.id;
  const session = await agent.createSession({ title: 'sandbox' });
  sessionId = session.id;
  sessionFilesDir = session.filesDir();
  await fsp.mkdir(sessionFilesDir, { recursive: true });
}

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attachment-it-'));
  setRootForTesting(tmpRoot);
  ProfileRegistry.resetForTesting();
  ProfileDb.closeAll();
  ProfileDb.resetForTesting();
  profileId = `p_TEST_${Math.random().toString(36).slice(2, 8)}`;
  await seedProfileAgentSession();
});

afterEach(() => {
  ProfileRegistry.resetForTesting();
  ProfileRegistry.resetForTesting();
  ProfileDb.closeAll();
  ProfileDb.resetForTesting();
  setRootForTesting(null);
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('attachFromPath', () => {
  it('拷贝到 sandbox/uploads/<name>,返回 local:// URI + 字节一致', async () => {
    const src = path.join(tmpRoot, 'src-notes.md');
    const body = '# notes\n\nhello world\n';
    await fsp.writeFile(src, body, 'utf-8');

    const outcome = await attachFromPath(src, 'notes.md', { agentId, sessionId }, profile);

    expect(outcome.uri).toBe('local://uploads/notes.md');
    expect(outcome.fileName).toBe('notes.md');
    expect(outcome.size).toBe(Buffer.byteLength(body, 'utf-8'));
    expect(outcome.destPath).toBe(path.join(sessionFilesDir, 'uploads', 'notes.md'));

    const written = await fsp.readFile(outcome.destPath, 'utf-8');
    expect(written).toBe(body);
  });

  it('未传 originalName 时取 srcPath basename', async () => {
    const src = path.join(tmpRoot, 'readme.txt');
    await fsp.writeFile(src, 'r');
    const outcome = await attachFromPath(src, undefined, { agentId, sessionId }, profile);
    expect(outcome.fileName).toBe('readme.txt');
    expect(outcome.uri).toBe('local://uploads/readme.txt');
  });

  it('重名 → 第二次 `_1`,第三次 `_2`', async () => {
    const src = path.join(tmpRoot, 'dup.md');
    await fsp.writeFile(src, 'a');

    const a = await attachFromPath(src, 'dup.md', { agentId, sessionId }, profile);
    const b = await attachFromPath(src, 'dup.md', { agentId, sessionId }, profile);
    const c = await attachFromPath(src, 'dup.md', { agentId, sessionId }, profile);

    expect(a.fileName).toBe('dup.md');
    expect(b.fileName).toBe('dup_1.md');
    expect(c.fileName).toBe('dup_2.md');
    expect(a.uri).toBe('local://uploads/dup.md');
    expect(c.uri).toBe('local://uploads/dup_2.md');
  });

  it('源文件不存在 → 抛错', async () => {
    await expect(
      attachFromPath(path.join(tmpRoot, 'no-such-file'), 'x.md', { agentId, sessionId }, profile),
    ).rejects.toThrow();
  });

  it('agent 不存在 → 抛带 agent id 的错', async () => {
    const src = path.join(tmpRoot, 's.md');
    await fsp.writeFile(src, 'x');
    await expect(
      attachFromPath(src, 's.md', { agentId: 'a_NOSUCH', sessionId }, profile),
    ).rejects.toThrow(/Agent not found.*a_NOSUCH/);
  });

  it('session 不存在 → 抛带 session id 的错', async () => {
    const src = path.join(tmpRoot, 's.md');
    await fsp.writeFile(src, 'x');
    await expect(
      attachFromPath(src, 's.md', { agentId, sessionId: 's_NOSUCH' }, profile),
    ).rejects.toThrow(/Session not found.*s_NOSUCH/);
  });

  it('跨 session 隔离: session A 的 uploads/ 不影响 session B', async () => {
    const agent = await profile.store.getAgent(agentId);
    if (!agent) throw new Error('agent missing');
    const sessionB = await agent.createSession({ title: 'second' });
    await fsp.mkdir(sessionB.filesDir(), { recursive: true });

    const src = path.join(tmpRoot, 'same.md');
    await fsp.writeFile(src, 'x');
    const a = await attachFromPath(src, 'same.md', { agentId, sessionId }, profile);
    const b = await attachFromPath(src, 'same.md', { agentId, sessionId: sessionB.id }, profile);

    // 两个 session 各自从 same.md 起名;互不知情。
    expect(a.fileName).toBe('same.md');
    expect(b.fileName).toBe('same.md');
    expect(a.destPath).not.toBe(b.destPath);
  });
});

describe('attachFromBytes', () => {
  it('字节落到 sandbox/uploads/<name>,内容一致', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG signature
    const outcome = await attachFromBytes(bytes, 'clip.png', { agentId, sessionId }, profile);

    expect(outcome.uri).toBe('local://uploads/clip.png');
    expect(outcome.size).toBe(bytes.length);
    const written = await fsp.readFile(outcome.destPath);
    expect(written.equals(bytes)).toBe(true);
  });

  it('重名同样走 `_N` 后缀', async () => {
    const bytes = Buffer.from([1, 2, 3]);
    const a = await attachFromBytes(bytes, 'c.bin', { agentId, sessionId }, profile);
    const b = await attachFromBytes(bytes, 'c.bin', { agentId, sessionId }, profile);
    expect(a.fileName).toBe('c.bin');
    expect(b.fileName).toBe('c_1.bin');
  });

  it('fromPath 和 fromBytes 共用唯一名空间', async () => {
    const src = path.join(tmpRoot, 'mixed.png');
    await fsp.writeFile(src, 'first');
    const a = await attachFromPath(src, 'mixed.png', { agentId, sessionId }, profile);
    const b = await attachFromBytes(Buffer.from('second'), 'mixed.png', { agentId, sessionId }, profile);
    expect(a.fileName).toBe('mixed.png');
    expect(b.fileName).toBe('mixed_1.png');
  });

  it('无扩展名文件 → suffix 直接跟在文件名后', async () => {
    const bytes = Buffer.from('a');
    const a = await attachFromBytes(bytes, 'NOTES', { agentId, sessionId }, profile);
    const b = await attachFromBytes(bytes, 'NOTES', { agentId, sessionId }, profile);
    expect(a.fileName).toBe('NOTES');
    expect(b.fileName).toBe('NOTES_1');
  });
});

describe('attachment 名字 sanitize —— path traversal 防御', () => {
  it('originalName 含 `../` → 收敛为 basename,落在 sandbox 内,不逃逸', async () => {
    const src = path.join(tmpRoot, 'src.md');
    await fsp.writeFile(src, 'x');
    const outcome = await attachFromPath(src, '../escape.txt', { agentId, sessionId }, profile);

    // sanitize 把 `../escape.txt` 拆成 `['..', 'escape.txt']` 取最后一段 → `escape.txt`,
    // 落进 uploads/ 内。物理上**没有**文件被写到 uploadsDir 之外 —— 这才是
    // 安全契约的关键(攻击者预期写到 sandbox 外被实现层无声拒绝)。
    expect(outcome.fileName).toBe('escape.txt');
    expect(outcome.uri).toBe('local://uploads/escape.txt');
    expect(outcome.destPath).toBe(path.join(sessionFilesDir, 'uploads', 'escape.txt'));

    // 断言"sandbox 外的目标位置"没有副作用文件。
    const escapedAbs = path.join(sessionFilesDir, '..', 'escape.txt');
    expect(fs.existsSync(escapedAbs)).toBe(false);
  });

  it('originalName 含绝对路径 `/etc/passwd` → 收敛为 `passwd`,不逃逸', async () => {
    const src = path.join(tmpRoot, 'src.md');
    await fsp.writeFile(src, 'x');
    const outcome = await attachFromPath(src, '/etc/passwd', { agentId, sessionId }, profile);
    expect(outcome.fileName).toBe('passwd');
    expect(outcome.uri).toBe('local://uploads/passwd');
    expect(outcome.destPath).toBe(path.join(sessionFilesDir, 'uploads', 'passwd'));
    // 没写到 /etc 下。destPath 走 path.join(原生分隔符);sessionFilesDir 是 PERSIST_PATH
    // 正斜杠拼接,Windows 上分隔符不同,故比较前统一 resolve。
    expect(path.resolve(outcome.destPath).startsWith(path.resolve(sessionFilesDir))).toBe(true);
  });

  it('originalName 是 windows 风格 `..\\\\escape.txt` → 收敛为 `escape.txt`', async () => {
    const src = path.join(tmpRoot, 'src.md');
    await fsp.writeFile(src, 'x');
    // 双平台分隔符,即使在 macOS/Linux 跑也按 `\\` 拆,避免 win32 风格的字符串
    // 在 posix `path.basename` 下被原样保留(`path.basename('..\\foo') === '..\\foo'`)。
    const outcome = await attachFromPath(src, '..\\escape.txt', { agentId, sessionId }, profile);
    expect(outcome.fileName).toBe('escape.txt');
    expect(outcome.destPath).toBe(path.join(sessionFilesDir, 'uploads', 'escape.txt'));
  });

  it('originalName 是单纯 `..` / `.` / 空串 → 抛错', async () => {
    const src = path.join(tmpRoot, 'src.md');
    await fsp.writeFile(src, 'x');
    await expect(
      attachFromPath(src, '..', { agentId, sessionId }, profile),
    ).rejects.toThrow(/Invalid attachment name/);
    await expect(
      attachFromPath(src, '.', { agentId, sessionId }, profile),
    ).rejects.toThrow(/Invalid attachment name/);
    await expect(
      attachFromPath(src, '', { agentId, sessionId }, profile),
    ).rejects.toThrow(/Invalid attachment name/);
  });

  it('originalName 含 NUL byte → 抛错', async () => {
    const src = path.join(tmpRoot, 'src.md');
    await fsp.writeFile(src, 'x');
    await expect(
      attachFromPath(src, 'foo\0bar.txt', { agentId, sessionId }, profile),
    ).rejects.toThrow(/NUL byte/);
  });

  it('attachFromBytes 同样收敛 `../../escape.png` → `escape.png`', async () => {
    const outcome = await attachFromBytes(Buffer.from('x'), '../../escape.png', { agentId, sessionId }, profile);
    expect(outcome.fileName).toBe('escape.png');
    expect(outcome.destPath).toBe(path.join(sessionFilesDir, 'uploads', 'escape.png'));
  });

  it('合法的 `subdir/foo.png` 形态被收敛为 `foo.png`(子目录不暴露给 attachment 入口)', async () => {
    // attachment 入口本身不支持 nested 子目录(`uploads/<name>` 是固定一层结构),
    // 即便 originalName 包含 `/` 也只取最后一段。这与 LLM 通过 `write
    // local://uploads/sub/foo.md` 显式建子目录的语义不同(那是 write 工具的事)。
    const src = path.join(tmpRoot, 'src.md');
    await fsp.writeFile(src, 'x');
    const outcome = await attachFromPath(src, 'subdir/foo.png', { agentId, sessionId }, profile);
    expect(outcome.fileName).toBe('foo.png');
    expect(outcome.destPath).toBe(path.join(sessionFilesDir, 'uploads', 'foo.png'));
  });
});
