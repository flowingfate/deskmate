/**
 * Renderer 侧把 File 物化进 session sandbox 的统一入口。
 *
 * 流程:
 * 1. File 已带 sandbox URI(`local://` / `knowledge://`)→ 直接复用,不重复拷贝。
 * 2. File 带 `fullPath`(electron drag/drop / file-picker 已拿到的绝对路径)→
 *    走 `attachFromPath`(reflink 优先,fallback 普通 copy)。
 * 3. File 不带绝对路径(剪贴板 / screenshot / 内存合成)→ 读 bytes 走
 *    `attachFromBytes`,主进程直接写盘。
 *
 * 调用方拿到 URI 后写回 `(file as FileWithSource).fullPath` —— 下游
 * ContentConverter 读这个字段即可得到 LLM-visible URI,renderer 也用它做 dedup。
 */
import { attachmentApi } from '@/ipc/attachment';

export interface AttachContext {
  agentId: string;
  sessionId: string;
}

/**
 * 给 File 对象注入 `fullPath` 字段的扩展形态。Electron 的 `webUtils.getPathForFile`
 * 在 main / renderer 边界两侧都加这个挂载字段,代码中以 `FileWithSource` 统一访问,
 * 避免散落 `as any` —— 即满足 ts-no-any 又把弱契约显式化。
 */
export interface FileWithSource extends File {
  fullPath?: string;
}

export async function copyFileToSandbox(file: FileWithSource, ctx: AttachContext): Promise<string> {
  const fullPath = file.fullPath;
  if (fullPath && (fullPath.startsWith('local://') || fullPath.startsWith('knowledge://'))) {
    return fullPath;
  }
  if (fullPath && fullPath !== file.name) {
    const reply = await attachmentApi.attachFromPath({
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      srcPath: fullPath,
      originalName: file.name,
    });
    if (!reply.success) throw new Error(reply.error);
    return reply.data.uri;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const reply = await attachmentApi.attachFromBytes({
    agentId: ctx.agentId,
    sessionId: ctx.sessionId,
    bytes,
    originalName: file.name,
  });
  if (!reply.success) throw new Error(reply.error);
  return reply.data.uri;
}
