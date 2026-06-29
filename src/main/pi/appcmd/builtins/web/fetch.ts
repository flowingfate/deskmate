/**
 * `app web fetch <url...>` —— 并行抓取多个 URL 的纯文本内容。
 *
 * 形态:
 *   - `<url>` positional **可以多次**(每个 URL 独立 timeout)
 *   - `--url <u>` repeatable —— 等价于 positional
 *   - `--timeout <sec>` 单 URL 上限,**秒**单位(与 kernel 一致),默认 30
 *   - `--max-size <bytes>` 单 URL content size 上限,默认 1MB,最大 10MB
 *   - `--json` 透传 `FetchWebContentInternalResult`(含 mergedContent + 各 page 结果)
 *
 * 不支持 `--dry-run`(只读)。
 *
 * HTML 自动抽取 main / article / .content 等主内容区,过滤 nav/header/footer/
 * script/style;Markdown / JSON / YAML / XML / plain text 原样透传或最小格式化。
 * 单 URL 失败不影响整批 —— 失败 URL 进 `results` 数组,带 `error` 字段。
 */

import { FetchWebContentTool, type FetchWebContentInternalResult } from './kernel/fetchWebContent';

import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCommand, AppCmdContext } from '../../types';

import { parseNumberFlag, toStringArray } from './_shared';

const HELP = `USAGE
  web fetch <url> [<url>...] [options]
  web fetch --url <u> [--url <u>...] [options]

DESCRIPTION
  Fetch content from multiple URLs in parallel (max 20). HTML is rendered in a
  headless browser (JS executed) and extracted to clean Markdown via Readability
  + turndown; Markdown / JSON / YAML / XML / plain text pass through with minimal
  formatting. Use --raw for the legacy plain-text HTML path (no rendering).

OPTIONS
  --url <u>            URL to fetch. Repeatable. Equivalent to positional.
  --timeout <sec>      Per-URL timeout in seconds (5-60). Default: 30.
  --max-size <bytes>   Per-URL content size cap, 1024-10485760. Default: 1048576 (1MB).
  --raw                Skip headless render for HTML; legacy plain-text extraction.
  --json               Output the raw result envelope as JSON.
  --help, -h           Show this help.

EXAMPLES
  web fetch https://example.com/article
  web fetch https://a.com https://b.com --max-size 524288
  web fetch --url https://api.example.com/data.json --json
  web fetch https://raw.githubusercontent.com/foo/bar/main/README.md --timeout 45
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'url', type: 'array' },
  { name: 'timeout', type: 'string' },
  { name: 'max-size', type: 'string' },
  { name: 'raw', type: 'boolean' },
];

export async function runFetch(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`web fetch: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  const urls = [...parsed.positional, ...toStringArray(parsed.flags.url)]
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  if (urls.length === 0) {
    ctx.printErr('web fetch: at least one URL required (positional or --url).\n');
    ctx.setExitCode(2);
    return;
  }
  if (urls.length > 20) {
    ctx.printErr(`web fetch: too many URLs (${urls.length}); max is 20.\n`);
    ctx.setExitCode(2);
    return;
  }

  const timeoutRaw = parseNumberFlag(parsed.flags.timeout);
  if (Number.isNaN(timeoutRaw)) {
    ctx.printErr(`web fetch: --timeout must be a number (sec, 5-60).\n`);
    ctx.setExitCode(2);
    return;
  }
  if (timeoutRaw !== undefined && (!Number.isInteger(timeoutRaw) || timeoutRaw < 5 || timeoutRaw > 60)) {
    ctx.printErr(`web fetch: --timeout must be an integer between 5 and 60 seconds (got ${timeoutRaw}).\n`);
    ctx.setExitCode(2);
    return;
  }

  const sizeRaw = parseNumberFlag(parsed.flags['max-size']);
  if (Number.isNaN(sizeRaw)) {
    ctx.printErr(`web fetch: --max-size must be a number (bytes, 1024-10485760).\n`);
    ctx.setExitCode(2);
    return;
  }
  if (sizeRaw !== undefined && (!Number.isInteger(sizeRaw) || sizeRaw < 1024 || sizeRaw > 10485760)) {
    ctx.printErr(`web fetch: --max-size must be an integer between 1024 and 10485760 bytes (got ${sizeRaw}).\n`);
    ctx.setExitCode(2);
    return;
  }

  let result: FetchWebContentInternalResult;
  try {
    result = await FetchWebContentTool.execute(
      {
        urls,
        timeoutSeconds: timeoutRaw,
        maxContentSize: sizeRaw,
        raw: parsed.flags.raw === true,
      },
      { signal: ctx.signal },
    );
  } catch (err) {
    // kernel 在 args validation 失败 + 全局 fetch 失败时会抛 —— 业务 fail-1
    const msg = err instanceof Error ? err.message : String(err);
    if (isJson(parsed.flags)) {
      ctx.print(JSON.stringify({ success: false, error: msg }, null, 2) + '\n');
    } else {
      ctx.printErr(`web fetch: ${msg}\n`);
    }
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify(result, null, 2) + '\n');
    if (!result.success) ctx.setExitCode(1);
    return;
  }

  if (!result.success) {
    ctx.printErr(`web fetch failed.\n`);
    if (result.errors && result.errors.length > 0) {
      for (const e of result.errors) ctx.printErr(`  - ${e}\n`);
    }
    ctx.setExitCode(1);
    return;
  }

  const lines: string[] = [
    `Fetched ${result.successfulUrls}/${result.totalUrls} URL(s):`,
    '',
  ];
  for (const r of result.results) {
    if (r.error) {
      lines.push(`  ✗ ${r.url}`);
      lines.push(`    error: ${r.error}`);
    } else {
      lines.push(`  ✓ ${r.url}`);
      if (r.title) lines.push(`    title: ${r.title}`);
      lines.push(`    size:  ${r.size} chars`);
    }
  }
  // 把 mergedContent 拼上 —— 这是 LLM 真正要消化的部分(human mode 也是)
  if (result.mergedContent) {
    lines.push('', '──── content ────', result.mergedContent);
  }
  ctx.print(lines.join('\n') + '\n');
}

export const fetchCommand: AppCommand = {
  name: 'fetch',
  synopsis: 'Fetch page content from URL',
  help: HELP,
  run: runFetch,
};
