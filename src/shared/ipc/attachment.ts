/**
 * 用户附件入 session sandbox 的 IPC 契约。
 *
 * 设计要点:
 * - 渲染进程拖入 / 粘贴 / 剪贴板 / screenshot 的所有文件统一进 sandbox
 *   (`sessions/{sid}/files/uploads/`),返回 LLM 可见的 `local://uploads/<name>` URI。
 * - 渲染层无须知道绝对路径布局 —— 只持有 URI 字符串作为对附件的引用。
 * - `bytes` 走 `Uint8Array`(结构化克隆原生支持);路径走 `srcPath`(由 webUtils
 *   或 dialog 已经拿到的绝对路径)。两条入口接受不同 payload,但归一到同一返回。
 * - 不接受 `profileId` —— 主进程内部用 active profile,避免渲染层学 profile id。
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

type RenderToMain = {
  attachFromPath: { call: [input: AttachFromPathInput]; return: AttachReply };
  attachFromBytes: { call: [input: AttachFromBytesInput]; return: AttachReply };
};

export const renderToMain = connectRenderToMain<RenderToMain>('attachment');
