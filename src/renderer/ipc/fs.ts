/**
 * Renderer-facing `fsApi` —— URI-aware proxy at the renderer/IPC boundary.
 *
 * 在原 `fs` IPC 之上加一层 URI-aware proxy:`exists` / `stat` / `readFile` /
 * `writeFile` / `access` / `listDir` / `getFileMetadata` / `deletePaths` 接受
 * `local://` / `knowledge://` 形态;wrapper 内部走 `resolveUriToPath`(从
 * `currentSessionStore` 自动取 ctx)翻成绝对路径后再下发给老 IPC channel。
 *
 * 设计取舍:
 *
 * - **不动 IPC 协议** —— shared types / main handler / preload 全部不改。把
 *   URI 解析放在 renderer/IPC 边界,主进程通道保持纯绝对路径契约,避免每个
 *   handler 单点添加 URI 识别 + ctx 注入(~250 LOC vs 本方案 ~30 LOC),且
 *   ctx 永远来自 renderer 的 active session(handler 侧无需"问 renderer 当前
 *   session 是什么")。
 *
 * - **shell ops 不接 URI**:`openPath` / `showInFolder` / `selectFile(s)` /
 *   `selectFolder` / `expandPath` / `downloadFile` 保持绝对路径或纯 OS 字符串。
 *   它们语义上不是"读写文件",是"把字符串交给 OS"——`shell.openExternal` 等
 *   反模式不在本 wrapper 范围内。
 *
 * - **URI 解析失败的语义**:wrapper 抛错(`resolveUriToPath` 内部 throw),
 *   caller try/catch 处理 —— 与既有"绝对路径不存在 → IPC 返结构化失败"
 *   并行。callers that want graceful degradation can wrap in try/catch
 *   themselves(addToKnowledgeBase / FileExplorerSection 已是此模式)。
 *
 * - **非 URI 路径透传**:`resolveUriToPath` 对非 URI 输入原样返回,所以
 *   绝对路径调用零开销 —— 走到 wrapper 内只多了一次 string prefix check。
 */
import { renderToMain } from '@shared/ipc/fs';
import type {
  ReadFileResult,
  WriteFileOptions,
  WriteFileResult,
  StatResult,
  FileAccessResult,
  ListDirResult,
  GetFileMetadataResult,
  DeletePathsResult,
} from '@shared/types/fsTypes';
import { resolveUriToPath } from '@/lib/internalUrls';

const raw = renderToMain.bindRender(window.electronAPI.fs.invoke);

/**
 * 把 URI 翻成绝对路径;非 URI 透传。Wrapper 所有 path-接收方法都走这条。
 */
async function toAbs(input: string): Promise<string> {
  return resolveUriToPath(input);
}

async function toAbsMany(inputs: string[]): Promise<string[]> {
  return Promise.all(inputs.map(toAbs));
}

export const fsApi = {
  // ── shell ops & non-path methods:透传 raw ──
  selectFile: raw.selectFile,
  selectFiles: raw.selectFiles,
  expandPath: raw.expandPath,
  downloadFile: raw.downloadFile,

  // ── semantic ops:URI-aware ──
  async exists(filePath: string): Promise<boolean> {
    return raw.exists(await toAbs(filePath));
  },
  async access(filePath: string): Promise<FileAccessResult> {
    return raw.access(await toAbs(filePath));
  },
  async stat(filePath: string): Promise<StatResult> {
    return raw.stat(await toAbs(filePath));
  },
  async readFile(
    filePath: string,
    encoding?: BufferEncoding | 'base64',
  ): Promise<ReadFileResult> {
    return raw.readFile(await toAbs(filePath), encoding);
  },
  async writeFile(
    filePath: string,
    content: string,
    encoding?: BufferEncoding,
    options?: WriteFileOptions,
  ): Promise<WriteFileResult> {
    return raw.writeFile(await toAbs(filePath), content, encoding, options);
  },
  async listDir(dirPath: string): Promise<ListDirResult> {
    return raw.listDir(await toAbs(dirPath));
  },
  async getFileMetadata(filePath: string): Promise<GetFileMetadataResult> {
    return raw.getFileMetadata(await toAbs(filePath));
  },
  async deletePaths(paths: string[]): Promise<DeletePathsResult> {
    return raw.deletePaths(await toAbsMany(paths));
  },
};
