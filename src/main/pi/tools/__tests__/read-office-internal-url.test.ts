/**
 * `read` 工具:office URI dispatch 集成测试。
 *
 * 验证 `dispatchRead` 在 `local://*.pdf` / `knowledge://*.docx` 等 office URI
 * 上的分流逻辑:
 *
 *  1. URI 不走 `router.resolve`(它假设文本内容,PDF 会被 NUL byte 拦截或乱码)
 *  2. URI → `router.resolveToPath` → abs path → office backend
 *  3. office backend impl 收到的是 abs path(`filePath: <abs>`)
 *  4. LLM 看到的 result 里 `fileName` / `url` 仍是原 URI 形态(displayUrl 注入)
 *
 * 抹掉 `ReadOfficeFileTool.execute` 的真实实现 —— 我们只测分流 + 字段重写,
 * 不测 mammoth/pdfreader 解析逻辑(impl 自己有单测覆盖)。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { dispatchRead } from '../read/dispatch';
import type { ToolContext } from '../types';
import { Profile } from '@main/persist/profile';
import { Profiles } from '@main/persist/profiles';
import { setRootForTesting, getAppRoot } from '@main/persist/lib/root';
import { ProfileDb } from '@main/persist/lib/db/db';
import { InternalUrlRouter } from '@main/pi/internal-urls';
import { LocalProtocolHandler } from '@main/pi/internal-urls/handlers/local-protocol';
import { KnowledgeProtocolHandler } from '@main/pi/internal-urls/handlers/knowledge-protocol';
import { PERSIST_PATH } from '@shared/persist/path';
import { Tracer } from '@shared/log/trace';

// 抹掉 office impl —— dispatch 测试不依赖 mammoth/pdfreader 实际工作。
// 必须用模块路径与 office backend 内 `await import('../impl/readOfficeFile')`
// 解析后的 absolute id 一致 —— vi.mock 按 absolute path 匹配。
const executeMock = vi.fn();
vi.mock('@main/pi/tools/read/impl/readOfficeFile', () => ({
  ReadOfficeFileTool: {
    execute: (...args: unknown[]) => executeMock(...args),
  },
}));

let tmpRoot = '';
let profileId = '';
let agentId = '';
let sessionId = '';
let sessionFilesDir = '';
let agentKnowledgeDir = '';
async function seed(): Promise<void> {
  const profile = await Profile.getOrLoad(profileId);
  const agent = await profile.createAgent({ name: 'OfficeUriTest', version: '1.0.0' });
  agentId = agent.id;
  const session = await agent.createSession({ title: 'sandbox' });
  sessionId = session.id;
  sessionFilesDir = session.filesDir();
  agentKnowledgeDir = PERSIST_PATH.agentKnowledge(getAppRoot(), profileId, agentId);
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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'read-office-uri-it-'));
  setRootForTesting(tmpRoot);
  Profiles.resetForTesting();
  ProfileDb.closeAll();
  ProfileDb.resetForTesting();
  InternalUrlRouter.resetForTesting();
  executeMock.mockReset();

  // 注册两个 handler —— 测试覆盖 local:// + knowledge:// 两侧。
  InternalUrlRouter.get().register(new LocalProtocolHandler());
  InternalUrlRouter.get().register(new KnowledgeProtocolHandler());

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
});

describe('dispatchRead — office URI 分流', () => {
  it('local://report.pdf:p3-7 → office backend 收到 abs path 与 page selector', async () => {
    // 物化一个 fake pdf(impl 已被 mock,内容随意)。
    fs.mkdirSync(sessionFilesDir, { recursive: true });
    const absPath = path.join(sessionFilesDir, 'report.pdf');
    fs.writeFileSync(absPath, '%PDF-1.4 stub');

    executeMock.mockResolvedValue({
      content: 'page 3-7 text',
      fileName: 'report.pdf',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
      size: 13,
      truncated: false,
      startPage: 3,
      endPage: 7,
      totalPages: 10,
    });

    const result = await dispatchRead({ path: 'local://report.pdf:p3-7' }, makeCtx());

    // 1. impl 收到的是 abs path,不是 URI
    expect(executeMock).toHaveBeenCalledTimes(1);
    const [implArgs] = executeMock.mock.calls[0] as [
      { filePath: string; startPage?: number; endPage?: number },
    ];
    expect(implArgs.filePath).toBe(absPath);
    expect(implArgs.startPage).toBe(3);
    expect(implArgs.endPage).toBe(7);

    // 2. result 里 LLM 可见字段被 displayUrl 重写为 URI 形态
    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.content);
    expect(payload.url).toBe('local://report.pdf');
    expect(payload.fileName).toBe('report.pdf');
    expect(payload.startPage).toBe(3);
    expect(payload.endPage).toBe(7);
  });

  it('local://nested/dir/sheet.xlsx → 嵌套路径 URI 同样分流', async () => {
    const nested = path.join(sessionFilesDir, 'nested', 'dir');
    fs.mkdirSync(nested, { recursive: true });
    const absPath = path.join(nested, 'sheet.xlsx');
    fs.writeFileSync(absPath, 'PK\x03\x04 fake xlsx');

    executeMock.mockResolvedValue({
      content: 'sheet data',
      fileName: 'sheet.xlsx',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
      size: 10,
      truncated: false,
      startPage: 1,
      endPage: 1,
      totalPages: 1,
    });

    const result = await dispatchRead(
      { path: 'local://nested/dir/sheet.xlsx' },
      makeCtx(),
    );

    const [implArgs] = executeMock.mock.calls[0] as [{ filePath: string }];
    expect(implArgs.filePath).toBe(absPath);

    const payload = JSON.parse(result.content);
    expect(payload.url).toBe('local://nested/dir/sheet.xlsx');
    expect(payload.fileName).toBe('sheet.xlsx');
  });

  it('knowledge://manual.docx → office backend 收到 KB 内 abs path', async () => {
    fs.mkdirSync(agentKnowledgeDir, { recursive: true });
    const absPath = path.join(agentKnowledgeDir, 'manual.docx');
    fs.writeFileSync(absPath, 'PK\x03\x04 fake docx');

    executeMock.mockResolvedValue({
      content: 'manual text',
      fileName: 'manual.docx',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
      size: 11,
      truncated: false,
      startPage: 1,
      endPage: 1,
      totalPages: 1,
    });

    const result = await dispatchRead({ path: 'knowledge://manual.docx' }, makeCtx());

    const [implArgs] = executeMock.mock.calls[0] as [{ filePath: string }];
    expect(implArgs.filePath).toBe(absPath);

    const payload = JSON.parse(result.content);
    expect(payload.url).toBe('knowledge://manual.docx');
    expect(payload.fileName).toBe('manual.docx');
  });

  it('local://notes.md(非 office)→ 走 filesystem backend(URI 文本流式读)', async () => {
    fs.mkdirSync(sessionFilesDir, { recursive: true });
    fs.writeFileSync(path.join(sessionFilesDir, 'notes.md'), '# title\n\nbody text');

    const result = await dispatchRead({ path: 'local://notes.md' }, makeCtx());

    expect(executeMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.content);
    // dispatch 走 router.canResolveToPath → filesystem backend,fileName / url 由
    // dispatch 注入 LLM-visible URI 形态(参 dispatch.ts deriveDisplayName)。
    expect(payload.url).toBe('local://notes.md');
    expect(payload.fileName).toBe('notes.md');
    expect(payload.content).toContain('body text');
  });

  it('local://big.txt > 1MB → 流式 backend 返回(不再受 in-memory 上限抛错)', async () => {
    fs.mkdirSync(sessionFilesDir, { recursive: true });
    // 物化 ~1.5MB 文本(150k 行 × ~10 字节);走老 in-memory router.resolve 会
    // 直接抛 "exceeds 1048576 byte limit"。新 dispatch 走 filesystem backend
    // 流式分页,正常返回内容(可能被 line/byte cap 截断,但不抛)。
    const lines = Array.from({ length: 150_000 }, (_, i) => `line-${i}`);
    fs.writeFileSync(path.join(sessionFilesDir, 'big.txt'), lines.join('\n'));

    const result = await dispatchRead({ path: 'local://big.txt' }, makeCtx());

    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.content);
    expect(payload.url).toBe('local://big.txt');
    expect(payload.fileName).toBe('big.txt');
    // filesystem backend 自有 line/byte 上限,truncated 应为 true
    expect(payload.truncated).toBe(true);
    // 至少头几行能读到
    expect(payload.content).toContain('line-0');
  });

  it('local://*.bin(NUL byte)→ filesystem backend 返回 binary hint,不抛错', async () => {
    fs.mkdirSync(sessionFilesDir, { recursive: true });
    // NUL byte 探针段;老 handler.resolve 路径会直接 "appears to be binary" 抛错。
    // 新 dispatch 走 filesystem backend → fileTypeHint='binary' + 截断预览。
    const buf = Buffer.alloc(64);
    buf.write('header\n');
    buf[10] = 0x00;
    buf[20] = 0x01;
    fs.writeFileSync(path.join(sessionFilesDir, 'image.bin'), buf);

    const result = await dispatchRead({ path: 'local://image.bin' }, makeCtx());

    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.content);
    expect(payload.url).toBe('local://image.bin');
    expect(payload.fileName).toBe('image.bin');
    expect(payload.fileTypeHint).toBe('binary');
  });

  it('local://notes.md:2-3 line selector 走 filesystem backend 流式切片', async () => {
    fs.mkdirSync(sessionFilesDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionFilesDir, 'notes.md'),
      'line-1\nline-2\nline-3\nline-4\nline-5',
    );

    const result = await dispatchRead({ path: 'local://notes.md:2-3' }, makeCtx());

    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.content);
    expect(payload.startLine).toBe(2);
    expect(payload.endLine).toBe(3);
    expect(payload.content).toContain('line-2');
    expect(payload.content).toContain('line-3');
    expect(payload.content).not.toContain('line-1');
    expect(payload.content).not.toContain('line-4');
    expect(payload.url).toBe('local://notes.md');
  });
});
