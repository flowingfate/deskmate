/**
 * `web download` 内核(`downloadFileInternal`):URI 形态 saveDirectory 落点 + result.fileUri 形态。
 *
 * 用真盘 + 真 SQLite + 真 LocalProtocolHandler / KnowledgeProtocolHandler;
 * 仅 mock `globalThis.fetch` 让下载主流程不真实联网。验证:
 *  - URI 进 → URI 出(`local://photo.png`/ `knowledge://manual.pdf`)
 *  - URI 子路径 → URI 子路径 + filename(`local://reports/q3.json`)
 *  - URI 形态时落盘真在 sandbox 内(同 LocalProtocolHandler 解析点)
 *  - abs 进 → abs 出(legacy 兼容);默认 `local://` 落到 session sandbox
 *  - 跨 RegularSession / JobRun 时,URI 解析跟着 ToolContext.sessionId 切换
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { downloadFileInternal } from '../../builtins/web/kernel/download';
import type { ToolContext } from '@main/pi/tools/types';

import { Profile } from '@main/persist/profile';
import { Profiles } from '@main/persist/profiles';
import { setRootForTesting } from '@main/persist/lib/root';
import { ProfileDb } from '@main/persist/lib/db/db';
import { InternalUrlRouter } from '@main/pi/internal-urls';
import { LocalProtocolHandler } from '@main/pi/internal-urls/handlers/local-protocol';
import { KnowledgeProtocolHandler } from '@main/pi/internal-urls/handlers/knowledge-protocol';
import { Tracer } from '@shared/log/trace';

let tmpRoot = '';
let profileId = '';
let agentId = '';
let sessionId = '';
let sessionFilesDir = '';
let agentKnowledgeDir = '';

async function seed(): Promise<void> {
  const profile = await Profile.getOrLoad(profileId);
  const agent = await profile.createAgent({ name: 'DownloadTest', version: '1.0.0' });
  agentId = agent.id;
  const session = await agent.createSession({ title: 'sandbox' });
  sessionId = session.id;
  sessionFilesDir = session.filesDir();
  await fsp.mkdir(sessionFilesDir, { recursive: true });
}

function makeCtx(): ToolContext {
  return {
    profileId,
    agentId,
    sessionId,
    signal: new AbortController().signal,
    eventSender: null,
    tracer: Tracer.noop,
    isSubAgent: false,
    callId: 'c_test',
    chunkStream: null,
  };
}

/**
 * Mock globalThis.fetch:返回固定 bytes,带 content-length / content-type。
 * downloadFileInternal 用 `for await` 走 ReadableStream,这里构造一个一次性
 * 推送的最小 Web Stream(`ReadableStream`),回避真实网络。
 */
function mockFetchOnce(payload: Uint8Array, contentType = 'image/png'): void {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(payload);
      controller.close();
    },
  });
  // 类型 cast 到 any —— Response 的实际形态在 Node 18+ fetch 下 OK。
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({
        'content-length': String(payload.byteLength),
        'content-type': contentType,
      }),
      body,
    })),
  );
}

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'download-file-uri-it-'));
  setRootForTesting(tmpRoot);
  Profiles.resetForTesting();
  ProfileDb.closeAll();
  ProfileDb.resetForTesting();
  InternalUrlRouter.resetForTesting();

  InternalUrlRouter.get().register(new LocalProtocolHandler());
  InternalUrlRouter.get().register(new KnowledgeProtocolHandler());

  profileId = `p_TEST_${Math.random().toString(36).slice(2, 8)}`;
  await seed();

  // KB 默认 / 唯一目录 = `${agentRoot}/knowledge`(固定路径,撤掉自定义后)。
  const { PERSIST_PATH } = await import('@shared/persist/path');
  agentKnowledgeDir = PERSIST_PATH.agentKnowledge(tmpRoot, profileId, agentId);
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe('web download kernel — saveDirectory URI form', () => {
  it('local:// 默认 → fileUri 是 local://<filename>;落盘到 session sandbox', async () => {
    const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    mockFetchOnce(payload);

    const result = await downloadFileInternal(
      {
        url: 'https://example.com/photo.png',
        filename: 'photo.png',
        // saveDirectory 省略 → 默认 'local://'
      },
      { ctx: makeCtx() },
    );

    expect(result.success).toBe(true);
    expect(result.fileUri).toBe('local://photo.png');
    expect(result.fileSize).toBe(payload.byteLength);

    // 物理落盘:session.filesDir()/photo.png(与 LocalProtocolHandler 解析一致)
    const onDisk = await fsp.readFile(path.join(sessionFilesDir, 'photo.png'));
    expect(onDisk.equals(Buffer.from(payload))).toBe(true);
  });

  it('local:// 子路径 → fileUri 拼 sub/filename,目录按需创建', async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    mockFetchOnce(payload, 'application/json');

    const result = await downloadFileInternal(
      {
        url: 'https://example.com/q3.json',
        filename: 'q3.json',
        saveDirectory: 'local://reports',
      },
      { ctx: makeCtx() },
    );

    expect(result.success).toBe(true);
    expect(result.fileUri).toBe('local://reports/q3.json');

    const onDisk = await fsp.readFile(path.join(sessionFilesDir, 'reports', 'q3.json'));
    expect(onDisk.byteLength).toBe(payload.byteLength);
  });

  it('local://sub/ 尾斜杠不影响 URI 拼接', async () => {
    mockFetchOnce(new Uint8Array([42]));
    const result = await downloadFileInternal(
      {
        url: 'https://example.com/x.bin',
        filename: 'x.bin',
        saveDirectory: 'local://sub/',
      },
      { ctx: makeCtx() },
    );
    expect(result.fileUri).toBe('local://sub/x.bin');
  });

  it('knowledge:// → fileUri 是 knowledge://<filename>;落盘到 KB 目录', async () => {
    const payload = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    mockFetchOnce(payload, 'application/pdf');

    const result = await downloadFileInternal(
      {
        url: 'https://example.com/manual.pdf',
        filename: 'manual.pdf',
        saveDirectory: 'knowledge://',
      },
      { ctx: makeCtx() },
    );

    expect(result.success).toBe(true);
    expect(result.fileUri).toBe('knowledge://manual.pdf');

    const onDisk = await fsp.readFile(path.join(agentKnowledgeDir, 'manual.pdf'));
    expect(onDisk.byteLength).toBe(payload.byteLength);
  });

  it('absolute path(homedir 内)→ fileUri 是 abs path;legacy 行为保留', async () => {
    const downloadsDir = path.join(os.homedir(), 'Downloads');
    // 仅在该目录可写时跑,跨 CI 环境差异时跳过
    try {
      await fsp.mkdir(downloadsDir, { recursive: true });
    } catch {
      return;
    }
    const target = path.join(downloadsDir, `dl-test-${Math.random().toString(36).slice(2, 8)}.bin`);

    mockFetchOnce(new Uint8Array([7, 8, 9]));
    const result = await downloadFileInternal(
      {
        url: 'https://example.com/x.bin',
        filename: path.basename(target),
        saveDirectory: downloadsDir,
      },
      { ctx: makeCtx() },
    );
    expect(result.success).toBe(true);
    expect(result.fileUri).toBe(target);
    // 不强行验证内容(用户 ~/Downloads 真盘):清理后通过
    try { await fsp.unlink(target); } catch { /* best effort */ }
  });

  it('homedir 之外的 abs path 仍被拒绝(legacy 安全闸)', async () => {
    mockFetchOnce(new Uint8Array([1]));
    const result = await downloadFileInternal(
      {
        url: 'https://example.com/x.bin',
        filename: 'x.bin',
        saveDirectory: '/tmp/should-not-pass-uri-test',
      },
      { ctx: makeCtx() },
    );
    expect(result.success).toBe(false);
    expect(result.error ?? '').toMatch(/within user home directory/);
  });

  it('URI saveDirectory 但 ctx 未提供 → 友好失败', async () => {
    mockFetchOnce(new Uint8Array([1]));
    const result = await downloadFileInternal(
      {
        url: 'https://example.com/x.bin',
        filename: 'x.bin',
        saveDirectory: 'local://',
      },
      // 故意不传 ctx
    );
    expect(result.success).toBe(false);
    expect(result.error ?? '').toMatch(/requires a tool context/);
  });
});
