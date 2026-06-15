/**
 * `app web read-html <file> [--mode outline|section|selector] ...` ——
 * agent-safe HTML reader,绝不返回整页原始 HTML。
 *
 * 三种模式(默认 outline):
 *   - `outline`:返回 DOM 骨架(tag/id/class + 50 字 preview),让 LLM
 *     先看清结构。kernel 默认值,无需 `--mode` 也走这里。
 *   - `section`:按语义块抽纯文本,`--section main|article|body|head`(默认 body)。
 *   - `selector`:按 CSS selector 抽内容,`--selector "#id" | ".class" | "tag"`,
 *     必须显式给 `--selector`,缺即 `(exit 2)`。
 *
 * 形态:
 *   - `<file>` positional,**必填**(一次只读一个 HTML 文件)。
 *   - `--mode`/`--section`/`--selector` 互斥语义由 kernel 保证 ——
 *     `--mode selector` 但没给 `--selector` 时 kernel 抛 throw,这里
 *     在调 kernel 前先 lint 一遍给出更友好的提示。
 *   - `--json` 透传 `ReadHtmlInternalResult`(含 outline 数组或 content 字段)。
 *
 * 不支持 `--dry-run`(只读)。
 *
 * 安全阈值 `HTML_READ_LIMITS`:probe 64KB、最多 200 DOM 节点、文本 96KB,
 * 单 text node 4KB。命中阈值时 `truncated: true` + `truncationReason` 字段。
 */

import {
  readHtmlInternal,
  type HtmlReadMode,
  type HtmlSection,
  type ReadHtmlInternalResult,
} from './kernel/readHtml';

import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

const HELP = `USAGE
  web read-html <file> [--mode <m>] [--section <s>] [--selector <css>] [--json]

DESCRIPTION
  Safely read an HTML file with structure-first approach. Never returns
  full raw HTML — modes provide bounded views.

MODES
  outline (default)  DOM skeleton (tag/id/class + 50-char text preview).
                     Recommended first call to plan further reads.
  section            Extract clean text from a semantic block.
                     Provide --section main|article|body|head (default: body).
  selector           Extract clean text matching a CSS selector.
                     Provide --selector "#id" or ".class" or "tag" (required).

OPTIONS
  --mode <m>         outline | section | selector. Default: outline.
  --section <s>      For --mode section: main | article | body | head. Default: body.
  --selector <css>   For --mode selector: e.g. "#main", ".content", "article".
  --json             Output the raw result as JSON (outline arrays / content text).
  --help, -h         Show this help.

EXAMPLES
  web read-html /tmp/page.html
  web read-html /tmp/page.html --mode section --section main
  web read-html /tmp/page.html --mode selector --selector "#content" --json
`;

const MODES = new Set<HtmlReadMode>(['outline', 'section', 'selector']);
const SECTIONS = new Set<HtmlSection>(['main', 'article', 'body', 'head']);

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'mode', type: 'string' },
  { name: 'section', type: 'string' },
  { name: 'selector', type: 'string' },
];

export async function runReadHtml(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`web read-html: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }
  if (parsed.positional.length === 0) {
    ctx.printErr('web read-html: <file> argument required.\n');
    ctx.setExitCode(2);
    return;
  }
  if (parsed.positional.length > 1) {
    ctx.printErr(`web read-html: too many positional args (${parsed.positional.length}); only one file at a time.\n`);
    ctx.setExitCode(2);
    return;
  }
  const filePath = parsed.positional[0];

  const modeRaw = parsed.flags.mode;
  let mode: HtmlReadMode = 'outline';
  if (modeRaw !== undefined) {
    if (typeof modeRaw !== 'string' || !MODES.has(modeRaw as HtmlReadMode)) {
      ctx.printErr(`web read-html: --mode must be outline, section, or selector (got "${String(modeRaw)}").\n`);
      ctx.setExitCode(2);
      return;
    }
    mode = modeRaw as HtmlReadMode;
  }

  let section: HtmlSection | undefined;
  const sectionRaw = parsed.flags.section;
  if (sectionRaw !== undefined) {
    if (typeof sectionRaw !== 'string' || !SECTIONS.has(sectionRaw as HtmlSection)) {
      ctx.printErr(`web read-html: --section must be main, article, body, or head (got "${String(sectionRaw)}").\n`);
      ctx.setExitCode(2);
      return;
    }
    section = sectionRaw as HtmlSection;
  }

  let selector: string | undefined;
  const selectorRaw = parsed.flags.selector;
  if (selectorRaw !== undefined) {
    if (typeof selectorRaw !== 'string' || selectorRaw.trim() === '') {
      ctx.printErr('web read-html: --selector must be a non-empty CSS selector string.\n');
      ctx.setExitCode(2);
      return;
    }
    selector = selectorRaw.trim();
  }

  if (mode === 'selector' && selector === undefined) {
    ctx.printErr('web read-html: --selector required when --mode selector.\n');
    ctx.setExitCode(2);
    return;
  }

  let result: ReadHtmlInternalResult;
  try {
    result = await readHtmlInternal({ filePath, mode, section, selector }, { signal: ctx.signal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isJson(parsed.flags)) {
      ctx.print(JSON.stringify({ success: false, error: msg }, null, 2) + '\n');
    } else {
      ctx.printErr(`web read-html: ${msg}\n`);
    }
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  // human mode
  const header: string[] = [
    `${result.fileName} (mode=${result.mode}, bytesRead=${result.bytesRead}${result.truncated ? `, truncated=${result.truncationReason}` : ''})`,
  ];
  if (result.hasScript) header.push('  ⚠ contains <script>');
  if (result.hasStyle) header.push('  ⚠ contains <style>');

  if (result.mode === 'outline' && result.outline) {
    const lines = [...header, '', 'Outline:'];
    for (const node of result.outline) {
      const indent = '  '.repeat(node.depth + 1);
      const attrs: string[] = [];
      if (node.id) attrs.push(`#${node.id}`);
      if (node.className) attrs.push(`.${node.className.split(/\s+/).join('.')}`);
      const preview = node.textPreview ? `  "${node.textPreview}"` : '';
      lines.push(`${indent}<${node.tag}${attrs.length > 0 ? ' ' + attrs.join('') : ''}>${preview}`);
    }
    if (result.suggestedSelectors && result.suggestedSelectors.length > 0) {
      lines.push('', 'Suggested selectors:');
      for (const s of result.suggestedSelectors) lines.push(`  - ${s}`);
    }
    ctx.print(lines.join('\n') + '\n');
    return;
  }

  // section / selector
  const lines = [...header, ''];
  if (result.content !== undefined) {
    lines.push(result.content);
  } else {
    lines.push('(no content extracted)');
  }
  ctx.print(lines.join('\n') + '\n');
}
