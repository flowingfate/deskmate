/**
 * `app web search <query...>` —— Tavily Search REST API 网页搜索。
 *
 * 历史:替换原 Bing + Playwright headless 爬虫方案(长期撞风控 / 0 结果),
 * 改走 Tavily 官方 Search API。需要 Tavily API key:优先读 profile
 * `settings.json` 的 `webSearch.tavilyApiKey`,缺省回退环境变量
 * `TAVILY_API_KEY`;两者都空则 fail-fast(exit 1)引导配置。
 *
 * 形态:
 *   - `<query>` positional **可以多次**(每个 query 并行跑一次 Tavily 请求)
 *   - `--query <q>` / `-q <q>` repeatable —— 等价于 positional(与 `curl -d`
 *     repeatable form 同范式)
 *   - `--topic <general|news|finance>`(默认 general)—— Tavily 搜索类别
 *   - `--depth <basic|advanced>`(默认 basic)—— basic=1 credit / advanced=2
 *     credits,相关性更高
 *   - `--max <n>` 每 query 返回数,1-20,默认 5
 *   - `--timeout <ms>` 单 query 上限,默认 60000(60s)
 *   - `--json` 透传结果 envelope,便于链式接 `app web fetch`
 *
 * 不支持 `--dry-run`(纯只读 + 副作用受控,演练无意义)。
 */


import {
  TavilySearchTool,
  type TavilyWebSearchToolResult,
  type TavilySearchTopic,
  type TavilySearchDepth,
} from './kernel/tavilySearch';

import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCommand, AppCmdContext } from '../../types';

import { parseNumberFlag, toStringArray } from './_shared';

const HELP = `USAGE
  web search <query> [<query>...] [options]
  web search --query <q> [--query <q>...] [options]

DESCRIPTION
  Search the web using the Tavily Search API. Each query runs in parallel;
  up to 10 queries per call. Results are merged into one envelope.

  Requires a Tavily API key. Set it in Settings (webSearch.tavilyApiKey) or
  via the TAVILY_API_KEY environment variable.

OPTIONS
  -q, --query <q>          Search query. Repeatable. Equivalent to positional.
  --topic <general|news|finance>
                           Search category. Default: general. Use "news" for
                           real-time current events.
  --depth <basic|advanced> Search depth. Default: basic (1 credit). "advanced"
                           (2 credits) returns higher-relevance content.
  --max <n>                Max results per query (1-20). Default: 5.
  --timeout <ms>           Per-query timeout in milliseconds (1000-300000). Default: 60000.
  --json                   Output the raw result envelope as JSON.
  --help, -h               Show this help.

EXAMPLES
  web search "GitHub Copilot pricing"
  web search "react hooks" "vue composition api" --max 3
  web search "深圳 天气" --topic news --json
  web search -q "claude api" -q "openai api" --max 5 --depth advanced
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'query', alias: 'q', type: 'array' },
  { name: 'topic', type: 'string' },
  { name: 'depth', type: 'string' },
  { name: 'max', type: 'string' },
  { name: 'timeout', type: 'string' },
];

const VALID_TOPICS: readonly TavilySearchTopic[] = ['general', 'news', 'finance'];
const VALID_DEPTHS: readonly TavilySearchDepth[] = ['basic', 'advanced'];

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

  // 收 query:positional + --query repeatable,两者合并
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

  // topic 校验,缺省 general
  const topicRaw = typeof parsed.flags.topic === 'string' ? parsed.flags.topic.trim().toLowerCase() : 'general';
  if (!VALID_TOPICS.includes(topicRaw as TavilySearchTopic)) {
    ctx.printErr(`web search: --topic must be one of ${VALID_TOPICS.join(' | ')} (got "${topicRaw}").\n`);
    ctx.setExitCode(2);
    return;
  }
  const topic = topicRaw as TavilySearchTopic;

  // depth 校验,缺省 basic
  const depthRaw = typeof parsed.flags.depth === 'string' ? parsed.flags.depth.trim().toLowerCase() : 'basic';
  if (!VALID_DEPTHS.includes(depthRaw as TavilySearchDepth)) {
    ctx.printErr(`web search: --depth must be one of ${VALID_DEPTHS.join(' | ')} (got "${depthRaw}").\n`);
    ctx.setExitCode(2);
    return;
  }
  const searchDepth = depthRaw as TavilySearchDepth;

  const maxRaw = parseNumberFlag(parsed.flags.max);
  if (Number.isNaN(maxRaw)) {
    ctx.printErr(`web search: --max must be a number (1-20).\n`);
    ctx.setExitCode(2);
    return;
  }
  if (maxRaw !== undefined && (!Number.isInteger(maxRaw) || maxRaw < 1 || maxRaw > 20)) {
    ctx.printErr(`web search: --max must be an integer between 1 and 20 (got ${maxRaw}).\n`);
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

  // API key:owning Profile settings 优先,环境变量兜底。两者都空 → fail-fast。
  let apiKey: string | undefined;
  const key = ctx.profile.store.settings.webSearch?.tavilyApiKey;
  if (typeof key === 'string' && key.trim() !== '') apiKey = key.trim();
  if (apiKey === undefined) {
    const env = process.env.TAVILY_API_KEY;
    if (typeof env === 'string' && env.trim() !== '') apiKey = env.trim();
  }
  if (apiKey === undefined) {
    ctx.printErr(
      'web search: no Tavily API key configured. Set webSearch.tavilyApiKey in Settings ' +
        'or the TAVILY_API_KEY environment variable.\n',
    );
    ctx.setExitCode(1);
    return;
  }

  const result: TavilyWebSearchToolResult = await TavilySearchTool.execute(
    {
      queries,
      apiKey,
      topic,
      searchDepth,
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

export const searchCommand: AppCommand = {
  name: 'search',
  synopsis: 'Web search via Tavily API (use research instead if this is not available or erroring)',
  help: HELP,
  run: runSearch,
};
