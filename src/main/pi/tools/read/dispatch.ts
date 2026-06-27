/**
 * `read` 工具的两级 dispatch:
 *
 *  rawPath
 *     │
 *     ▼ splitPathAndSel
 *  ┌──────────────────────────────────────┐
 *  │ path (no selector) + selector        │
 *  └──────────────┬───────────────────────┘
 *                 │
 *                 ▼
 *   ┌─ isInternalUrlInput(path) ? ─── yes ──┐
 *   │                                         ▼
 *   │                       isOfficeExtension(URI ext)?
 *   │                          │            │
 *   │                          ▼ yes        ▼ no
 *   │                resolveToPath →   handler 实现 resolveToPath?
 *   │                office backend       │            │
 *   │                (displayUrl=URI)     ▼ yes        ▼ no
 *   │                          resolveToPath →   internal-url backend
 *   │                          filesystem backend  (router.resolve;1MB / NUL 限制)
 *   │                          (displayUrl=URI)
 *   │
 *   └─ no → isOfficeExtension(ext)? ── yes ──▶ office backend (abs path)
 *                                  no ─────▶ filesystem backend
 *
 * 设计纪律(与 omp 同):
 * - **两层完全正交**:加新 scheme = 加 ProtocolHandler;加新文件格式 = 加扩展名
 *   case;改 selector 语法 = 改 path-utils。三件事互不污染。
 * - **失败模式安全**:无法识别的输入退化为 filesystem path(让 fs 自己抛
 *   ENOENT,LLM 看到的错误消息更具体)。
 * - **office URI**:dispatch 按扩展名分流,office URI 不走 `router.resolve`
 *   (它假设文本内容)而走 `router.resolveToPath` → abs → office backend;LLM
 *   视角的 fileName/url 仍是原 URI。
 * - **用户 sandbox URI 文本(local:// / knowledge://)**:同走 `resolveToPath`
 *   + filesystem backend —— filesystem 的流式分页解除了 in-memory 1MB 上限,
 *   binary 检测从"抛错"降级为"返回 fileTypeHint='binary' + 内容截断",与
 *   `read /abs/path` 语义对齐。`skill://` 等只实现 resolve 的系统资产 scheme
 *   保留 in-memory 路径,小文本契约下 1MB 上限合理。
 */
import * as nodePath from 'node:path';
import {
  InternalUrlRouter,
  isInternalUrlInput,
  toResolveContext,
} from '@main/pi/internal-urls';
import type { ToolContext, ToolResult } from '../types';
import { readFilesystem } from './backends/filesystem';
import { isImageExtension, readImage } from './backends/image';
import { readInternalUrl } from './backends/internal-url';
import { isOfficeExtension, readOffice } from './backends/office';
import { parseSelector, splitPathAndSel, type ReadSelector } from './path-utils';

export interface ReadToolArgs {
  /**
   * 单一字符串入口,涵盖:
   * - 本地路径:`src/foo.ts`、`/abs/path/report.pdf`
   * - 行号 selector:`src/foo.ts:50-200`、`config.json:50+150`
   * - 页码 selector(office 文档):`report.pdf:p3-7`、`report.pdf:p3-7:50-100`
   * - 三段组合:`src/foo.ts:50-200:raw`、`report.pdf:p3-7:50-100:raw`
   * - Internal URL:`skill://foo`、`agent://abc/x.md`
   *
   * 不支持 URL fetch(`https://...`)—— 后续 phase 接入。
   */
  readonly path: string;
}

/**
 * 把任何 backend 结果统一成 `ToolResult.content = JSON.stringify(...)`。
 *
 * 三个 backend 返回的对象 schema 各自不同(filesystem 返回 ReadFileToolResult;
 * office 返回完整 ToolResult;internal-url 返回 InternalUrlReadResult)—— LLM
 * 看的 content 都是 JSON.stringify,字段 unioned。renderer 的
 * `getReadDisplayText` 只看 args(path 字段),不消费 result 内部 schema。
 *
 * **为什么不统一 schema**:`ReadFileToolResult` / `ReadOfficeFileToolResult` 形态
 * 被 fullModeCompressor / 测试 / renderer view 依赖,统一会牵连这些消费者,目前
 * 刻意保持 union;LLM 看到的 JSON.stringify 与 renderer 的 `getReadDisplayText`
 * 都不消费 result 内部 schema,union 不影响外部契约。
 */
export async function dispatchRead(
  args: ReadToolArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { path, sel } = splitPathAndSel(args.path);

  let selector: ReadSelector;
  try {
    selector = sel !== undefined ? parseSelector(sel) : { ranges: [], pages: [], raw: false };
  } catch (err) {
    // selector parse 错抛回去 —— registry 会落成 `{ ok: false, error }`。
    // 错误消息已对 LLM 友好(parseSelector 内部精心写过)。
    throw err;
  }

  // ── 第一级:internal URL ──
  if (isInternalUrlInput(path)) {
    const router = InternalUrlRouter.get();
    const innerPath = stripScheme(path);
    const ext = nodePath.extname(innerPath);

    // Office URI:绕过 router.resolve(文本契约),走 resolveToPath → office backend。
    if (isOfficeExtension(ext)) {
      const abs = await router.resolveToPath(path, toResolveContext(ctx));
      return readOffice({ path: abs, displayUrl: path, selector }, ctx);
    }

    // 图片 URI:绕过文本/filesystem 通道,走 image backend 回 base64,让模型看到图。
    if (isImageExtension(ext) && router.canResolveToPath(path)) {
      const abs = await router.resolveToPath(path, toResolveContext(ctx));
      return readImage({ path: abs, displayUrl: path });
    }

    // 用户 sandbox 文本资源(handler 实现 resolveToPath):走 filesystem backend
    // 流式分页 —— 解除 1MB 上限,binary 文件返回提示而不抛错。`fileName` / `url`
    // 用 LLM-visible URI 注入,abs path 永不外泄(参 office 同模式)。
    if (router.canResolveToPath(path)) {
      const abs = await router.resolveToPath(path, toResolveContext(ctx));
      const fsResult = await readFilesystem({ path: abs, selector, signal: ctx.signal });
      const augmented = { ...fsResult, fileName: deriveDisplayName(path), url: path };
      return { ok: true, content: JSON.stringify(augmented) };
    }

    // 系统资产文本(`skill://` 等不实现 resolveToPath):走 internal-url backend
    // (router.resolve 内存路径,handler 自带 1MB / NUL byte 限制)。
    const result = await readInternalUrl({ path, selector }, ctx);
    return { ok: true, content: JSON.stringify(result) };
  }
  // ── 第二级:按扩展名分发 ──
  const ext = nodePath.extname(path);
  if (isOfficeExtension(ext)) {
    return readOffice({ path, selector }, ctx);
  }
  if (isImageExtension(ext)) {
    return readImage({ path });
  }

  // ── 默认:本地文件系统 ──
  const result = await readFilesystem({ path, selector, signal: ctx.signal });
  return { ok: true, content: JSON.stringify(result) };
}

/** `local://uploads/report.pdf` → `uploads/report.pdf`(供 extname 提取扩展名)。 */
function stripScheme(uri: string): string {
  return uri.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
}

/** `local://uploads/report.md` → `report.md`(LLM-visible fileName,injection 用)。 */
function deriveDisplayName(uri: string): string {
  const noScheme = stripScheme(uri);
  const segments = noScheme.split('/').filter((s) => s.length > 0);
  return segments.at(-1) ?? uri;
}
