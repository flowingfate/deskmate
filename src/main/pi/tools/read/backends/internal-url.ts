/**
 * `read` 工具的 internal URL backend。
 *
 * 路由委托给 {@link InternalUrlRouter} 单例 —— `read` 工具只负责"识别这是
 * internal URL"和"把结果转成 LLM 可见 string"。所有具体 scheme 的解析都在
 * `internal-urls/handlers/`。
 *
 * Selector 当前只支持行号范围在 router 返回的文本上做后处理(内存里按行切),
 * `raw` 暂不影响行为。这与 omp 模式一致 —— internal resource 本身已是文本,
 * 文件流式分页那一套(避免一次性吃满内存)对这类资源不必要。
 */
import { InternalUrlRouter } from '@main/pi/internal-urls';
import type { InternalResource } from '@main/pi/internal-urls';
import type { ToolContext } from '../../types';
import { toResolveContext } from '@main/pi/internal-urls';
import type { ReadSelector } from '../path-utils';

export interface InternalUrlBackendArgs {
  readonly path: string;
  readonly selector: ReadSelector;
}

export interface InternalUrlReadResult {
  /** 与 ReadFileToolResult 同形,方便上层统一 stringify。 */
  readonly content: string;
  readonly fileName: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
  readonly size: number;
  readonly truncated: boolean;
  /** internal resource 不暴露 fileTypeHint —— content type 来自 handler。 */
  readonly contentType: InternalResource['contentType'];
  readonly url: string;
  readonly immutable: boolean;
  readonly notes?: readonly string[];
}

export async function readInternalUrl(
  args: InternalUrlBackendArgs,
  ctx: ToolContext,
): Promise<InternalUrlReadResult> {
  const router = InternalUrlRouter.get();
  const resource = await router.resolve(args.path, toResolveContext(ctx));

  const allLines = resource.content.split('\n');
  const totalLines = allLines.length;

  const [range] = args.selector.ranges;
  const start = Math.max(1, range?.startLine ?? 1);
  // open-ended 或没指定 → 取到 EOF
  const end = Math.min(totalLines, range?.endLine ?? totalLines);

  // 越界:start 超过 totalLines 时返回空 + 友好提示,与 readFile 风格对齐。
  let slicedLines: string[];
  let actualEnd: number;
  let truncated = false;
  if (start > totalLines) {
    slicedLines = [];
    actualEnd = start;
    truncated = true;
  } else {
    slicedLines = allLines.slice(start - 1, end);
    actualEnd = start + slicedLines.length - 1;
    truncated = end < totalLines || start > 1;
  }
  const content = slicedLines.join('\n');

  // fileName 派生:`skill://foo` → "foo",`agent://abc/x.md` → "x.md"
  // 仅用于 UI 显示,不参与逻辑。
  const fileName = deriveDisplayName(resource.url);

  return {
    content,
    fileName,
    startLine: start,
    endLine: actualEnd,
    totalLines,
    size: content.length,
    truncated,
    contentType: resource.contentType,
    url: resource.url,
    immutable: resource.immutable ?? false,
    notes: resource.notes,
  };
}

function deriveDisplayName(url: string): string {
  // 取最后一段非空 segment;无则返回整个 url。
  const noScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const segments = noScheme.split('/').filter((s) => s.length > 0);
  return segments.at(-1) ?? url;
}
