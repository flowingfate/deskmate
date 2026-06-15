/**
 * `web image` subcommand 测试。
 * 覆盖与 `search` 共享 90% flag 形态,额外:`--safe-search` 校验 + `--max` 上限 20。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetWebMocks, runWeb, webMocks } from './_fixture';

beforeEach(() => {
  resetWebMocks();
});

function okImageResult(results: Array<{ query: string; title?: string; thumbnailUrl?: string; sourcePageUrl?: string; width?: number; height?: number }>): unknown {
  return {
    success: true,
    totalQueries: new Set(results.map((r) => r.query)).size,
    totalResults: results.length,
    results: results.map((r, i) => ({
      index: i + 1,
      title: r.title ?? '',
      thumbnailUrl: r.thumbnailUrl ?? 'https://t/x',
      sourcePageUrl: r.sourcePageUrl ?? 'https://src/x',
      width: r.width,
      height: r.height,
      query: r.query,
    })),
    timestamp: new Date().toISOString(),
  };
}

describe('web image — args parsing', () => {
  it('positional query → execute 收到 queries', async () => {
    webMocks.bingImageExecute.mockResolvedValueOnce(okImageResult([]));
    await runWeb('image cat');
    expect(webMocks.bingImageExecute.mock.calls[0][0]).toMatchObject({
      queries: ['cat'],
      lang: 'en',
      locale: 'us',
    });
  });

  it('不再传 description 字段(老 schema 残留已移除)', async () => {
    webMocks.bingImageExecute.mockResolvedValueOnce(okImageResult([]));
    await runWeb('image cat');
    const args = webMocks.bingImageExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(args).not.toHaveProperty('description');
  });

  it('--safe-search Strict → 透传', async () => {
    webMocks.bingImageExecute.mockResolvedValueOnce(okImageResult([]));
    await runWeb('image cat --safe-search Strict');
    expect(webMocks.bingImageExecute.mock.calls[0][0].safeSearch).toBe('Strict');
  });

  it('--safe-search 非法 → exit 2', async () => {
    const r = await runWeb('image cat --safe-search loose');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--safe-search must be Off, Moderate, or Strict');
    expect(webMocks.bingImageExecute).not.toHaveBeenCalled();
  });

  it('--max 20 合法(image 上限放宽到 20)', async () => {
    webMocks.bingImageExecute.mockResolvedValueOnce(okImageResult([]));
    await runWeb('image cat --max 20');
    expect(webMocks.bingImageExecute.mock.calls[0][0].maxResults).toBe(20);
  });

  it('--max 21 → exit 2', async () => {
    const r = await runWeb('image cat --max 21');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('between 1 and 20');
  });
});

describe('web image — output rendering', () => {
  it('human mode 输出含 thumbnail / source / size', async () => {
    webMocks.bingImageExecute.mockResolvedValueOnce(okImageResult([
      { query: 'cat', title: 'Cute Cat', thumbnailUrl: 'https://t/cat', sourcePageUrl: 'https://src/cat', width: 800, height: 600 },
    ]));
    const r = await runWeb('image cat');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Cute Cat');
    expect(r.stdout).toContain('thumbnail: https://t/cat');
    expect(r.stdout).toContain('source:    https://src/cat');
    expect(r.stdout).toContain('size:      800x600');
  });

  it('--json 透传', async () => {
    const envelope = okImageResult([{ query: 'cat', title: 'C' }]);
    webMocks.bingImageExecute.mockResolvedValueOnce(envelope);
    const r = await runWeb('image cat --json');
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(envelope);
  });
});

describe('web image — ctx.signal 透传', () => {
  it('调 BingImageSearchTool.execute 时传入 ctx.signal', async () => {
    webMocks.bingImageExecute.mockResolvedValueOnce(okImageResult([]));
    await runWeb('image cat');
    const [, options] = webMocks.bingImageExecute.mock.calls[0];
    expect((options as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});
