/**
 * `app web search <query...>` —— Bing 网页搜索,Playwright headless 驱动。
 *
 * 形态:
 *   - `<query>` positional **可以多次**(每个独立 query 并行跑一次浏览器)
 *   - `--query <q>` / `-q <q>` repeatable —— 等价于 positional,LLM 选哪种顺手
 *     都行(与 `curl -d` repeatable form 同范式)
 *   - `--lang en|zh`(默认 `en`)/ `--locale us|cn`(默认 `us`)
 *   - `--max <n>` 每 query 返回数,1-10,默认 5
 *   - `--timeout <ms>` 单 query 上限,默认 60000(60s)
 *   - `--json` 透传 `BingWebSearchToolResult`,便于链式接 `app web fetch`
 *
 * 不支持 `--dry-run`(纯只读 + 副作用受控,演练无意义)。
 *
 * Bing 母语指引:中文 query 用 `--lang zh --locale cn`,其它 `--lang en --locale us`。
 * 由 LLM 在 cmdline 里显式声明 —— Schema 时代是 enum required,这里同样必填,
 * 但通过 `_shared.resolveLangLocale` 校验,缺省走 `en/us`。
 */

import { BingWebSearchTool, type BingWebSearchToolResult } from './kernel/bingWebSearch';

import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

import { parseNumberFlag, resolveLangLocale, toStringArray } from './_shared';

const HELP = `USAGE
  web search <query> [<query>...] [options]
  web search --query <q> [--query <q>...] [options]

DESCRIPTION
  Search the web using Bing (Playwright headless Chromium). Each query
  runs in parallel; up to 10 queries per call. Results merged into one
  envelope.

OPTIONS
  -q, --query <q>     Search query. Repeatable. Equivalent to positional.
  --lang <en|zh>      Search language. Default: en. Use "zh" for Chinese queries.
  --locale <us|cn>    Search locale. Default: us. Use "cn" for Chinese queries.
  --max <n>           Max results per query (1-10). Default: 5.
  --timeout <ms>      Per-query timeout in milliseconds (1000-300000). Default: 60000.
  --json              Output the raw result envelope as JSON.
  --help, -h          Show this help.

EXAMPLES
  web search "GitHub Copilot pricing"
  web search "react hooks" "vue composition api" --max 3
  web search "深圳 天气" --lang zh --locale cn --json
  web search -q "claude api" -q "openai api" --max 5
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'query', alias: 'q', type: 'array' },
  { name: 'lang', type: 'string' },
  { name: 'locale', type: 'string' },
  { name: 'max', type: 'string' },
  { name: 'timeout', type: 'string' },
];

export async function runSearch(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`web search: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  // 收 query:positional + --query repeatable,两者合并去重
  const queries = [...parsed.positional, ...toStringArray(parsed.flags.query)]
    .map((q) => q.trim())
    .filter((q) => q.length > 0);
  if (queries.length === 0) {
    ctx.printErr('web search: at least one query required (positional or --query).\n');
    ctx.setExitCode(2);
    return;
  }
  if (queries.length > 10) {
    ctx.printErr(`web search: too many queries (${queries.length}); max is 10.\n`);
    ctx.setExitCode(2);
    return;
  }

  const langLocale = resolveLangLocale(parsed.flags.lang, parsed.flags.locale);
  if (!langLocale.ok) {
    ctx.printErr(`web search: ${langLocale.error}\n`);
    ctx.setExitCode(2);
    return;
  }

  const maxRaw = parseNumberFlag(parsed.flags.max);
  if (Number.isNaN(maxRaw)) {
    ctx.printErr(`web search: --max must be a number (1-10).\n`);
    ctx.setExitCode(2);
    return;
  }
  if (maxRaw !== undefined && (!Number.isInteger(maxRaw) || maxRaw < 1 || maxRaw > 10)) {
    ctx.printErr(`web search: --max must be an integer between 1 and 10 (got ${maxRaw}).\n`);
    ctx.setExitCode(2);
    return;
  }

  const timeoutRaw = parseNumberFlag(parsed.flags.timeout);
  if (Number.isNaN(timeoutRaw)) {
    ctx.printErr(`web search: --timeout must be a number (ms, 1000-300000).\n`);
    ctx.setExitCode(2);
    return;
  }
  if (timeoutRaw !== undefined && (!Number.isInteger(timeoutRaw) || timeoutRaw < 1000 || timeoutRaw > 300000)) {
    ctx.printErr(`web search: --timeout must be an integer between 1000 and 300000 ms (got ${timeoutRaw}).\n`);
    ctx.setExitCode(2);
    return;
  }

  const result: BingWebSearchToolResult = await BingWebSearchTool.execute(
    {
      queries,
      lang: langLocale.lang,
      locale: langLocale.locale,
      maxResults: maxRaw,
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
    ctx.printErr(`web search failed.\n`);
    if (result.errors && result.errors.length > 0) {
      for (const err of result.errors) ctx.printErr(`  - ${err}\n`);
    }
    ctx.setExitCode(1);
    return;
  }

  // human mode:按 query 分组打印
  if (result.results.length === 0) {
    ctx.print(`No results for ${queries.length} query/queries.\n`);
    if (result.errors && result.errors.length > 0) {
      ctx.printErr('Partial errors:\n');
      for (const err of result.errors) ctx.printErr(`  - ${err}\n`);
    }
    return;
  }

  const lines: string[] = [`Found ${result.totalResults} result(s) across ${result.totalQueries} query/queries:`];
  // 按 query 字段分组,保持原始 query 顺序
  for (const q of queries) {
    const subset = result.results.filter((r) => r.query === q);
    if (subset.length === 0) continue;
    lines.push('', `[${q}]`);
    for (const item of subset) {
      lines.push(`  ${item.index}. ${item.title}`);
      lines.push(`     ${item.url}`);
      if (item.caption) lines.push(`     ${truncate(item.caption, 120)}`);
    }
  }
  if (result.errors && result.errors.length > 0) {
    lines.push('', 'Partial errors:');
    for (const err of result.errors) lines.push(`  - ${err}`);
  }
  ctx.print(lines.join('\n') + '\n');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}
