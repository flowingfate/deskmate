/**
 * 用户附件入 session sandbox 的 IPC 契约。
 *
 * 设计要点:
 * - 渲染进程拖入 / 粘贴 / 剪贴板 / screenshot 的所有文件统一进 sandbox
 *   (`sessions/{sid}/files/uploads/`),返回 LLM 可见的 `local://uploads/<name>` URI。
 * - 渲染层无须知道绝对路径布局 —— 只持有 URI 字符串作为对附件的引用。
 * - `bytes` 走 `Uint8Array`(结构化克隆原生支持);路径走 `srcPath`(由 webUtils
 *   或 dialog 已经拿到的绝对路径)。两条入口接受不同 payload,但归一到同一返回。
 * - 不接受 `profileId` —— 主进程从 IPC sender 解析 owning Profile，避免 renderer 伪造或重复传递窗口 identity。
 */

import { connectRenderToMain } from './base';

export interface AttachContext {
  agentId: string;
  sessionId: string;
}

export interface AttachFromPathInput extends AttachContext {
  /** 源文件绝对路径(由 webUtils.getPathForFile / fs dialog 提供)。 */
  srcPath: string;
  /** 落 sandbox 时使用的文件名;省略则取 srcPath basename。 */
  originalName?: string;
}

export interface AttachFromBytesInput extends AttachContext {
  /** 文件字节(剪贴板图片 / screenshot / 任意 in-memory blob)。 */
  bytes: Uint8Array;
  originalName: string;
}

export interface AttachOutcome {
  /** LLM-visible URI,形如 `local://uploads/<unique-name>`。 */
  uri: string;
  /** sandbox 内的实际文件名(去重后);可能与 originalName 不同。 */
  fileName: string;
  /** 拷贝后落盘的字节数。 */
  size: number;
}

export type AttachReply =
  | { success: true; data: AttachOutcome }
  | { success: false; error: string };

/**
 * 图片附件「内联 vs 落 sandbox」判别 + 物化的入参。判别基准是【解码后像素大小】
 * (width×height×4),不看编码字节 —— PNG 对 UI 截图压得太好,编码字节是糟糕代理。
 * renderer 永远只传原始字节,main 用 sharp 读尺寸一次定夺。
 */
export interface ProcessImageInput extends AttachContext {
  /** 原始图片字节(截图 / 剪贴板 / 文件选择器均归一为字节)。 */
  bytes: Uint8Array;
  /** 落 sandbox 时使用的文件名;也用于尺寸解析失败时回落推断 mime。 */
  originalName: string;
}

/**
 * 判别结果联合:
 * - `inline`:解码 < 256KB(≈256×256)的小图,原始 base64 随消息内联(不压缩)。
 * - `sandbox`:解码 ≥ 256KB 的大图,原图已落 session sandbox,回 `local://uploads/<name>` URI。
 */
export type ProcessImageOutcome =
  | { kind: 'inline'; mimeType: string; base64: string; width?: number; height?: number }
  | { kind: 'sandbox'; uri: string; fileName: string; size: number; mimeType: string; width?: number; height?: number };

export type ProcessImageReply =
  | { success: true; data: ProcessImageOutcome }
  | { success: false; error: string };

type RenderToMain = {
  attachFromPath: { call: [input: AttachFromPathInput]; return: AttachReply };
  attachFromBytes: { call: [input: AttachFromBytesInput]; return: AttachReply };
  processImage: { call: [input: ProcessImageInput]; return: ProcessImageReply };
};

export const renderToMain = connectRenderToMain<RenderToMain>('attachment');
