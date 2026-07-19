/**
 * `read` 工具:图片 URI dispatch 集成测试。
 *
 * 验证大图附件落进 session sandbox 后,模型 `read local://<name>.png` 时:
 *   1. 走 image backend(而非 filesystem 文本通道 / NUL-byte 二进制占位)
 *   2. ToolResult.images 携带 base64 + mimeType —— 即真正把图回灌给模型
 *   3. content JSON 里 fileName/url 是 LLM-visible URI 形态
 *   4. 纯本地 abs path 的图片同样回图
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';

import { dispatchRead } from '../read/dispatch';
import type { ToolContext } from '../types';
import { ProfileStore } from '@main/persist/profileStore'
import { ProfileRegistry } from '@main/profileRegistry'
import { setRootForTesting } from '@main/persist/lib/root';
import { ProfileDb } from '@main/persist/lib/db/db';
import { InternalUrlRouter } from '@main/pi/internal-urls';
import { LocalProtocolHandler } from '@main/pi/internal-urls/handlers/local-protocol';
import { Tracer } from '@shared/log/trace';

let tmpRoot = '';
let profileId = '';
let agentId = '';
let sessionId = '';
let sessionFilesDir = '';

// 一段任意字节当 PNG —— image backend 只读字节 + base64,不解码,内容随意。
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

function makeCtx(): ToolContext {
  return {
    mode: 'agent',
    profile: ProfileRegistry.require(profileId),
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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'read-image-it-'));
  setRootForTesting(tmpRoot);
  ProfileRegistry.resetForTesting();
  ProfileDb.closeAll();
  ProfileDb.resetForTesting();
  InternalUrlRouter.resetForTesting();
  InternalUrlRouter.get().register(new LocalProtocolHandler());

  profileId = `p_TEST_${Math.random().toString(36).slice(2, 8)}`;
  const store = await (await ProfileRegistry.getOrLoad(profileId)).store
  const agent = await store.createAgent({ name: 'ImageUriTest', version: '1.0.0' });
  agentId = agent.id;
  const session = await agent.createSession({ title: 'sandbox' });
  sessionId = session.id;
  sessionFilesDir = session.filesDir();
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
  InternalUrlRouter.resetForTesting();
});

describe('dispatchRead — image URI', () => {
  it('local://shot.png → image backend 回 base64 + mimeType', async () => {
    fs.mkdirSync(sessionFilesDir, { recursive: true });
    fs.writeFileSync(path.join(sessionFilesDir, 'shot.png'), PNG_BYTES);

    const result = await dispatchRead({ path: 'local://shot.png' }, makeCtx());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(1);
    expect(result.images![0].mimeType).toBe('image/png');
    expect(result.images![0].data).toBe(Buffer.from(PNG_BYTES).toString('base64'));

    const payload = JSON.parse(result.content);
    expect(payload.url).toBe('local://shot.png');
    expect(payload.fileName).toBe('shot.png');
    expect(payload.mimeType).toBe('image/png');
  });

  it('本地 abs path 的 .jpg 同样回图', async () => {
    const absDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abs-img-'));
    const abs = path.join(absDir, 'photo.jpg');
    fs.writeFileSync(abs, PNG_BYTES);

    const result = await dispatchRead({ path: abs }, makeCtx());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(1);
    expect(result.images![0].mimeType).toBe('image/jpeg');

    fs.rmSync(absDir, { recursive: true, force: true });
  });

  it('大图 read 时按 OpenAI vision 指南压缩回灌(短边压到 768,PNG→JPEG)', async () => {
    fs.mkdirSync(sessionFilesDir, { recursive: true });
    // 2000×1500 真实 PNG —— 短边 1500 > 768,触发 compressImageFirstPass 的缩放。
    const bigPng = await sharp({
      create: { width: 2000, height: 1500, channels: 3, background: { r: 10, g: 120, b: 200 } },
    }).png().toBuffer();
    fs.writeFileSync(path.join(sessionFilesDir, 'big.png'), bigPng);

    const result = await dispatchRead({ path: 'local://big.png' }, makeCtx());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(1);
    // 非 jpeg 输入缩放后默认转 jpeg(flatten + jpeg),证明确实压缩过。
    expect(result.images![0].mimeType).toBe('image/jpeg');
    const outMeta = await sharp(Buffer.from(result.images![0].data, 'base64')).metadata();
    expect(Math.min(outMeta.width!, outMeta.height!)).toBe(768);
    expect(Math.max(outMeta.width!, outMeta.height!)).toBe(1024);
    // content 元信息仍描述盘上原图(png + 原始字节)。
    const payload = JSON.parse(result.content);
    expect(payload.mimeType).toBe('image/png');
    expect(payload.bytes).toBe(bigPng.length);
  });

  it('小图(两边 ≤768)read 原样回灌,不压缩、不转码', async () => {
    fs.mkdirSync(sessionFilesDir, { recursive: true });
    const smallPng = await sharp({
      create: { width: 200, height: 150, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer();
    fs.writeFileSync(path.join(sessionFilesDir, 'small.png'), smallPng);

    const result = await dispatchRead({ path: 'local://small.png' }, makeCtx());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images![0].mimeType).toBe('image/png');
    expect(result.images![0].data).toBe(smallPng.toString('base64'));
  });
});
