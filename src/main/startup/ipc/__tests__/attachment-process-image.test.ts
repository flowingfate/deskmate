/**
 * 回归:图片附件「内联 vs 落 sandbox」判别 + 物化(从 renderer 搬到 main)。
 *
 * 判别基准是【解码后像素大小】(width×height×4),不看编码字节。
 * - 真实大图(2000×1500 → 解码 12MB ≥ 256KB)→ `sandbox`,原图落 session sandbox,
 *   未落盘的会话被 `ensureSandboxSession` 补建。
 * - 真实小图(200×150 → 解码 120KB < 256KB)→ `inline`,base64 == 原始字节 base64,不压缩。
 * - 损坏字节(sharp 解析失败)→ 回落用编码字节判别,不抛。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';

import { processImageAttachment } from '../attachment';
import { Profile } from '@main/persist/profile';
import { Profiles } from '@main/persist/profiles';
import { setRootForTesting } from '@main/persist/lib/root';
import { ProfileDb } from '@main/persist/lib/db/db';
import { InternalUrlRouter } from '@main/pi/internal-urls';
import { LocalProtocolHandler } from '@main/pi/internal-urls/handlers/local-protocol';

let tmpRoot = '';
let profileId = '';
let agentId = '';
let profile: Profile;

const LAZY_SESSION_ID = 's_TESTPROCESSIMG0000000000';

async function pngBytes(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-procimg-'));
  setRootForTesting(tmpRoot);
  Profiles.resetForTesting();
  ProfileDb.closeAll();
  ProfileDb.resetForTesting();
  InternalUrlRouter.resetForTesting();
  InternalUrlRouter.get().register(new LocalProtocolHandler());

  profileId = `p_TEST_${Math.random().toString(36).slice(2, 8)}`;
  profile = await Profile.getOrLoad(profileId);
  const agent = await profile.createAgent({ name: 'ProcessImageTest', version: '1.0.0' });
  agentId = agent.id;
});

afterEach(() => {
  ProfileDb.closeAll();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('processImageAttachment', () => {
  it('大图(解码 ≥ 256KB)→ sandbox,原图落盘,未落盘会话被补建', async () => {
    const agent = await profile.getAgent(agentId);
    // 前置:该 session 尚未落盘。
    expect(await agent!.findSessionAcrossKinds(LAZY_SESSION_ID)).toBeUndefined();

    const bytes = await pngBytes(2000, 1500); // 解码 = 2000*1500*4 = 12MB ≥ 256KB
    const outcome = await processImageAttachment(
      profile,
      agentId,
      LAZY_SESSION_ID,
      bytes,
      'shot.png',
    );

    expect(outcome.kind).toBe('sandbox');
    if (outcome.kind !== 'sandbox') throw new Error('unreachable');
    expect(outcome.uri).toBe('local://uploads/shot.png');
    expect(outcome.mimeType).toBe('image/png');

    // 会话被补建,原图真的写进 sandbox。
    const created = await agent!.findSessionAcrossKinds(LAZY_SESSION_ID);
    expect(created).toBeDefined();
    const onDisk = path.join(created!.filesDir(), 'uploads', 'shot.png');
    expect(fs.existsSync(onDisk)).toBe(true);
    expect(fs.statSync(onDisk).size).toBe(bytes.byteLength);
  });

  it('小图(解码 < 256KB)→ inline,base64 == 原始字节,不落盘', async () => {
    const agent = await profile.getAgent(agentId);
    const bytes = await pngBytes(200, 150); // 解码 = 200*150*4 = 120KB < 256KB
    const outcome = await processImageAttachment(
      profile,
      agentId,
      LAZY_SESSION_ID,
      bytes,
      'small.png',
    );

    expect(outcome.kind).toBe('inline');
    if (outcome.kind !== 'inline') throw new Error('unreachable');
    expect(outcome.mimeType).toBe('image/png');
    expect(outcome.base64).toBe(Buffer.from(bytes).toString('base64'));
    expect(outcome.width).toBe(200);
    expect(outcome.height).toBe(150);

    // inline 不写盘、不建会话。
    expect(await agent!.findSessionAcrossKinds(LAZY_SESSION_ID)).toBeUndefined();
  });

  it('损坏字节(sharp 解析失败)→ 回落编码字节判别,不抛', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]); // 非法图片,编码 5 字节 < 256KB
    const outcome = await processImageAttachment(
      profile,
      agentId,
      LAZY_SESSION_ID,
      bytes,
      'broken.png',
    );

    // 编码字节远小于阈值 → inline,mime 从扩展名兜底。
    expect(outcome.kind).toBe('inline');
    if (outcome.kind !== 'inline') throw new Error('unreachable');
    expect(outcome.mimeType).toBe('image/png');
    expect(outcome.base64).toBe(Buffer.from(bytes).toString('base64'));
    expect(outcome.width).toBeUndefined();
  });
});
