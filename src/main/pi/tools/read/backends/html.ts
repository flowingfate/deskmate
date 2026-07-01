/**
 * `read` 工具的 HTML backend(`.html` / `.htm`)。
 *
 * 由 `web read-html` 子命令并入而来:读取本地 HTML 从来都是 `read` 的职责
 * (online HTML 用 `web fetch`)。本 backend 把统一 `read` 的 `.html` / `.htm`
 * 分流到 agent-safe 的结构化阅读(`./htmlReader`),**绝不**默认 dump 原始 HTML。
 *
 * 参数承载:**URI query**(`?key=value`),而非 `:<sel>` 行号语法 —— 两条正交轴:
 *   - `:<sel>`(行/页/raw)= "把文件当纯文本读";HTML 命中此轴时 dispatch 直接
 *     走 filesystem backend(逐字),不进本 backend。
 *   - `?query`(命名参数)= "按 HTML 语义读"。CSS selector 含 `#`/`.` 与 `:`
 *     语法冲突,query 用 `URLSearchParams` 解析(不走 `new URL()`,`#` 保持字面),
 *     天然规避冲突。
 *
 * query 形态(对齐老 `read-html` flag):
 *   - `?mode=outline`(默认,可省略)→ DOM 骨架
 *   - `?mode=section&section=main|article|body|head` → 语义块纯文本(默认 body)
 *   - `?mode=selector&selector=<css>` → CSS 抽取(`#id` / `.class` / `tag`)
 *
 * 非法 mode / section、selector mode 缺 selector → 抛错(registry 收成
 * `{ ok: false }`,LLM 看到具体原因)。
 */

import * as nodePath from 'node:path';

import type { ToolContext, ToolResult } from '../../types';
import {
  readHtmlInternal,
  type HtmlReadMode,
  type HtmlSection,
} from './htmlReader';

/** 已知 HTML 扩展名(不含点,全小写)。dispatch 用它判定文件类型。 */
const HTML_EXTENSIONS: Record<string, true> = {
  html: true,
  htm: true,
};

/** ext 形如 `.html` 或 `html`,大小写不敏感。 */
export function isHtmlExtension(ext: string): boolean {
  return HTML_EXTENSIONS[ext.replace(/^\./, '').toLowerCase()] === true;
}

const MODES: Record<string, HtmlReadMode> = {
  outline: 'outline',
  section: 'section',
  selector: 'selector',
};
const SECTIONS: Record<string, HtmlSection> = {
  main: 'main',
  article: 'article',
  body: 'body',
  head: 'head',
};

export interface HtmlBackendArgs {
  /** Absolute filesystem path the reader will actually open. */
  readonly path: string;
  /** Raw URI query string (`mode=...&section=...`), without leading `?`. Undefined = outline default. */
  readonly query?: string;
  /**
   * Optional LLM-visible URI (e.g. `local://page.html`). When provided, result
   * `fileName` / `filePath` are overridden to the URI form so the abs path never
   * leaks — mirrors the office / internal-url backends.
   */
  readonly displayUrl?: string;
}

interface HtmlModeParams {
  mode: HtmlReadMode;
  section?: HtmlSection;
  selector?: string;
}

/**
 * 解析 query 成 reader 参数。空 query → outline 默认。非法值抛错(caller 不
 * 兜底,registry 把错误透传给 LLM)。
 */
function parseHtmlQuery(query: string | undefined): HtmlModeParams {
  if (query === undefined || query.trim() === '') {
    return { mode: 'outline' };
  }
  // URLSearchParams:`#`/`.`/`:` 在 value 内保持字面,CSS selector 不必编码。
  const params = new URLSearchParams(query);

  const modeRaw = params.get('mode') ?? 'outline';
  const mode = MODES[modeRaw];
  if (mode === undefined) {
    throw new Error(`read html: ?mode must be outline, section, or selector (got "${modeRaw}").`);
  }

  if (mode === 'section') {
    const sectionRaw = params.get('section') ?? 'body';
    const section = SECTIONS[sectionRaw];
    if (section === undefined) {
      throw new Error(`read html: ?section must be main, article, body, or head (got "${sectionRaw}").`);
    }
    return { mode, section };
  }

  if (mode === 'selector') {
    const selector = params.get('selector');
    if (selector === null || selector.trim() === '') {
      throw new Error('read html: ?selector=<css> required when mode=selector (e.g. ?mode=selector&selector=%23main).');
    }
    return { mode, selector: selector.trim() };
  }

  return { mode: 'outline' };
}

/** `local://uploads/page.html` → `page.html`。 */
function deriveDisplayName(url: string): string {
  const noScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const base = noScheme.split('/').filter((s) => s.length > 0).pop();
  return base ?? noScheme;
}

/**
 * 读 HTML 文件(结构化)。reader 抛错由外层 registry 收成 `{ ok: false }`,
 * 本函数只在 query 解析层抛友好错误。
 */
export async function readHtml(args: HtmlBackendArgs, ctx: ToolContext): Promise<ToolResult> {
  const params = parseHtmlQuery(args.query);
  const result = await readHtmlInternal(
    {
      filePath: args.path,
      mode: params.mode,
      section: params.section,
      selector: params.selector,
    },
    { signal: ctx.signal },
  );

  if (args.displayUrl !== undefined) {
    // 覆盖 LLM 可见路径字段:abs path 只活在 args.path,不出境。
    const augmented = {
      ...result,
      fileName: deriveDisplayName(args.displayUrl),
      filePath: args.displayUrl,
    };
    return { ok: true, content: JSON.stringify(augmented) };
  }
  return { ok: true, content: JSON.stringify(result) };
}
