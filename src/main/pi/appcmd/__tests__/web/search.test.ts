/**
 * `web search` subcommand 测试。
 * 覆盖:happy path(positional / repeatable --query / 多 query 顺序)、
 * flag 校验失败、kernel 失败 envelope、ctx.signal 透传。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetWebMocks, runWeb, webMocks } from './_fixture';

beforeEach(() => {
  resetWebMocks();
});

function okResult(results: Array<Partial<{ index: number; title: string; url: string; caption: string; site: string; query: string }>>): unknown {
  return {
    success: true,
    totalQueries: new Set(results.map((r) => r.query)).size,
    totalResults: results.length,
    results: results.map((r, i) => ({
      index: i + 1,
      title: r.title ?? 'untitled',
      url: r.url ?? 'https://x',
      caption: r.caption ?? '',
      site: r.site ?? 'x',
      query: r.query ?? '',
    })),
    timestamp: new Date().toISOString(),
  };
}

describe('web search — args parsing', () => {
  it('positional 单 query → execute 收到 queries=[<q>]', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce(okResult([{ query: 'foo', title: 'r1' }]));
    const r = await runWeb('search foo');
    expect(r.exitCode).toBe(0);
    expect(webMocks.tavilyExecute).toHaveBeenCalledTimes(1);
    const [args] = webMocks.tavilyExecute.mock.calls[0];
    expect(args).toMatchObject({ queries: ['foo'], topic: 'general', searchDepth: 'basic', apiKey: 'tvly-test-key' });
  });

  it('positional 多 query 保序', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce(okResult([]));
    await runWeb('search foo bar baz');
    expect(webMocks.tavilyExecute.mock.calls[0][0].queries).toEqual(['foo', 'bar', 'baz']);
  });

  it('--query 与 -q 混合 repeatable', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce(okResult([]));
    await runWeb(['search', '--query', 'a', '-q', 'b', '-q', 'c']);
    expect(webMocks.tavilyExecute.mock.calls[0][0].queries).toEqual(['a', 'b', 'c']);
  });

  it('positional + --query 都给时合并(positional 在前)', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce(okResult([]));
    await runWeb(['search', 'first', '--query', 'second']);
    expect(webMocks.tavilyExecute.mock.calls[0][0].queries).toEqual(['first', 'second']);
  });

  it('没有 query → exit 2', async () => {
    const r = await runWeb('search');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('at least one query');
    expect(webMocks.tavilyExecute).not.toHaveBeenCalled();
  });

  it('超过 10 query → exit 2', async () => {
    const queries = Array.from({ length: 11 }, (_, i) => `q${i}`);
    const r = await runWeb(['search', ...queries]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('max is 10');
    expect(webMocks.tavilyExecute).not.toHaveBeenCalled();
  });

  it('--topic news → 透传', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce(okResult([]));
    await runWeb('search 你好 --topic news');
    expect(webMocks.tavilyExecute.mock.calls[0][0]).toMatchObject({ topic: 'news' });
  });

  it('--topic 非法 → exit 2', async () => {
    const r = await runWeb('search foo --topic sports');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--topic must be');
    expect(webMocks.tavilyExecute).not.toHaveBeenCalled();
  });

  it('--depth advanced → 透传', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce(okResult([]));
    await runWeb('search foo --depth advanced');
    expect(webMocks.tavilyExecute.mock.calls[0][0]).toMatchObject({ searchDepth: 'advanced' });
  });

  it('--depth 非法 → exit 2', async () => {
    const r = await runWeb('search foo --depth deep');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--depth must be');
    expect(webMocks.tavilyExecute).not.toHaveBeenCalled();
  });

  it('--max 非数字 → exit 2', async () => {
    const r = await runWeb('search foo --max abc');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--max must be a number');
    expect(webMocks.tavilyExecute).not.toHaveBeenCalled();
  });

  it('--max 越界(>20)→ exit 2', async () => {
    const r = await runWeb('search foo --max 50');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('between 1 and 20');
    expect(webMocks.tavilyExecute).not.toHaveBeenCalled();
  });

  it('--max 合法 → 透传 maxResults', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce(okResult([]));
    await runWeb('search foo --max 3');
    expect(webMocks.tavilyExecute.mock.calls[0][0].maxResults).toBe(3);
  });

  it('--timeout 合法 → 透传', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce(okResult([]));
    await runWeb('search foo --timeout 15000');
    expect(webMocks.tavilyExecute.mock.calls[0][0].timeout).toBe(15000);
  });

  it('--timeout 越界 → exit 2', async () => {
    const r = await runWeb('search foo --timeout 500');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('between 1000 and 300000');
  });
});

describe('web search — API key 解析', () => {
  it('settings / env 都无 key → exit 1,不调 kernel', async () => {
    delete process.env.TAVILY_API_KEY;
    const r = await runWeb('search foo');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('no Tavily API key');
    expect(webMocks.tavilyExecute).not.toHaveBeenCalled();
  });
});

describe('web search — output rendering', () => {
  it('human mode 按 query 分组打印', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce(okResult([
      { query: 'foo', title: 'F1', url: 'https://f1' },
      { query: 'foo', title: 'F2', url: 'https://f2' },
      { query: 'bar', title: 'B1', url: 'https://b1', caption: 'about bar' },
    ]));
    const r = await runWeb('search foo bar');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Found 3 result(s) across 2 query/queries');
    expect(r.stdout).toContain('[foo]');
    expect(r.stdout).toContain('[bar]');
    expect(r.stdout).toContain('F1');
    expect(r.stdout).toContain('https://b1');
    expect(r.stdout).toContain('about bar');
  });

  it('--json 透传原 envelope', async () => {
    const envelope = okResult([{ query: 'foo', title: 'F1', url: 'https://f1' }]);
    webMocks.tavilyExecute.mockResolvedValueOnce(envelope);
    const r = await runWeb('search foo --json');
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(envelope);
  });

  it('结果为空 → 人话提示,不写 stderr', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce(okResult([]));
    const r = await runWeb('search foo');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No results');
  });

  it('kernel success=false → exit 1 + stderr', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce({
      success: false,
      totalQueries: 1,
      totalResults: 0,
      results: [],
      errors: ['Tavily API 401: Unauthorized: missing or invalid API key.'],
      timestamp: new Date().toISOString(),
    });
    const r = await runWeb('search foo');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('web search failed');
    expect(r.stderr).toContain('Tavily API 401');
  });

  it('--json + success=false → exit 1,JSON 输出 stdout', async () => {
    const envelope = {
      success: false,
      totalQueries: 1,
      totalResults: 0,
      results: [],
      errors: ['bad'],
      timestamp: new Date().toISOString(),
    };
    webMocks.tavilyExecute.mockResolvedValueOnce(envelope);
    const r = await runWeb('search foo --json');
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual(envelope);
  });
});

describe('web search — ctx.signal 透传', () => {
  it('调 TavilySearchTool.execute 时传入 ctx.signal', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce(okResult([]));
    await runWeb('search foo');
    const options = webMocks.tavilyExecute.mock.calls[0][1];
    if (!options || typeof options !== 'object' || !('signal' in options)) {
      throw new Error('expected execute() to receive options with a signal');
    }
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});
