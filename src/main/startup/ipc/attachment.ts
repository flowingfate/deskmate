/**
 * Attachment IPC —— 用户附件落 session sandbox。
 *
 * profile 从 IPC sender 所属 BrowserWindow 解析；renderer 不传或伪造 profileId。
 * agent / session 任一缺失或抓不到属于 client-side bug —— 返回结构化 error,
 * 不抛(渲染层 alert 即可)。
 */
import { ipcMain } from 'electron';
import sharp from 'sharp';

import { renderToMain, type ProcessImageOutcome } from '@shared/ipc/attachment';
import { FILE_ATTACHMENT_LIMITS } from '@shared/types/chatTypes';
import { ProfileStore } from '@main/persist';
import type { Profile } from '@main/profile';
import { attachFromPath, attachFromBytes } from '@main/lib/attachment';
import { log } from '@main/log';
import { requireProfileForSender } from './profileContext';

const logger = log.child({ mod: 'AttachmentIpc' });

/**
 * 物化附件前确保 session sandbox 已落盘。
 *
 * 新会话走 lazy-create:renderer 在 "New Chat" 时只本地 `newEntityId('s')` 生成
 * sessionId 并 navigate,直到发送首条消息才落盘(`pi.Agent.getOrCreateSession`)。
 * 但带附件发送时,附件物化(`createMessage` 的 `Promise.all` finalize)先于
 * `streamMessage` 执行 —— 此刻 `data.json` 尚不存在,`local://` handler 的
 * `resolveBaseDir` 会因 `findSessionAcrossKinds` 未命中抛 "Session not found"。
 * 这里用 renderer 持有的同一 sessionId 补建 regular session,与 pi 侧 lazy-create
 * 幂等(后续 `getOrCreateSession` 的 `getSession` 直接命中已落盘的行)。
 *
 * agent 缺失时不抛 —— 交由下游 `attachFromX` 走 `resolveBaseDir` 抛结构化
 * "Agent not found",保持单一错误出口。
 */
export async function ensureSandboxSession(
  store: ProfileStore,
  agentId: string,
  sessionId: string,
): Promise<void> {
  const agent = await store.getAgent(agentId);
  if (!agent) return;
  if (await agent.findSessionAcrossKinds(sessionId)) return;
  await agent.createSession({ id: sessionId });
}

/** 扩展名 → 图片 mime 的兜底映射(仅在 sharp 解析尺寸失败时用)。 */
function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'image/png';
  }
}

/**
 * 图片附件「内联 vs 落 sandbox」判别 + 物化 —— 唯一判别点(从 renderer 搬到 main)。
 *
 * 判别基准是【解码后像素大小】(width×height×4),不看编码字节:PNG 对 UI 截图压得
 * 太好,编码字节是糟糕代理(1064×768 截图编码仅 ~119KB,内联却吃满 vision token)。
 * - 解码 < `IMAGE_INLINE_MAX_BYTES`(256KB,≈256×256)→ `inline`,原始 base64 随消息
 *   内联(不压缩 —— 已足够小)。
 * - 解码 ≥ 阈值 → `sandbox`,原图落 session sandbox,renderer 建 `image`+`fileRef` 附件
 *   (egress 不内联、走文件注解让模型按需 `read`;read backend 按 OpenAI vision 指南压缩后回 base64)。
 * - sharp 解析尺寸失败(损坏 / 不支持如 bmp)→ 回落用编码字节判别,mime 从扩展名推断。
 *
 * 导出供 IPC handler 与单测直接调用(与 `ensureSandboxSession` 同纪律)。
 */
export async function processImageAttachment(
  profile: Profile,
  agentId: string,
  sessionId: string,
  bytes: Uint8Array,
  originalName: string,
): Promise<ProcessImageOutcome> {
  // structured-clone 把 Uint8Array 原样过来,Buffer.from 共享底层 ArrayBuffer 避免拷贝。
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let decodedBytes: number;
  let mimeType: string;
  let width: number | undefined;
  let height: number | undefined;
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) throw new Error('missing dimensions');
    width = meta.width;
    height = meta.height;
    decodedBytes = width * height * 4;
    mimeType = meta.format ? `image/${meta.format}` : mimeFromName(originalName);
  } catch {
    decodedBytes = buf.length;
    mimeType = mimeFromName(originalName);
  }

  if (decodedBytes < FILE_ATTACHMENT_LIMITS.IMAGE_INLINE_MAX_BYTES) {
    return {
      kind: 'inline',
      mimeType,
      base64: buf.toString('base64'),
      width,
      height,
    };
  }

  await ensureSandboxSession(profile.store, agentId, sessionId);
  const outcome = await attachFromBytes(buf, originalName, { agentId, sessionId }, profile);
  return {
    kind: 'sandbox',
    uri: outcome.uri,
    fileName: outcome.fileName,
    size: outcome.size,
    mimeType,
    width,
    height,
  };
}

export default function handleAttachmentIPC(): void {
  const handle = renderToMain.bindMain(ipcMain);

  handle.attachFromPath(async (event, input) => {
    try {
      const profile = requireProfileForSender(event);
      await ensureSandboxSession(profile.store, input.agentId, input.sessionId);
      const outcome = await attachFromPath(
        input.srcPath,
        input.originalName,
        { agentId: input.agentId, sessionId: input.sessionId },
        profile,
      );
      return {
        success: true,
        data: { uri: outcome.uri, fileName: outcome.fileName, size: outcome.size },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ msg: 'attachFromPath failed', err: message, srcPath: input.srcPath });
      return { success: false, error: message };
    }
  });

  handle.attachFromBytes(async (event, input) => {
    try {
      const profile = requireProfileForSender(event);
      await ensureSandboxSession(profile.store, input.agentId, input.sessionId);
      // structured-clone 把 Uint8Array 原样过来,Buffer.from 共享底层 ArrayBuffer 避免拷贝。
      const buf = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
      const outcome = await attachFromBytes(
        buf,
        input.originalName,
        { agentId: input.agentId, sessionId: input.sessionId },
        profile,
      );
      return {
        success: true,
        data: { uri: outcome.uri, fileName: outcome.fileName, size: outcome.size },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ msg: 'attachFromBytes failed', err: message, name: input.originalName });
      return { success: false, error: message };
    }
  });

  handle.processImage(async (event, input) => {
    try {
      const profile = requireProfileForSender(event);
      const data = await processImageAttachment(
        profile,
        input.agentId,
        input.sessionId,
        input.bytes,
        input.originalName,
      );
      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ msg: 'processImage failed', err: message, name: input.originalName });
      return { success: false, error: message };
    }
  });
}
