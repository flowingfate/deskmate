/**
 * `app web image <query...>` —— Bing 图片搜索,Playwright headless 驱动。
 *
 * 形态与 `web search` 一致(query positional + --query repeatable + --lang/locale
 * + --max + --timeout + --json),额外:
 *   - `--safe-search Off|Moderate|Strict` 默认 Moderate
 *   - `--max` 上限 20(image API 比 web search 宽)
 *
 * 与 search 共享 95% 的 flag 处理,但**故意不复用一个 runner** —— 两者的
 * 业务字段、上限、kernel 入参形态都有差,共用一个 runner 会用 union 类型
 * 把分支搞复杂,清晰度收益小。
 */

import { BingImageSearchTool, type BingImageSearchToolResult } from './kernel/bingImageSearch';

import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

import { parseNumberFlag, resolveLangLocale, toStringArray } from './_shared';

const HELP = `USAGE
  web image <query> [<query>...] [options]
  web image --query <q> [--query <q>...] [options]

DESCRIPTION
  Search images on Bing (Playwright headless Chromium). Each query runs
  in parallel; up to 10 queries per call.

OPTIONS
  -q, --query <q>          Image query. Repeatable. Equivalent to positional.
  --lang <en|zh>           Search language. Default: en.
  --locale <us|cn>         Search locale. Default: us.
  --max <n>                Max results per query (1-20). Default: 5.
  --safe-search <level>    Off | Moderate | Strict. Default: Moderate.
  --timeout <ms>           Per-query timeout (1000-300000). Default: 60000.
  --json                   Output the raw result envelope as JSON.
  --help, -h               Show this help.

EXAMPLES
  web image "Studio Ghibli concept art"
  web image "cat icon" "dog icon" --max 10 --safe-search Strict
  web image "深圳夜景" --lang zh --locale cn --json
`;

const SAFE_SEARCH_LEVELS = new Set(['Off', 'Moderate', 'Strict']);
type SafeSearchLevel = 'Off' | 'Moderate' | 'Strict';

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'query', alias: 'q', type: 'array' },
  { name: 'lang', type: 'string' },
  { name: 'locale', type: 'string' },
  { name: 'max', type: 'string' },
  { name: 'safe-search', type: 'string' },
  { name: 'timeout', type: 'string' },
];

export async function runImage(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`web image: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  const queries = [...parsed.positional, ...toStringArray(parsed.flags.query)]
    .map((q) => q.trim())
    .filter((q) => q.length > 0);
  if (queries.length === 0) {
    ctx.printErr('web image: at least one query required (positional or --query).\n');
    ctx.setExitCode(2);
    return;
  }
  if (queries.length > 10) {
    ctx.printErr(`web image: too many queries (${queries.length}); max is 10.\n`);
    ctx.setExitCode(2);
    return;
  }

  const langLocale = resolveLangLocale(parsed.flags.lang, parsed.flags.locale);
  if (!langLocale.ok) {
    ctx.printErr(`web image: ${langLocale.error}\n`);
    ctx.setExitCode(2);
    return;
  }

  const maxRaw = parseNumberFlag(parsed.flags.max);
  if (Number.isNaN(maxRaw)) {
    ctx.printErr(`web image: --max must be a number (1-20).\n`);
    ctx.setExitCode(2);
    return;
  }
  if (maxRaw !== undefined && (!Number.isInteger(maxRaw) || maxRaw < 1 || maxRaw > 20)) {
    ctx.printErr(`web image: --max must be an integer between 1 and 20 (got ${maxRaw}).\n`);
    ctx.setExitCode(2);
    return;
  }

  const timeoutRaw = parseNumberFlag(parsed.flags.timeout);
  if (Number.isNaN(timeoutRaw)) {
    ctx.printErr(`web image: --timeout must be a number (ms, 1000-300000).\n`);
    ctx.setExitCode(2);
    return;
  }
  if (timeoutRaw !== undefined && (!Number.isInteger(timeoutRaw) || timeoutRaw < 1000 || timeoutRaw > 300000)) {
    ctx.printErr(`web image: --timeout must be an integer between 1000 and 300000 ms (got ${timeoutRaw}).\n`);
    ctx.setExitCode(2);
    return;
  }

  const safeSearchRaw = parsed.flags['safe-search'];
  let safeSearch: SafeSearchLevel | undefined;
  if (safeSearchRaw !== undefined) {
    if (typeof safeSearchRaw !== 'string' || !SAFE_SEARCH_LEVELS.has(safeSearchRaw)) {
      ctx.printErr(`web image: --safe-search must be Off, Moderate, or Strict (got "${String(safeSearchRaw)}").\n`);
      ctx.setExitCode(2);
      return;
    }
    safeSearch = safeSearchRaw as SafeSearchLevel;
  }

  const result: BingImageSearchToolResult = await BingImageSearchTool.execute(
    {
      queries,
      lang: langLocale.lang,
      locale: langLocale.locale,
      maxResults: maxRaw,
      safeSearch,
      timeout: timeoutRaw,
    },
    { signal: ctx.signal },
  );

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify(result, null, 2) + '\n');
    if (!result.success) ctx.setExitCode(1);
    return;
  }

  if (!result.success) {
    ctx.printErr(`web image search failed.\n`);
    if (result.errors && result.errors.length > 0) {
      for (const err of result.errors) ctx.printErr(`  - ${err}\n`);
    }
    ctx.setExitCode(1);
    return;
  }

  if (result.results.length === 0) {
    ctx.print(`No images for ${queries.length} query/queries.\n`);
    if (result.errors && result.errors.length > 0) {
      ctx.printErr('Partial errors:\n');
      for (const err of result.errors) ctx.printErr(`  - ${err}\n`);
    }
    return;
  }

  const lines: string[] = [`Found ${result.totalResults} image(s) across ${result.totalQueries} query/queries:`];
  for (const q of queries) {
    const subset = result.results.filter((r) => r.query === q);
    if (subset.length === 0) continue;
    lines.push('', `[${q}]`);
    for (const item of subset) {
      lines.push(`  ${item.index}. ${item.title || '(untitled)'}`);
      lines.push(`     thumbnail: ${item.thumbnailUrl}`);
      lines.push(`     source:    ${item.sourcePageUrl}`);
      if (item.width && item.height) lines.push(`     size:      ${item.width}x${item.height}`);
    }
  }
  if (result.errors && result.errors.length > 0) {
    lines.push('', 'Partial errors:');
    for (const err of result.errors) lines.push(`  - ${err}`);
  }
  ctx.print(lines.join('\n') + '\n');
}
