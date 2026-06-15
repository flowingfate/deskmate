/**
 * 共享的 `workspaceRoot` 参数解析:URI(`local://` / `knowledge://`)→ 走
 * router.resolveToPath;abs path 原样透传。Sandbox 尚未物化(目录还不存在)
 * 时返回 `exists: false`,handler 直接给空结果而非报错 —— LLM 视角下"空 sandbox"
 * 和"已建 sandbox 但无匹配"语义等价。
 *
 * 抽出来给 `find` / `search` 共用 —— 两者 handler wrapper 的 boilerplate
 * (URI 检测 / 解析 / exists / 错误包装)完全一致,合并这一处避免后续两边各
 * 改一遍走样。
 */
import { existsSync } from 'node:fs';

import {
  InternalUrlRouter,
  isInternalUrlInput,
  toResolveContext,
} from '@main/pi/internal-urls';

import type { ToolContext } from '../types';

export interface ResolvedWorkspaceRoot {
  /** 解析后的绝对路径(URI 已展开;非 URI 原样)。 */
  readonly abs: string;
  /** 该绝对路径是否在文件系统上存在。 */
  readonly exists: boolean;
  /** 输入是否是 internal URI 形态(`<scheme>://...`)。 */
  readonly isUri: boolean;
}

/**
 * 解析工具入口的 `workspaceRoot` 参数。失败时抛 `${toolName}: failed to
 * resolve workspaceRoot ...`,caller 可直接 throw 给 LLM。
 */
export async function resolveWorkspaceRootArg(
  raw: string,
  ctx: ToolContext,
  toolName: string,
): Promise<ResolvedWorkspaceRoot> {
  const trimmed = raw.trim();
  const isUri = isInternalUrlInput(trimmed);
  if (!isUri) {
    return { abs: trimmed, exists: existsSync(trimmed), isUri };
  }
  try {
    const router = InternalUrlRouter.get();
    const abs = await router.resolveToPath(trimmed, toResolveContext(ctx));
    return { abs, exists: existsSync(abs), isUri };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`${toolName}: failed to resolve workspaceRoot "${raw}": ${msg}`);
  }
}
