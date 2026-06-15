/**
 * `app web read-html <file>` 内核 —— agent-safe HTML reader,绝不返回整页原始 HTML。
 *
 * 设计目标:
 * - 永远不返回 full page HTML —— 避免 minified / inline script 把 context
 *   窗口炸掉。
 * - structure first(先 DOM 大纲)→ targeted reading(按 section / selector
 *   取内容)。
 * - 三种模式:
 *   1. `outline`(默认):返回 DOM 骨架(tag/id/class + 50 字 preview),让
 *      LLM 先看清结构再决定读哪一块。
 *   2. `section`:按语义块(main / article / body / head)抽纯文本。
 *   3. `selector`:CSS selector 精读(#id / .class / tag,**不**完整支持
 *      CSS,只覆盖最小子集,正则匹配)。
 *
 * 安全阈值见 `HTML_READ_LIMITS`:probe 64KB、最多 200 DOM 节点、文本
 * 总 96KB、单 text node 4KB。
 *
 * 历史:由 `pi/tools/readHtml.ts` 的 `readHtmlInternal` 平移而来,只去掉
 * 原文件尾部的 `LocalTool` spec(`app web read-html` AppCommand 取代之)。
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

// ============ Safety thresholds ============
export const HTML_READ_LIMITS = {
  PROBE_BYTES: 64 * 1024,           // 64KB for DOM probing (slightly larger than original design, covers more structure)
  MAX_TEXT_BYTES: 96 * 1024,        // 96KB max text output
  MAX_NODES: 200,                   // Maximum number of DOM nodes to return
  MAX_TEXT_NODE: 4 * 1024,          // 4KB single text node limit
  MAX_SELECTOR_DEPTH: 3,            // Maximum selector nesting depth
} as const;

// ============ Type definitions ============
export type HtmlReadMode = 'outline' | 'section' | 'selector';
export type HtmlSection = 'main' | 'article' | 'body' | 'head';
export type TruncationReason = 'max_nodes' | 'max_bytes' | 'text_node_limit' | 'none';

export interface ReadHtmlInternalArgs {
  filePath: string;

  // Mode selection (default: outline)
  mode?: HtmlReadMode;

  // section mode parameter
  section?: HtmlSection;

  // selector mode parameter (supports a minimal CSS subset)
  selector?: string; // e.g. "#main", ".content", "article"
}

export interface HtmlOutlineNode {
  tag: string;
  id?: string;
  className?: string;
  depth: number;
  textPreview?: string; // First 50-character preview
}

export interface ReadHtmlInternalResult {
  fileName: string;
  filePath: string;
  mode: HtmlReadMode;

  // outline mode result
  outline?: HtmlOutlineNode[];

  // section / selector mode result
  content?: string;

  // Metadata
  truncated: boolean;
  truncationReason?: TruncationReason;
  bytesRead: number;

  // Assist agent decision-making
  hasScript: boolean;
  hasStyle: boolean;
  suggestedSelectors?: string[]; // Recommended selectors
}

/**
 * 工具本体:probe 文件前 N KB → dispatch outline / section / selector。
 *
 * `options.signal` 未使用:三种模式都是同步字符串处理,只在 probe 阶段
 * 有一次 fs 调用,abort 没意义。保留 opts 形态对齐 AppCommand 契约,
 * 也为未来若改为流式读时留出钩子。
 */
export async function readHtmlInternal(
  args: ReadHtmlInternalArgs,
  _options?: { signal?: AbortSignal },
): Promise<ReadHtmlInternalResult> {
  const { filePath, mode = 'outline' } = args;

  if (!filePath) {
    throw new Error('filePath is required');
  }

  // Validate file exists
  try {
    await fsPromises.access(filePath, fs.constants.R_OK);
  } catch {
    throw new Error(`File not accessible: ${filePath}`);
  }

  // Phase 1: Probe read (read only the first N KB)
  const { html, bytesRead } = await probeHtml(filePath);

  // Detect features
  const hasScript = /<script[\s\S]*?>/i.test(html);
  const hasStyle = /<style[\s\S]*?>/i.test(html);

  const fileName = path.basename(filePath);

  // Execute based on mode
  switch (mode) {
    case 'outline':
      return buildOutline(filePath, fileName, html, bytesRead, hasScript, hasStyle);

    case 'section':
      return readSection(filePath, fileName, html, bytesRead, hasScript, hasStyle, args.section || 'body');

    case 'selector':
      if (!args.selector) {
        throw new Error('selector is required in selector mode');
      }
      return readBySelector(filePath, fileName, html, bytesRead, hasScript, hasStyle, args.selector);

    default:
      throw new Error(`Unsupported mode: ${mode}`);
  }
}

// ============ Phase 1: Probe Read ============

/**
 * Read only the first N KB of the file to avoid full load
 */
async function probeHtml(filePath: string): Promise<{ html: string; bytesRead: number }> {
  const fd = await fsPromises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(HTML_READ_LIMITS.PROBE_BYTES);
    const { bytesRead } = await fd.read(buffer, 0, HTML_READ_LIMITS.PROBE_BYTES, 0);
    const html = buffer.subarray(0, bytesRead).toString('utf8');
    return { html, bytesRead };
  } finally {
    await fd.close();
  }
}

// HTML5 void / self-closing tags — static set, kept at module scope so the
// outline scanner doesn't reallocate per call.
const VOID_TAGS: Record<string, true> = {
  area: true, base: true, br: true, col: true, embed: true, hr: true,
  img: true, input: true, link: true, meta: true, param: true,
  source: true, track: true, wbr: true,
};

// ============ Outline Mode ============

/**
 * Build the DOM skeleton (no content, only structure)
 */
function buildOutline(
  filePath: string,
  fileName: string,
  html: string,
  bytesRead: number,
  hasScript: boolean,
  hasStyle: boolean,
): ReadHtmlInternalResult {
  const outline: HtmlOutlineNode[] = [];
  const depthStack: string[] = [];

  // Match all tags
  const tagRegex = /<\s*(\/)?\s*([a-zA-Z0-9]+)([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    if (outline.length >= HTML_READ_LIMITS.MAX_NODES) break;

    const isClose = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    const attrs = match[3] || '';

    // Skip script and style content
    if (tag === 'script' || tag === 'style') {
      if (!isClose) {
        // Skip to the matching closing tag
        const closeRegex = new RegExp(`<\\s*/\\s*${tag}\\s*>`, 'gi');
        closeRegex.lastIndex = tagRegex.lastIndex;
        const closeMatch = closeRegex.exec(html);
        if (closeMatch) {
          tagRegex.lastIndex = closeMatch.index + closeMatch[0].length;
        }
      }
      continue;
    }

    if (isClose) {
      // Closing tag, decrease depth
      const lastOpenTag = depthStack.pop();
      // Error tolerance: if tags don't match, attempt recovery
      if (lastOpenTag && lastOpenTag !== tag) {
        depthStack.push(lastOpenTag); // Put it back
      }
    } else {
      // Opening tag
      const depth = depthStack.length;

      // Parse attributes
      const idMatch = attrs.match(/id\s*=\s*["']([^"']+)["']/i);
      const classMatch = attrs.match(/class\s*=\s*["']([^"']+)["']/i);

      // Get text preview (first 50 chars after the tag)
      const afterTag = html.slice(tagRegex.lastIndex, tagRegex.lastIndex + 100);
      const textPreview = extractTextPreview(afterTag);

      outline.push({
        tag,
        id: idMatch?.[1],
        className: classMatch?.[1],
        depth,
        textPreview: textPreview || undefined,
      });

      // Only push non-self-closing tags onto the stack
      if (!VOID_TAGS[tag] && !attrs.includes('/>')) {
        depthStack.push(tag);
      }
    }
  }

  // Generate recommended selectors
  const suggestedSelectors = generateSuggestedSelectors(outline);

  return {
    fileName,
    filePath,
    mode: 'outline',
    outline,
    truncated: outline.length >= HTML_READ_LIMITS.MAX_NODES,
    truncationReason: outline.length >= HTML_READ_LIMITS.MAX_NODES ? 'max_nodes' : undefined,
    bytesRead,
    hasScript,
    hasStyle,
    suggestedSelectors,
  };
}

/**
 * Extract text preview (first 50 characters)
 */
function extractTextPreview(html: string): string {
  // Remove tags, keep only text
  const text = html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > 50) {
    return text.slice(0, 50) + '...';
  }
  return text;
}

/**
 * Generate recommended selectors based on the outline
 */
function generateSuggestedSelectors(outline: HtmlOutlineNode[]): string[] {
  const selectors: string[] = [];
  const seen = new Set<string>();

  // Priority: meaningful semantic tags > has id > has common class
  const semanticTags = ['main', 'article', 'nav', 'header', 'footer', 'aside', 'section'];
  const meaningfulClasses = ['content', 'main', 'article', 'post', 'entry', 'body', 'text', 'container'];

  for (const node of outline) {
    // Semantic tags
    if (semanticTags.includes(node.tag) && !seen.has(node.tag)) {
      selectors.push(node.tag);
      seen.add(node.tag);
    }

    // Elements with id
    if (node.id && !seen.has(`#${node.id}`)) {
      selectors.push(`#${node.id}`);
      seen.add(`#${node.id}`);
    }

    // Meaningful classes
    if (node.className) {
      const classes = node.className.split(/\s+/);
      for (const cls of classes) {
        if (meaningfulClasses.some((m) => cls.toLowerCase().includes(m))) {
          const selector = `.${cls}`;
          if (!seen.has(selector)) {
            selectors.push(selector);
            seen.add(selector);
          }
        }
      }
    }

    if (selectors.length >= 10) break;
  }

  return selectors;
}

// ============ Section Mode ============

/**
 * Read by semantic block
 */
function readSection(
  filePath: string,
  fileName: string,
  html: string,
  bytesRead: number,
  hasScript: boolean,
  hasStyle: boolean,
  section: HtmlSection,
): ReadHtmlInternalResult {
  // Match the section tag and its content
  const regex = new RegExp(`<${section}[^>]*>([\\s\\S]*?)<\\/${section}>`, 'i');
  const match = html.match(regex);

  if (!match) {
    return {
      fileName,
      filePath,
      mode: 'section',
      content: `[No <${section}> element found in the HTML]`,
      truncated: false,
      bytesRead,
      hasScript,
      hasStyle,
    };
  }

  const { content, truncated, truncationReason } = extractAndCleanText(match[1]);

  return {
    fileName,
    filePath,
    mode: 'section',
    content,
    truncated,
    truncationReason,
    bytesRead,
    hasScript,
    hasStyle,
  };
}

// ============ Selector Mode ============

/**
 * Read by CSS selector (supports a minimal subset)
 */
function readBySelector(
  filePath: string,
  fileName: string,
  html: string,
  bytesRead: number,
  hasScript: boolean,
  hasStyle: boolean,
  selector: string,
): ReadHtmlInternalResult {
  let regex: RegExp;

  // Parse selector type
  if (selector.startsWith('#')) {
    // ID selector: #main
    const id = escapeRegex(selector.slice(1));
    regex = new RegExp(`<([a-zA-Z0-9]+)[^>]*id\\s*=\\s*["']${id}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
  } else if (selector.startsWith('.')) {
    // Class selector: .content
    const cls = escapeRegex(selector.slice(1));
    regex = new RegExp(`<([a-zA-Z0-9]+)[^>]*class\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
  } else {
    // Tag selector: article
    const tag = escapeRegex(selector);
    regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  }

  const match = html.match(regex);

  if (!match) {
    return {
      fileName,
      filePath,
      mode: 'selector',
      content: `[No element matching '${selector}' found in the HTML]`,
      truncated: false,
      bytesRead,
      hasScript,
      hasStyle,
    };
  }

  // match[1] is the tag name (for ID/Class selectors), match[2] is the content
  const contentMatch = selector.startsWith('#') || selector.startsWith('.') ? match[2] : match[1];
  const { content, truncated, truncationReason } = extractAndCleanText(contentMatch || '');

  return {
    fileName,
    filePath,
    mode: 'selector',
    content,
    truncated,
    truncationReason,
    bytesRead,
    hasScript,
    hasStyle,
  };
}

// ============ Utility methods ============

/**
 * Extract and clean text (remove script/style, enforce size limits)
 */
function extractAndCleanText(htmlFragment: string): {
  content: string;
  truncated: boolean;
  truncationReason?: TruncationReason;
} {
  // Remove script and style
  let text = htmlFragment
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')  // Replace tags with spaces
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')    // Remove numeric entities
    .replace(/\s+/g, ' ')      // Merge whitespace
    .trim();

  let truncated = false;
  let truncationReason: TruncationReason | undefined;

  // Check single-node limit
  if (text.length > HTML_READ_LIMITS.MAX_TEXT_NODE) {
    text = text.slice(0, HTML_READ_LIMITS.MAX_TEXT_NODE) + '\n[... text truncated ...]';
    truncated = true;
    truncationReason = 'text_node_limit';
  }

  // Check total byte limit
  const byteSize = Buffer.byteLength(text, 'utf8');
  if (byteSize > HTML_READ_LIMITS.MAX_TEXT_BYTES) {
    // Truncate proportionally
    const ratio = HTML_READ_LIMITS.MAX_TEXT_BYTES / byteSize;
    text = text.slice(0, Math.floor(text.length * ratio)) + '\n[... content truncated due to size limit ...]';
    truncated = true;
    truncationReason = 'max_bytes';
  }

  return { content: text, truncated, truncationReason };
}

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
