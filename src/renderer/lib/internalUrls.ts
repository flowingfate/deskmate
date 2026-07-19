/**
 * Renderer 端 URI 路径解析。
 *
 * Renderer 组件持有 URI 字符串(`local://...` / `knowledge://...`),需要调老
 * fs IPC(`fsApi.readFile` / `getWorkspaceFileTree` / 等)前用本模块把 URI 翻成
 * 绝对路径。绝对路径透传给老通道,UI 层享受 URI 抽象。
 *
 * - `local://` 必须有当前 agentId + chatSessionId,否则报错。
 * - `knowledge://` 只要 agentId(== agentId,与 [chat-session.atom.ts] 同语义)。
 * - 非 URI 输入(已是绝对路径)直接返回,方便迁移期混用。
 */
import { internalUrlsApi } from '@/ipc/internalUrls';
import { CurrentSession } from '@/states/currentSession.atom';

/** scheme prefix 简易识别;parse 在主进程做。 */
function isInternalUri(value: string): boolean {
  return value.startsWith('local://') || value.startsWith('knowledge://');
}

export interface ResolveUriOptions {
  /** 覆写 agentId(== agentId);省略则取 CurrentSession。 */
  agentId?: string | null;
  /** 覆写 chatSessionId;省略则取 CurrentSession。 */
  chatSessionId?: string | null;
}

/**
 * 把 URI 翻成绝对路径。非 URI 输入原样返回。
 *
 * @throws Error 当 URI 需要的 ctx(agentId / sessionId)缺失,或 main 端 handler
 *   抛错(sandbox 越界 / agent / session 不存在等)。
 */
export async function resolveUriToPath(
  input: string,
  options: ResolveUriOptions = {},
): Promise<string> {
  if (!isInternalUri(input)) {
    return input;
  }

  const current = CurrentSession.get();
  const agentId = options.agentId ?? current.agentId;
  const sessionId = options.chatSessionId ?? current.sessionId ?? undefined;

  if (!agentId) {
    throw new Error(`Cannot resolve "${input}": no active agent.`);
  }
  if (input.startsWith('local://') && !sessionId) {
    throw new Error(`Cannot resolve "${input}": no active chat session.`);
  }

  const reply = await internalUrlsApi.resolveToPath({
    uri: input,
    agentId,
    sessionId,
  });
  if (!reply.ok) {
    throw new Error(reply.error);
  }
  return reply.absolutePath;
}

/**
 * 同 {@link resolveUriToPath},但失败时返回空串 —— 用在"渲染态优雅退化"场景
 * (KB 未配置 / session 还没建好 → 空 sidepane,不弹错)。
 */
export async function tryResolveUriToPath(
  input: string,
  options: ResolveUriOptions = {},
): Promise<string> {
  try {
    return await resolveUriToPath(input, options);
  } catch {
    return '';
  }
}

/** 是否是 `local://` / `knowledge://` URI(渲染层判别用)。 */
export function isFileUri(value: string): boolean {
  return isInternalUri(value);
}

/**
 * 把 `{ name, url, ... }` 形态的 file descriptor 的 URL 字段从 URI 翻成
 * 绝对路径(URI 才翻,非 URI 原样返回)。`FilePreviewPanel`(聊天 inline 与全局弹窗共用)
 * 等"viewer 接 URI" 调用方用这个保留下游路径语义不变。
 *
 * 解析失败 → 抛错;调用方按需 catch 退化(例如 toast 提示)。
 */
export async function resolveFileDescriptorUrl<T extends { url: string }>(
  descriptor: T,
  options: ResolveUriOptions = {},
): Promise<T> {
  if (!isFileUri(descriptor.url)) return descriptor;
  const absolutePath = await resolveUriToPath(descriptor.url, options);
  return { ...descriptor, url: absolutePath };
}
