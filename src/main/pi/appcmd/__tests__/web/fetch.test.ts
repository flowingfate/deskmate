/**
 * `web fetch` subcommand 测试。
 * 覆盖:positional / --url repeatable / 多 URL / size + timeout 校验 +
 * kernel throw / 部分失败 partial / --json / ctx.signal 透传。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetWebMocks, runWeb, webMocks } from './_fixture';

beforeEach(() => {
  resetWebMocks();
});

function okFetchResult(pages: Array<{ url: string; title?: string; content?: string; size?: number; error?: string }>): unknown {
  return {
    success: true,
    totalUrls: pages.length,
    successfulUrls: pages.filter((p) => !p.error).length,
    results: pages.map((p) => ({
      url: p.url,
      title: p.title ?? '',
      content: p.content ?? '',
      size: p.size ?? (p.content?.length ?? 0),
      timestamp: new Date().toISOString(),
      ...(p.error ? { error: p.error } : {}),
    })),
    mergedContent: pages.filter((p) => !p.error).map((p) => `## ${p.title ?? p.url}\n${p.content ?? ''}`).join('\n'),
    timestamp: new Date().toISOString(),
  };
}

describe('web fetch — args parsing', () => {
  it('positional 单 URL → execute 收到 urls=[<u>]', async () => {
    webMocks.fetchWebContentExecute.mockResolvedValueOnce(okFetchResult([{ url: 'https://example.com', title: 'Example', content: 'hi' }]));
    const r = await runWeb('fetch https://example.com');
    expect(r.exitCode).toBe(0);
    const [args] = webMocks.fetchWebContentExecute.mock.calls[0];
    expect(args).toMatchObject({ urls: ['https://example.com'] });
  });

  it('--url repeatable + positional 合并', async () => {
    webMocks.fetchWebContentExecute.mockResolvedValueOnce(okFetchResult([]));
    await runWeb(['fetch', 'https://a.com', '--url', 'https://b.com', '--url', 'https://c.com']);
    expect(webMocks.fetchWebContentExecute.mock.calls[0][0].urls).toEqual([
      'https://a.com',
      'https://b.com',
      'https://c.com',
    ]);
  });

  it('没有 URL → exit 2', async () => {
    const r = await runWeb('fetch');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('at least one URL');
    expect(webMocks.fetchWebContentExecute).not.toHaveBeenCalled();
  });

  it('超过 20 URL → exit 2', async () => {
    const urls = Array.from({ length: 21 }, (_, i) => `https://x${i}.com`);
    const r = await runWeb(['fetch', ...urls]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('max is 20');
  });

  it('--timeout 越界 → exit 2', async () => {
    const r = await runWeb('fetch https://x.com --timeout 1');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('between 5 and 60');
  });

  it('--max-size 越界 → exit 2', async () => {
    const r = await runWeb('fetch https://x.com --max-size 100');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('between 1024 and 10485760');
  });

  it('--timeout / --max-size 合法 → 透传 timeoutSeconds / maxContentSize', async () => {
    webMocks.fetchWebContentExecute.mockResolvedValueOnce(okFetchResult([]));
    await runWeb('fetch https://x.com --timeout 45 --max-size 524288');
    const [args] = webMocks.fetchWebContentExecute.mock.calls[0];
    expect(args).toMatchObject({ timeoutSeconds: 45, maxContentSize: 524288 });
  });
});

describe('web fetch — kernel failure handling', () => {
  it('kernel throw → exit 1 + stderr', async () => {
    webMocks.fetchWebContentExecute.mockRejectedValueOnce(new Error('boom'));
    const r = await runWeb('fetch https://x.com');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('boom');
  });

  it('kernel throw + --json → exit 1,JSON envelope on stdout', async () => {
    webMocks.fetchWebContentExecute.mockRejectedValueOnce(new Error('boom'));
    const r = await runWeb('fetch https://x.com --json');
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ success: false, error: 'boom' });
  });

  it('kernel success=false → exit 1', async () => {
    webMocks.fetchWebContentExecute.mockResolvedValueOnce({
      success: false,
      totalUrls: 1,
      successfulUrls: 0,
      results: [],
      mergedContent: '',
      errors: ['arg invalid'],
      timestamp: new Date().toISOString(),
    });
    const r = await runWeb('fetch https://x.com');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('web fetch failed');
  });
});

describe('web fetch — output rendering', () => {
  it('human mode 列出 ✓ / ✗ 行 + mergedContent', async () => {
    webMocks.fetchWebContentExecute.mockResolvedValueOnce(okFetchResult([
      { url: 'https://a.com', title: 'A', content: 'aaa' },
      { url: 'https://b.com', error: 'HTTP 404' },
    ]));
    const r = await runWeb('fetch https://a.com https://b.com');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Fetched 1/2 URL(s)');
    expect(r.stdout).toContain('✓ https://a.com');
    expect(r.stdout).toContain('✗ https://b.com');
    expect(r.stdout).toContain('HTTP 404');
    expect(r.stdout).toContain('──── content ────');
  });

  it('--json 透传完整 envelope', async () => {
    const envelope = okFetchResult([{ url: 'https://a.com', title: 'A', content: 'x' }]);
    webMocks.fetchWebContentExecute.mockResolvedValueOnce(envelope);
    const r = await runWeb('fetch https://a.com --json');
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(envelope);
  });
});

describe('web fetch — ctx.signal 透传', () => {
  it('调 FetchWebContentTool.execute 时传入 ctx.signal', async () => {
    webMocks.fetchWebContentExecute.mockResolvedValueOnce(okFetchResult([]));
    await runWeb('fetch https://x.com');
    const [, options] = webMocks.fetchWebContentExecute.mock.calls[0];
    expect((options as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});
