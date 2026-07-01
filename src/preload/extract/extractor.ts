// 注入脚本**源码** —— 经独立单 entry IIFE 子构建（见 scripts/vite/extractor-plugin.ts）
// 打成 `out/preload/extractor.js`，运行时由 main 侧 `extractFromWebContents` 动态
// `executeJavaScript` 注入**任意** WebContents 的 main world。
//
// 硬约束（呼应 headless-page-extract.md §4.3）：
//   1. 零 export，纯全局副作用：只挂 `window.__deskmateExtract`，绝不向页面泄漏
//      module/exports（IIFE 产物结构上不含 require/module.exports）。
//   2. readability/turndown/gfm 必须 inline bundle（不 external），否则页面 require 报错。
//   3. Readability 必须吃 `document.cloneNode(true)` 的副本（破坏性，不动真实 DOM）。
//   4. 幂等：以 `window.__deskmateExtract` 已存在守卫，避免重复定义。

import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

interface ExtractOptions {
  selectedTextOnly?: boolean;
}

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

declare global {
  interface Window {
    __deskmateExtract?: (opts: ExtractOptions) => InPageExtraction;
  }
}

// 幂等：同页（research live view）反复 Add 时，已定义则不重复装载。
// 注意这只省「重定义」——main 侧仍应先 probe 再决定是否前置整包 SRC（见 extractFromWebContents）。
if (typeof window.__deskmateExtract !== 'function') {
  const cleanText = (value: string | null | undefined): string =>
    String(value || '')
      .replace(/\r\n/g, '\n')
      .replace(/[\t\f\v ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  const metaContent = (selectors: string[]): string | undefined => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const content = el?.getAttribute('content');
      if (content && content.trim()) return content.trim();
    }
    return undefined;
  };

  const buildTurndown = (): TurndownService => {
    const service = new TurndownService({
      codeBlockStyle: 'fenced',
      headingStyle: 'atx',
      bulletListMarker: '-',
    });
    service.use(gfm);
    service.remove(['script', 'style', 'noscript']);
    return service;
  };

  // Readability 判非文章页（返回 null）时的兜底：最长可见容器 innerText。
  const fallbackExtraction = (): { markdown: string } => {
    const candidates = [
      document.querySelector('main'),
      document.querySelector('article'),
      document.querySelector('[role="main"]'),
      document.querySelector('#content'),
      document.querySelector('.content'),
      document.body,
    ].filter((node): node is HTMLElement => Boolean(node));

    let best = '';
    for (const node of candidates) {
      const text = cleanText(node.innerText);
      if (text.length > best.length) best = text;
    }
    return { markdown: best };
  };

  window.__deskmateExtract = (opts: ExtractOptions): InPageExtraction => {
    const selectionRaw = window.getSelection ? window.getSelection()?.toString() : '';
    const selection = cleanText(selectionRaw);
    const url = location.href;
    const hostname = location.hostname;

    const base: InPageExtraction = {
      ok: false,
      title: cleanText(document.title) || url,
      url,
      markdown: '',
      selection,
      siteName: hostname,
      lang: document.documentElement.lang || undefined,
      method: 'readability',
    };

    // 选区模式只取选区文本，不跑 Readability。
    if (opts.selectedTextOnly) {
      return { ...base, ok: selection.length > 0, markdown: selection };
    }

    try {
      // Readability 破坏性改 DOM —— 必须吃 clone，绝不动真实 live page。
      const clone = document.cloneNode(true) as Document;
      const article = new Readability(clone).parse();

      if (article && article.content) {
        const turndown = buildTurndown();
        const markdown = cleanText(turndown.turndown(article.content));
        if (markdown.length > 0) {
          return {
            ...base,
            ok: true,
            title: cleanText(article.title) || base.title,
            markdown,
            byline: article.byline?.trim() || metaContent(['meta[name="author"]']),
            siteName: article.siteName?.trim() || metaContent(['meta[property="og:site_name"]']) || hostname,
            publishedTime: article.publishedTime?.trim() || metaContent(['meta[property="article:published_time"]']),
            excerpt: article.excerpt?.trim() || metaContent(['meta[name="description"]', 'meta[property="og:description"]']),
            lang: article.lang?.trim() || base.lang,
            method: 'readability',
          };
        }
      }
    } catch (error) {
      base.error = error instanceof Error ? error.message : String(error);
    }

    // 兜底：最长可见容器 innerText，保证永远有产出。
    const fallback = fallbackExtraction();
    return {
      ...base,
      ok: fallback.markdown.length > 0,
      markdown: fallback.markdown,
      excerpt: metaContent(['meta[name="description"]', 'meta[property="og:description"]']),
      method: 'readability-fallback',
    };
  };
}
