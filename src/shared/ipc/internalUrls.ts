/**
 * Internal URL renderer-facing IPC。
 *
 * 设计要点:
 * - Renderer 在调老 fs IPC(`fsApi.readFile` / `getWorkspaceFileTree` / 等)前,
 *   用本通道把 `local://...` / `knowledge://...` 翻成绝对路径 —— UI 层享受 URI
 *   抽象,fs IPC 通道保持纯绝对路径契约。
 * - **不接受 profileId** —— 主进程内部用 active profile,避免渲染层学 profile id。
 * - 需要 agentId / sessionId 由调用方传入(同 attachment IPC 纪律):
 *   - `local://` 需要 agentId + sessionId
 *   - `knowledge://` 需要 agentId(sessionId 可空,handler 不消费)
 * - 没实现 `resolveToPath?` 的 scheme(如 `skill://`)→ reply `{ ok: false, error }`,
 *   不在 IPC 层做兜底,让 caller 看清楚 scheme 没暴露 fs path。
 */

import { connectRenderToMain } from './base';

export interface ResolveUriContext {
  agentId: string;
  /** `knowledge://` 不消费 sessionId,但调用方仍可传(handler 内部忽略)。 */
  sessionId?: string;
}

export interface ResolveUriInput extends ResolveUriContext {
  /** `local://...` / `knowledge://...` —— 必须是已注册 scheme。空 path 等于 sandbox 根目录。 */
  uri: string;
}

export type ResolveUriReply =
  | { ok: true; absolutePath: string }
  | { ok: false; error: string };

type RenderToMain = {
  resolveToPath: { call: [input: ResolveUriInput]; return: ResolveUriReply };
};

export const renderToMain = connectRenderToMain<RenderToMain>('internalUrls');
