/**
 * `app web search <query...>` 内核 —— Tavily Search REST API 驱动。
 *
 * 历史:替换原 `bingWebSearch.ts`(Playwright headless Chromium 爬 Bing SERP)。
 * 爬虫方案长期撞风控 / 0 结果,改走官方 Search API。Playwright 依赖仍由
 * `bingImageSearch.ts`(`web image`)保留,本文件不碰浏览器。
 *
 * 行为契约:
 * - 接受 1-10 个 query。Tavily 一请求一 query,故用 `Promise.allSettled`
 *   并发 N 个 `fetch`(对齐项目「禁止无界顺序 await 网络循环」纪律:并发 +
 *   每请求 timeout)。
 * - 单 query 失败回 `errors` 数组,**不**抛 —— 多 query 场景下一个失败不应
 *   让整批塌掉。全部失败(如 401 key 无效)才 `success: false`。
 * - `apiKey` 由 caller(`search.ts`)从 settings.json / 环境变量解析后注入,
 *   kernel 保持纯:不读 persist、不读 env。
 * - `options.signal` 与每个请求的 timeout signal 经 `AbortSignal.any` 合并;
 *   外部 abort 收敛成 "Tavily search aborted",超时收敛成 timeout 文案。
 *
 * 结果 envelope 与原 `BingWebSearchToolResult` 同形(`success` /
 * `totalQueries` / `totalResults` / `results` / `errors` / `timestamp`),
 * `results[]` 字段亦对齐(`index` / `title` / `url` / `caption` / `site` /
 * `query`,新增 `score`),让 `search.ts` 的 human / json 输出无需改形态。
 */

import { z } from 'zod';

import { log } from '@main/log';

const logger = log;

// ============ Type definitions ============

export interface TavilySearchResult {
  index: number;
  title: string;
  url: string;
  /** 结果摘要(Tavily `content`),对齐原 Bing `caption` 字段名。 */
  caption: string;
  /** 来源站点 host,从 url 派生(Tavily 不单独返回)。 */
  site: string;
  /** Tavily 相关性评分(0-1);Bing 路径没有,新增。 */
  score?: number;
  query?: string;
}

export type TavilySearchTopic = 'general' | 'news' | 'finance';
export type TavilySearchDepth = 'basic' | 'advanced';

export interface TavilyWebSearchToolArgs {
  queries: string[];
  /** Tavily API key(`tvly-...`),由 caller 解析后注入。 */
  apiKey: string;
  topic: TavilySearchTopic;
  searchDepth: TavilySearchDepth;
  maxResults?: number;
  /** 单请求 timeout(ms)。 */
  timeout?: number;
}

export interface TavilyWebSearchToolResult {
  success: boolean;
  totalQueries: number;
  totalResults: number;
  results: TavilySearchResult[];
  errors?: string[];
  timestamp: string;
}

// ============ Tavily REST 形态(仅消费用得到的字段) ============

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_TIMEOUT_MS = 60_000;

// Tavily REST 是网络边界外部数据 —— 用 zod 运行时校验,不靠 `as` 断言形态。
// 字段一律宽松(optional / nullish):只读我们消费的子集,Tavily 加字段不影响。
const TavilyApiResultSchema = z.object({
  title: z.string().nullish(),
  url: z.string().nullish(),
  content: z.string().nullish(),
  score: z.number().nullish(),
});

const TavilyApiResponseSchema = z.object({
  results: z.array(TavilyApiResultSchema).nullish(),
});

const TavilyApiErrorSchema = z.object({
  detail: z.object({ error: z.string().nullish() }).nullish(),
});

export class TavilySearchTool {
  static async execute(
    args: TavilyWebSearchToolArgs,
    options?: { signal?: AbortSignal },
  ): Promise<TavilyWebSearchToolResult> {
    const timestamp = new Date().toISOString();
    const maxResults = args.maxResults ?? DEFAULT_MAX_RESULTS;
    const timeout = args.timeout ?? DEFAULT_TIMEOUT_MS;

    const settled = await Promise.allSettled(
      args.queries.map((query) =>
        TavilySearchTool.searchOne(query, args, maxResults, timeout, options?.signal),
      ),
    );

    const results: TavilySearchResult[] = [];
    const errors: string[] = [];
    settled.forEach((outcome, i) => {
      const query = args.queries[i];
      if (outcome.status === 'fulfilled') {
        for (const item of outcome.value) results.push(item);
      } else {
        const reason =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        errors.push(`[${query}] ${reason}`);
        logger.warn({ msg: `[TavilySearchTool] query failed: ${query}`, mod: reason });
      }
    });

    // 跨 query 连续重新编号(human 输出按原始 query 顺序分组,index 用作展示序号)。
    results.forEach((r, i) => {
      r.index = i + 1;
    });

    // 部分失败不塌批:只有全部 query 都失败才 success=false。
    const success = errors.length < args.queries.length;
    const result: TavilyWebSearchToolResult = {
      success,
      totalQueries: args.queries.length,
      totalResults: results.length,
      results,
      timestamp,
    };
    if (errors.length > 0) result.errors = errors;
    return result;
  }

  /** 单 query → 单 Tavily 请求 → 映射成 `TavilySearchResult[]`。失败抛错,由 caller 收敛进 errors。 */
  private static async searchOne(
    query: string,
    args: TavilyWebSearchToolArgs,
    maxResults: number,
    timeout: number,
    externalSignal?: AbortSignal,
  ): Promise<TavilySearchResult[]> {
    const timeoutSignal = AbortSignal.timeout(timeout);
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, timeoutSignal])
      : timeoutSignal;

    const body = {
      query,
      max_results: maxResults,
      topic: args.topic,
      search_depth: args.searchDepth,
    };

    let response: Response;
    try {
      response = await fetch(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${args.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (externalSignal?.aborted) throw new Error('Tavily search aborted');
      if (timeoutSignal.aborted) throw new Error(`Tavily request timed out after ${timeout}ms`);
      throw new Error(
        `Tavily request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      const message = await TavilySearchTool.readErrorMessage(response);
      throw new Error(`Tavily API ${response.status}: ${message}`);
    }

    const parsed = TavilyApiResponseSchema.safeParse(await response.json());
    const items = parsed.success && parsed.data.results ? parsed.data.results : [];
    return items.map((item, i) => ({
      index: i + 1,
      title: item.title ?? 'untitled',
      url: item.url ?? '',
      caption: item.content ?? '',
      site: TavilySearchTool.hostOf(item.url ?? undefined),
      score: item.score ?? undefined,
      query,
    }));
  }

  /** 从非 2xx 响应体抽出 Tavily 的 `detail.error`;不是 JSON 时回退 statusText。 */
  private static async readErrorMessage(response: Response): Promise<string> {
    try {
      const parsed = TavilyApiErrorSchema.safeParse(await response.json());
      if (parsed.success && parsed.data.detail?.error) return parsed.data.detail.error;
    } catch {
      // 响应体非 JSON —— 忽略,回退下面的 statusText。
    }
    return response.statusText || 'unknown error';
  }

  private static hostOf(url?: string): string {
    if (!url) return '';
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }
}
