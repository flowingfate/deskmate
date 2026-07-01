/**
 * `app web fetch <url...>` 内核 —— LLM 触发的多 URL 并行抓取 + 内容抽取。
 *
 * 历史:由 `pi/tools/impl/fetchWebContent.ts` 平移而来,后 `WebFetchToolArgs/
 * Result/WebContentResult` 三个原跨进程 shared 类型 inline 到本文件 —— shared
 * 形态的唯一非内核消费者是已删除的 `WebFetchToolCallView.tsx`,kernel 不再有
 * cross-process 边界。
 *
 * 行为契约:
 * - 接受 1-20 个 URL,parallel `fetch`,每个 URL 独立 timeout(默认 30s)
 *   + maxContentSize 限制(默认 1MB)。
 * - HTML 默认走 headless 渲染 + 注入提取 → Markdown(结构/链接/表格/代码块保留);
 *   `--raw` 走 `node-html-parser` 纯文本逃生口。Markdown/JSON/YAML/XML/plain
 *   text 原样透传或最小格式化。
 * - 渲染路径只用 header 判型,判为 HTML 后 cancel body(不 Node 侧下载),渲染失败
 *   才补发一次 GET 拿纯文本兜底。
 * - 单 URL 失败 → 进 `results` 数组带 `error` 字段,**不**抛 —— 多 URL 场景下一个
 *   失败不应让整批塌掉。
 * - `options.signal` 通过 `AbortSignal.any` 与每个 URL 的 timeout signal 合并;
 *   触发 abort 时返回 "Fetch cancelled by user"。
 */

import { parse } from 'node-html-parser';

import { headlessRenderer } from '@main/lib/research/extract/HeadlessRenderer'

// ============ Type definitions(原 `@shared/types/toolCallArgs/webFetch.ts` 平移)============

export interface WebContentResult {
  url: string;
  title: string;
  content: string;
  size: number;
  timestamp: string;
  error?: string;
}

export interface FetchWebContentInternalArgs {
  urls: string[];
  timeoutSeconds?: number;
  maxContentSize?: number;
  raw?: boolean;
}

export interface FetchWebContentInternalResult {
  success: boolean;
  totalUrls: number;
  successfulUrls: number;
  results: WebContentResult[];
  mergedContent: string;
  errors?: string[];
  timestamp: string;
}

// 非渲染路径的内容类型；'html' 仅在 `--raw` 下走文本抽取，否则走 headless 渲染。
type ContentKind = 'markdown' | 'json' | 'yaml' | 'xml' | 'plain' | 'html';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN,zh;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

// 支持透传/渲染的 content-type 与 URL 扩展名;二进制类型(image/octet-stream…)在此被拒。
const SUPPORTED_TYPES = [
  'text/html',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/markdown',
  'application/json',
  'text/json',
  'text/yaml',
  'text/x-yaml',
  'application/x-yaml',
  'application/yaml',
  'text/xml',
  'application/xml',
];
const SUPPORTED_EXTENSIONS = ['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.xml'];

/**
 * 发起带 timeout + 外部 abort 合流的 GET 请求。
 * 主抓取与渲染失败兜底共用,消除各自的 AbortController 样板。
 */
async function fetchWithTimeout(
  url: string,
  timeout: number,
  headers: Record<string, string>,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, controller.signal])
    : controller.signal;
  try {
    return await fetch(url, { method: 'GET', headers, signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/** content-type / 扩展名是否属于可抓取范围(空 content-type 视为可抓取,归 HTML)。 */
function isSupportedContent(contentType: string, url: string): boolean {
  return SUPPORTED_TYPES.some(type => contentType.includes(type)) ||
         contentType === '' ||
         SUPPORTED_EXTENSIONS.some(ext => url.endsWith(ext));
}

/** 按 content-type 与 URL 扩展名判型;都不匹配则归 HTML(空 content-type 亦然)。 */
function classifyContentType(contentType: string, url: string): ContentKind {
  if (contentType.includes('markdown') || url.endsWith('.md') || url.endsWith('.markdown')) return 'markdown';
  if (contentType.includes('json') || url.endsWith('.json')) return 'json';
  if (contentType.includes('yaml') || url.endsWith('.yaml') || url.endsWith('.yml')) return 'yaml';
  if (contentType.includes('xml') || url.endsWith('.xml')) return 'xml';
  if (contentType.includes('text/plain') || url.endsWith('.txt')) return 'plain';
  return 'html';
}

/** 非渲染路径:按类型从原始 body 抽 title/content(markdown 提标题、json 美化、--raw HTML 抽正文)。 */
function buildTextFromRaw(kind: ContentKind, rawContent: string): { title: string; content: string } {
  switch (kind) {
    case 'markdown': {
      const titleMatch = rawContent.match(/^#\s+(.+)$/m);
      return { title: titleMatch ? titleMatch[1].trim() : '', content: rawContent };
    }
    case 'json': {
      try {
        const jsonObj = JSON.parse(rawContent);
        return { title: jsonObj.name || jsonObj.title || '', content: JSON.stringify(jsonObj, null, 2) };
      } catch {
        // 解析失败:原样返回。
        return { title: '', content: rawContent };
      }
    }
    case 'html':
      // 仅 `--raw` 会到这:node-html-parser 纯文本抽取。
      return extractTextFromHTML(rawContent);
    default:
      // yaml / xml / plain:原样透传。
      return { title: '', content: rawContent };
  }
}

/**
 * 渲染失败兜底:补发一次 GET 拿完整 body 纯文本。
 * 仅在渲染路径 cancel 掉 body 后、渲染又失败时调用(罕见)。
 */
async function fetchRawText(url: string, timeout: number, externalSignal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(url, timeout, { 'User-Agent': USER_AGENT }, externalSignal);
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

/**
 * HTML 默认路径:headless 渲染 → Markdown;失败则补发 GET 降级纯文本。
 * 最终内容按 maxContentSize 截断(渲染 markdown 可能超上限,截断而非拒绝整页)。
 */
async function renderHtml(
  url: string,
  timeout: number,
  startedAt: number,
  maxContentSize: number,
  externalSignal?: AbortSignal,
): Promise<{ title: string; content: string }> {
  // 渲染预算 = 本 URL 剩余超时(header 探型已消耗一部分),避免总耗时逼近 2×timeout。
  const renderBudgetMs = Math.max(5_000, timeout - (Date.now() - startedAt));

  let title = '';
  let content = '';
  try {
    const rendered = await headlessRenderer.renderAndExtract(url, {
      timeoutMs: renderBudgetMs,
      signal: externalSignal,
    });
    title = rendered.title;
    content = rendered.markdown;
  } catch {
    // 渲染失败(超时/导航失败/提取空)→ 补发一次 GET 拿 body,降级纯文本,不致命。
    const fallbackHtml = await fetchRawText(url, timeout, externalSignal);
    if (fallbackHtml !== null) {
      const extracted = extractTextFromHTML(fallbackHtml);
      title = extracted.title;
      content = extracted.content;
    }
  }

  if (content.length > maxContentSize) {
    content = `${content.slice(0, maxContentSize)}\n\n[Truncated at ${maxContentSize} characters]`;
  }
  return { title, content };
}

function buildResult(url: string, title: string, content: string): WebContentResult {
  return { url, title, content, size: content.length, timestamp: new Date().toISOString() };
}

function errorResult(url: string, message: string): WebContentResult {
  return { url, title: '', content: '', error: message, size: 0, timestamp: new Date().toISOString() };
}

/**
 * Extract plain text content from HTML
 * Removes HTML tags, JS scripts, and CSS styles, keeping only the main text
 */
function extractTextFromHTML(htmlContent: string): { title: string; content: string } {
  try {
    // Parse HTML using node-html-parser
    const document = parse(htmlContent);

    // Extract the title
    let title = '';
    const titleElement = document.querySelector('title');
    if (titleElement) {
      title = titleElement.text?.trim() || '';
    }

    // Remove unwanted elements
    const elementsToRemove = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'noscript'];
    elementsToRemove.forEach(tagName => {
      const elements = document.querySelectorAll(tagName);
      elements.forEach(element => element.remove());
    });

    // Get the main content area
    let contentElement = document.querySelector('body');

    // Try to find the main content area
    const mainSelectors = [
      'main',
      'article',
      '.content',
      '.main-content',
      '.post-content',
      '.entry-content',
      '#content',
      '#main'
    ];

    for (const selector of mainSelectors) {
      const element = document.querySelector(selector);
      if (element && element.text && element.text.trim().length > 200) {
        contentElement = element;
        break;
      }
    }

    // Extract text content
    let textContent = '';
    if (contentElement) {
      textContent = contentElement.text || '';
    }

    return {
      title: cleanTextContent(title),
      content: cleanTextContent(textContent),
    };

  } catch {
    // Fallback: simple HTML tag removal
    const cleanedText = htmlContent
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    return { title: '', content: cleanTextContent(cleanedText) };
  }
}

/**
 * Clean up text content by removing excess whitespace
 */
function cleanTextContent(text: string): string {
  if (!text) return '';

  return text
    .replace(/\s+/g, ' ')           // Replace multiple whitespace characters with a single space
    .replace(/\n\s*\n/g, '\n')      // Remove extra blank lines
    .trim();
}

/**
 * Validate URL format
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return url.startsWith('http://') || url.startsWith('https://');
  } catch {
    return false;
  }
}

export class FetchWebContentTool {

  /**
   * Execute the web content fetching tool
   * Static method, supports direct LLM invocation
   */
  static async execute(args: FetchWebContentInternalArgs, options?: { signal?: AbortSignal }): Promise<FetchWebContentInternalResult> {
    const validation = this.validateArgs(args);
    if (!validation.isValid) {
      throw new Error(`Invalid arguments: ${validation.error}`);
    }

    const {
      urls,
      timeoutSeconds = 30,
      maxContentSize = 1024 * 1024, // 1MB
      raw = false,
    } = args;

    const timeoutMs = timeoutSeconds * 1000;
    const externalSignal = options?.signal;

    const errors: string[] = [];
    const results: WebContentResult[] = [];

    try {
      const fetchResults = await Promise.allSettled(
        urls.map(url => this.fetchSingleUrl(url, timeoutMs, maxContentSize, raw, externalSignal)),
      );

      // 单 URL 失败也进 results(带 error 字段),不塌整批。
      fetchResults.forEach((result, index) => {
        const url = urls[index];
        if (result.status === 'rejected') {
          const message = String(result.reason);
          results.push(errorResult(url, message));
          errors.push(`URL "${url}": ${message}`);
          return;
        }
        const { webContent, error } = result.value;
        if (webContent) {
          results.push(webContent);
        } else if (error) {
          results.push(errorResult(url, error));
          errors.push(`URL "${url}": ${error}`);
        }
      });

      return {
        success: true,
        totalUrls: urls.length,
        successfulUrls: results.length,
        results,
        mergedContent: this.mergeContent(results),
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      throw new Error(`Web content fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 抓取并抽取单个 URL:请求 → header 判型 → 渲染(HTML 默认) / 文本透传(其余)。
   */
  private static async fetchSingleUrl(
    url: string,
    timeout: number,
    maxContentSize: number,
    raw: boolean,
    externalSignal?: AbortSignal,
  ): Promise<{ webContent?: WebContentResult; error?: string }> {
    try {
      if (!isValidUrl(url)) {
        return { error: 'Invalid URL format' };
      }

      const startedAt = Date.now();
      const response = await fetchWithTimeout(url, timeout, REQUEST_HEADERS, externalSignal);

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const contentType = response.headers.get('content-type') || '';
      if (!isSupportedContent(contentType, url)) {
        await response.body?.cancel().catch(() => undefined);
        return { error: `Unsupported content type: ${contentType}` };
      }

      const kind = classifyContentType(contentType, url);

      // HTML 默认 → headless 渲染,不下载 body:判型只需 header,主动 cancel 省带宽/时间。
      if (kind === 'html' && !raw) {
        await response.body?.cancel().catch(() => undefined);
        const { title, content } = await renderHtml(url, timeout, startedAt, maxContentSize, externalSignal);
        return { webContent: buildResult(url, title, content) };
      }

      // 非渲染路径(非 HTML / --raw):读 body 一次;raw 字节上限在此生效。
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > maxContentSize) {
        return { error: `Content too large: ${contentLength} bytes` };
      }

      const rawContent = await response.text();
      if (rawContent.length > maxContentSize) {
        return { error: `Content too large: ${rawContent.length} characters` };
      }

      const { title, content } = buildTextFromRaw(kind, rawContent);
      return { webContent: buildResult(url, title, content) };

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { error: externalSignal?.aborted ? 'Fetch cancelled by user' : 'Request timed out' };
      }
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Merge all fetched content
   */
  private static mergeContent(results: WebContentResult[]): string {
    if (results.length === 0) {
      return '';
    }

    const sections = results.map((result, index) => [
      `## Page ${index + 1}: ${result.title || 'Untitled'}`,
      `**URL:** ${result.url}`,
      `**Fetched at:** ${result.timestamp}`,
      `**Content size:** ${result.size} characters`,
      '',
      '**Content:**',
      result.content,
      '',
    ].join('\n'));

    return [
      `# Web Content Fetch Results`,
      `**Total:** ${results.length} pages`,
      `**Fetch completed at:** ${new Date().toISOString()}`,
      '',
      '---',
      '',
      ...sections,
    ].join('\n');
  }

  /**
   * Validate arguments
   */
  private static validateArgs(args: FetchWebContentInternalArgs): { isValid: boolean; error?: string } {
    if (!args.urls || !Array.isArray(args.urls)) {
      return { isValid: false, error: 'urls is required and must be an array' };
    }

    if (args.urls.length === 0) {
      return { isValid: false, error: 'urls array cannot be empty' };
    }

    if (args.urls.length > 20) {
      return { isValid: false, error: 'urls array cannot contain more than 20 items' };
    }

    for (let i = 0; i < args.urls.length; i++) {
      const url = args.urls[i];
      if (typeof url !== 'string' || !isValidUrl(url)) {
        return { isValid: false, error: `URL at index ${i} is invalid: ${url}` };
      }
    }

    if (args.timeoutSeconds !== undefined) {
      if (typeof args.timeoutSeconds !== 'number' || args.timeoutSeconds < 5 || args.timeoutSeconds > 60) {
        return { isValid: false, error: 'timeoutSeconds must be a number between 5 and 60 seconds' };
      }
    }

    if (args.maxContentSize !== undefined) {
      if (!Number.isInteger(args.maxContentSize) || args.maxContentSize < 1024 || args.maxContentSize > 10485760) {
        return { isValid: false, error: 'maxContentSize must be an integer between 1024 and 10485760 bytes' };
      }
    }

    return { isValid: true };
  }
}
