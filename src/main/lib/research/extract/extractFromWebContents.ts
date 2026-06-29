// 「一个 DOM + 一段注入提取器 → ExtractedContent」的 main 侧实现。
//
// 对**任意** WebContents（research live view / headless 隐藏渲染）动态注入
// extractor IIFE，调用页面内 `window.__deskmateExtract(opts)` 拿 InPageExtraction，
// 再做截断 / 字段兜底，返回统一形态 ExtractedContent。

import type { WebContents } from 'electron';
import type { ExtractedContent, ExtractionMethod } from '@shared/types/extractedContent';
import { getExtractorScript } from './injectScript';

const MAX_CHARS_PER_SOURCE = 40_000;

// 与 src/preload/extract/extractor.ts 的注入产物契约对齐。
interface InPageExtraction {
  ok: boolean;
  title: string;
  url: string;
  markdown: string;
  selection: string;
  byline?: string;
  siteName?: string;
  publishedTime?: string;
  excerpt?: string;
  lang?: string;
  method: 'readability' | 'readability-fallback';
  error?: string;
}

export interface ExtractFromWebContentsOptions {
  selectedTextOnly: boolean;
  // headless 渲染场景下 wc.getURL() 可能已被导航覆盖，传入原始 URL 兜底。
  sourceUrl?: string;
}

export async function extractFromWebContents(
  wc: WebContents,
  opts: ExtractFromWebContentsOptions,
): Promise<ExtractedContent> {
  // cheap probe：同页（research live view）反复 Add 时避免每次重 parse 数十 KB 依赖；
  // 未注入才前置整包 SRC。headless 一次性窗口走同一路径（首次 probe 必 miss）。
  const probe = await wc.executeJavaScript('typeof window.__deskmateExtract', true);
  if (probe !== 'function') {
    await wc.executeJavaScript(getExtractorScript(), true);
  }

  const payload = `window.__deskmateExtract(${JSON.stringify({ selectedTextOnly: opts.selectedTextOnly })})`;
  const extracted: InPageExtraction = await wc.executeJavaScript(payload, true);

  if (opts.selectedTextOnly) {
    const selection = (extracted.selection || '').trim();
    if (selection.length === 0) throw new Error('No selected text on current page.');
    return buildContent(selection, 'selection', extracted, wc, opts);
  }

  const markdown = (extracted.markdown || '').trim();
  if (markdown.length === 0) {
    throw new Error('Could not extract readable content from current page.');
  }
  return buildContent(markdown, extracted.method, extracted, wc, opts);
}

function buildContent(
  text: string,
  method: ExtractionMethod,
  extracted: InPageExtraction,
  wc: WebContents,
  opts: ExtractFromWebContentsOptions,
): ExtractedContent {
  const truncated = text.length > MAX_CHARS_PER_SOURCE
    ? `${text.slice(0, MAX_CHARS_PER_SOURCE)}\n\n[Truncated at ${MAX_CHARS_PER_SOURCE} characters]`
    : text;

  const url = (extracted.url || '').trim() || opts.sourceUrl || wc.getURL();
  const title = (extracted.title || '').trim() || wc.getTitle().trim() || url;

  return {
    url,
    title,
    markdown: truncated,
    byline: extracted.byline,
    siteName: extracted.siteName,
    publishedTime: extracted.publishedTime,
    excerpt: extracted.excerpt,
    lang: extracted.lang,
    charCount: truncated.length,
    method,
    capturedAt: new Date().toISOString(),
  };
}
