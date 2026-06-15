/**
 * `read` 工具的 office 文档 backend(PDF / Word / PowerPoint / Excel)。
 *
 * Handler 走 dynamic import:`impl/readOfficeFile` 顶层 import 了
 * mammoth / jszip / pdfreader(三个加起来 ~1 MB),不能进 startup 主 bundle。
 * 9b 删旧 `readOfficeFile.ts` lazy wrapper 后这里直接 lazy-import,**少一层
 * 间接,bundle 行为完全一致**(同一个 impl 文件作为独立 lazy chunk 输出)。
 *
 * Selector 翻译:
 * - 行号 range → impl 的 startLine/endLine
 * - 页码 range → impl 的 startPage/endPage(PDF/PPT/Excel 原生支持 page slicing,
 *   Word 忽略页码 —— impl 内部决定)
 * - `raw` 当前不影响行为(office 默认就是纯文本提取,无 minified hint)
 *
 * impl 第一次调用时被 `await import()` 解析;首调并发由 `inflight` 共享
 * promise 防双重 evaluate,之后命中 `cachedImpl` 直接返回 —— 与旧 lazy()
 * wrapper 同语义、同性能。
 */

import type { ToolContext, ToolResult } from '../../types';
import type { ReadSelector } from '../path-utils';

export interface OfficeBackendArgs {
  /** Absolute filesystem path the impl will actually read. */
  readonly path: string;
  readonly selector: ReadSelector;
  /**
   * Optional LLM-visible URI (e.g. `local://report.pdf`). When provided:
   * - `fileName` in result is overridden to URI basename (`report.pdf`)
   * - `url` field added to result so LLM sees URI form in tool_result
   *
   * Set by dispatch when routing office-extension internal URLs through this
   * backend; abs path stays internal (only `path` field). When undefined the
   * legacy abs-path code path is taken — impl-derived fileName surfaces as-is.
   */
  readonly displayUrl?: string;
}

/**
 * 已知的 office 扩展名(全小写,不含点)。dispatch 层用它判定文件类型;
 * 与 `impl/readOfficeFile.resolveDocumentType` 接受的扩展集合保持一致。
 */
export const OFFICE_EXTENSIONS: readonly string[] = [
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
] as const;

export function isOfficeExtension(ext: string): boolean {
  return OFFICE_EXTENSIONS.includes(ext.toLowerCase().replace(/^\./, ''));
}

// Type-only import of impl module — `typeof import(...)` does NOT emit any
// runtime dependency, it just borrows the type. Runtime resolution happens
// via the dynamic `import()` below.
type OfficeImplModule = typeof import('../impl/readOfficeFile');
type OfficeImplClass = OfficeImplModule['ReadOfficeFileTool'];

let cachedImpl: OfficeImplClass | null = null;
let inflight: Promise<OfficeImplClass> | null = null;

async function loadImpl(): Promise<OfficeImplClass> {
  if (cachedImpl) return cachedImpl;
  if (!inflight) {
    // Dynamic import exception: impl pulls in mammoth + jszip + pdfreader
    // (~1MB combined); must not enter startup-time main bundle.
    inflight = import('../impl/readOfficeFile').then((m) => {
      cachedImpl = m.ReadOfficeFileTool;
      return m.ReadOfficeFileTool;
    });
  }
  return inflight;
}

/**
 * 读 office 文档。errors 由 impl 抛(被外层 registry try/catch 收成
 * `{ ok: false }`),本函数不做二次包装。
 */
export async function readOffice(
  args: OfficeBackendArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  const [lineRange] = args.selector.ranges;
  const [pageRange] = args.selector.pages;
  const Impl = await loadImpl();
  const result = await Impl.execute(
    {
      filePath: args.path,
      startLine: lineRange?.startLine,
      endLine: lineRange?.endLine,
      startPage: pageRange?.startLine,
      endPage: pageRange?.endLine,
    },
    { signal: ctx.signal },
  );

  if (args.displayUrl !== undefined) {
    // Override LLM-visible fields so URI is the only path the model sees.
    // abs path stays in `args.path` (internal) but never leaves this fn.
    const displayName = deriveOfficeDisplayName(args.displayUrl);
    const augmented = {
      ...result,
      fileName: displayName,
      url: args.displayUrl,
    };
    return { ok: true, content: JSON.stringify(augmented) };
  }
  return { ok: true, content: JSON.stringify(result) };
}

/** `local://uploads/report.pdf` → `report.pdf`; same shape as internal-url backend. */
function deriveOfficeDisplayName(url: string): string {
  const noScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const segments = noScheme.split('/').filter((s) => s.length > 0);
  return segments.at(-1) ?? url;
}
