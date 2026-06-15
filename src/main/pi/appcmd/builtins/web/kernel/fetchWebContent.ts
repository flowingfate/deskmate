/**
 * `app web fetch <url...>` 内核 —— LLM 触发的多 URL 并行抓取 + 纯文本抽取。
 *
 * 历史:由 `pi/tools/impl/fetchWebContent.ts` 平移而来,**body 一字不改**,
 * 只把 `WebFetchToolArgs/Result/WebContentResult` 三个跨进程 shared 类型
 * inline 到本文件 —— shared 形态的唯一非内核消费者是已删除的
 * `WebFetchToolCallView.tsx`,kernel 不再有 cross-process 边界。
 *
 * 行为契约:
 * - 接受 1-20 个 URL,parallel `fetch`,每个 URL 独立 timeout(默认 30s)
 *   + maxContentSize 限制(默认 1MB)。
 * - HTML 走 `node-html-parser` 提取 `<title>` + 主 content area(`main` /
 *   `article` / `#content` 等优先级)+ 清理 script/style/nav/header/footer。
 *   Markdown / JSON / YAML / XML / plain text 走原样透传或最小格式化。
 * - 单 URL 失败 → 进 `results` 数组带 `error` 字段,**不**抛 —— 多 URL
 *   场景下一个失败不应让整批塌掉。
 * - `options.signal` 通过 `AbortSignal.any` 与每个 URL 的 timeout signal
 *   合并;触发 abort 时返回 "Fetch cancelled by user"。
 */

import { parse } from 'node-html-parser';

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

    // Clean up text content
    const cleanedContent = cleanTextContent(textContent);

    return {
      title: cleanTextContent(title),
      content: cleanedContent
    };

  } catch (error) {
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

    return {
      title: '',
      content: cleanTextContent(cleanedText)
    };
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
    .replace(/^\s+|\s+$/g, '')      // Remove leading and trailing whitespace
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

    // 1. Validate arguments
    const validation = this.validateArgs(args);
    if (!validation.isValid) {
      throw new Error(`Invalid arguments: ${validation.error}`);
    }

    const {
      urls,
      timeoutSeconds = 30,
      maxContentSize = 1024 * 1024 // 1MB
    } = args;

    // Convert to milliseconds
    const timeoutMs = timeoutSeconds * 1000;

    // Use a fixed User-Agent
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const externalSignal = options?.signal;

    const errors: string[] = [];
    const results: WebContentResult[] = [];

    try {
      // 2. Fetch URLs in parallel

      const fetchPromises = urls.map(async (url, index) => {
        return this.fetchSingleUrl(url, timeoutMs, maxContentSize, userAgent, index, externalSignal);
      });

      const fetchResults = await Promise.allSettled(fetchPromises);

      // 3. Process fetch results
      fetchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const { webContent, error } = result.value;
          if (webContent) {
            results.push(webContent);
          } else if (error) {
            // Failed URLs are also added to results with an error field
            results.push({
              url: urls[index],
              title: '',
              content: '',
              error: error,
              size: 0,
              timestamp: new Date().toISOString()
            });
            errors.push(`URL "${urls[index]}": ${error}`);
          }
        } else {
          const errorMsg = String(result.reason);
          // Failed URLs are also added to results with an error field
          results.push({
            url: urls[index],
            title: '',
            content: '',
            error: errorMsg,
            size: 0,
            timestamp: new Date().toISOString()
          });
          errors.push(`URL "${urls[index]}": ${errorMsg}`);
        }
      });

      // 4. Merge all content
      const mergedContent = this.mergeContent(results);


      return {
        success: true,
        totalUrls: urls.length,
        successfulUrls: results.length,
        results: results,
        mergedContent: mergedContent,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      throw new Error(`Web content fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch content from a single URL
   */
  private static async fetchSingleUrl(
    url: string,
    timeout: number,
    maxContentSize: number,
    userAgent: string,
    urlIndex: number,
    externalSignal?: AbortSignal
  ): Promise<{ webContent?: WebContentResult, error?: string }> {
    try {

      // URL validation
      if (!isValidUrl(url)) {
        return { error: 'Invalid URL format' };
      }

      // Initiate HTTP request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const fetchSignal = externalSignal
        ? AbortSignal.any([externalSignal, controller.signal])
        : controller.signal;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,zh-CN,zh;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        signal: fetchSignal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = `HTTP ${response.status}: ${response.statusText}`;
        return { error };
      }

      // Check content type
      const contentType = response.headers.get('content-type') || '';
      const supportedTypes = [
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
      const supportedExtensions = ['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.xml'];
      const isTextContent = supportedTypes.some(type => contentType.includes(type)) ||
                            contentType === '' ||  // Allow empty content-type (some servers don't return one)
                            supportedExtensions.some(ext => url.endsWith(ext)); // Determine by URL extension

      if (!isTextContent) {
        return { error: `Unsupported content type: ${contentType}` };
      }

      // Check content size
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > maxContentSize) {
        return { error: `Content too large: ${contentLength} bytes` };
      }

      // Get content
      const rawContent = await response.text();

      // Check actual content size
      if (rawContent.length > maxContentSize) {
        return { error: `Content too large: ${rawContent.length} characters` };
      }

      // Process based on content type
      const isMarkdown = contentType.includes('markdown') ||
                         url.endsWith('.md') ||
                         url.endsWith('.markdown');
      const isPlainText = contentType.includes('text/plain') || url.endsWith('.txt');
      const isJson = contentType.includes('json') || url.endsWith('.json');
      const isYaml = contentType.includes('yaml') || url.endsWith('.yaml') || url.endsWith('.yml');
      const isXml = contentType.includes('xml') || url.endsWith('.xml');

      let title = '';
      let content = '';

      if (isMarkdown) {
        // Markdown: use directly without HTML parsing
        // Try to extract title from Markdown (first line starting with #)
        const titleMatch = rawContent.match(/^#\s+(.+)$/m);
        title = titleMatch ? titleMatch[1].trim() : '';
        content = rawContent;
      } else if (isJson) {
        // Format JSON output
        try {
          const jsonObj = JSON.parse(rawContent);
          title = jsonObj.name || jsonObj.title || '';
          content = JSON.stringify(jsonObj, null, 2);
        } catch {
          // JSON parsing failed, return raw content directly
          title = '';
          content = rawContent;
        }
      } else if (isYaml || isXml || isPlainText) {
        // YAML, XML and plain text: return directly
        title = '';
        content = rawContent;
      } else {
        // HTML content needs text extraction
        const extracted = extractTextFromHTML(rawContent);
        title = extracted.title;
        content = extracted.content;
      }

      const webContent: WebContentResult = {
        url: url,
        title: title,
        content: content,
        size: content.length,
        timestamp: new Date().toISOString()
      };


      return { webContent };

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        const errorMsg = externalSignal?.aborted ? 'Fetch cancelled by user' : 'Request timed out';
        return { error: errorMsg };
      }
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { error: errorMsg };
    }
  }

  /**
   * Merge all fetched content
   */
  private static mergeContent(results: WebContentResult[]): string {
    if (results.length === 0) {
      return '';
    }

    const sections = results.map((result, index) => {
      const section = [
        `## Page ${index + 1}: ${result.title || 'Untitled'}`,
        `**URL:** ${result.url}`,
        `**Fetched at:** ${result.timestamp}`,
        `**Content size:** ${result.size} characters`,
        '',
        '**Content:**',
        result.content,
        ''
      ].join('\n');

      return section;
    });

    const mergedContent = [
      `# Web Content Fetch Results`,
      `**Total:** ${results.length} pages`,
      `**Fetch completed at:** ${new Date().toISOString()}`,
      '',
      '---',
      '',
      ...sections
    ].join('\n');

    return mergedContent;
  }


  /**
   * Validate arguments
   */
  private static validateArgs(args: FetchWebContentInternalArgs): { isValid: boolean; error?: string } {
    // Validate urls
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

    // Validate timeoutSeconds
    if (args.timeoutSeconds !== undefined) {
      if (typeof args.timeoutSeconds !== 'number' || args.timeoutSeconds < 5 || args.timeoutSeconds > 60) {
        return { isValid: false, error: 'timeoutSeconds must be a number between 5 and 60 seconds' };
      }
    }

    // Validate maxContentSize
    if (args.maxContentSize !== undefined) {
      if (!Number.isInteger(args.maxContentSize) || args.maxContentSize < 1024 || args.maxContentSize > 10485760) {
        return { isValid: false, error: 'maxContentSize must be an integer between 1024 and 10485760 bytes' };
      }
    }

    return { isValid: true };
  }
}
