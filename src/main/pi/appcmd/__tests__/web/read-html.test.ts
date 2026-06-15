/**
 * `web read-html` subcommand 测试。
 * 覆盖:positional file 必填 / --mode + --section + --selector 合法性 /
 * outline / section / selector 三种模式输出 / --json / ctx.signal 透传 /
 * kernel throw 处理。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetWebMocks, runWeb, webMocks } from './_fixture';

beforeEach(() => {
  resetWebMocks();
});

function outlineResult(overrides: Partial<{ truncated: boolean; outline: Array<{ tag: string; id?: string; className?: string; depth: number; textPreview?: string }>; suggestedSelectors: string[] }> = {}): unknown {
  return {
    fileName: 'page.html',
    filePath: '/tmp/page.html',
    mode: 'outline',
    outline: overrides.outline ?? [
      { tag: 'html', depth: 0 },
      { tag: 'body', depth: 1 },
      { tag: 'main', id: 'main', depth: 2, textPreview: 'Welcome to the site...' },
    ],
    truncated: overrides.truncated ?? false,
    bytesRead: 1024,
    hasScript: false,
    hasStyle: false,
    suggestedSelectors: overrides.suggestedSelectors ?? ['main', '#main'],
  };
}

function sectionResult(content: string): unknown {
  return {
    fileName: 'page.html',
    filePath: '/tmp/page.html',
    mode: 'section',
    content,
    truncated: false,
    bytesRead: 2048,
    hasScript: true,
    hasStyle: false,
  };
}

describe('web read-html — args parsing', () => {
  it('缺 file positional → exit 2', async () => {
    const r = await runWeb('read-html');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('<file> argument required');
    expect(webMocks.readHtmlInternal).not.toHaveBeenCalled();
  });

  it('多个 positional → exit 2', async () => {
    const r = await runWeb('read-html a.html b.html');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('only one file at a time');
  });

  it('默认 mode=outline,kernel 收到 outline', async () => {
    webMocks.readHtmlInternal.mockResolvedValueOnce(outlineResult());
    await runWeb('read-html /tmp/page.html');
    expect(webMocks.readHtmlInternal.mock.calls[0][0]).toMatchObject({
      filePath: '/tmp/page.html',
      mode: 'outline',
    });
  });

  it('--mode 非法 → exit 2', async () => {
    const r = await runWeb('read-html /tmp/p.html --mode skim');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--mode must be');
  });

  it('--section 非法 → exit 2', async () => {
    const r = await runWeb('read-html /tmp/p.html --mode section --section navbar');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--section must be');
  });

  it('--mode selector 但没 --selector → exit 2', async () => {
    const r = await runWeb('read-html /tmp/p.html --mode selector');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--selector required when --mode selector');
  });

  it('--mode selector + --selector "#x" → 透传', async () => {
    webMocks.readHtmlInternal.mockResolvedValueOnce(sectionResult('hello'));
    await runWeb(['read-html', '/tmp/p.html', '--mode', 'selector', '--selector', '#main']);
    expect(webMocks.readHtmlInternal.mock.calls[0][0]).toMatchObject({
      filePath: '/tmp/p.html',
      mode: 'selector',
      selector: '#main',
    });
  });

  it('--selector 空 → exit 2', async () => {
    // 用 array argv 才能精确表达空字符串
    const r = await runWeb(['read-html', '/tmp/p.html', '--mode', 'selector', '--selector', '   ']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('non-empty CSS selector');
  });
});

describe('web read-html — output rendering', () => {
  it('outline 模式 human mode 输出树状结构 + suggested selectors', async () => {
    webMocks.readHtmlInternal.mockResolvedValueOnce(outlineResult());
    const r = await runWeb('read-html /tmp/page.html');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('page.html');
    expect(r.stdout).toContain('mode=outline');
    expect(r.stdout).toContain('Outline:');
    expect(r.stdout).toContain('<html>');
    expect(r.stdout).toContain('<main #main>');
    expect(r.stdout).toContain('Welcome to the site');
    expect(r.stdout).toContain('Suggested selectors:');
    expect(r.stdout).toContain('- main');
    expect(r.stdout).toContain('- #main');
  });

  it('outline 模式 truncated → header 显示 truncated reason', async () => {
    webMocks.readHtmlInternal.mockResolvedValueOnce(outlineResult({ truncated: true, outline: [{ tag: 'html', depth: 0 }] }));
    // truncated=true 但 mock 里没设 truncationReason —— 现实行为允许;render 不抛
    const r = await runWeb('read-html /tmp/page.html');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('truncated=');
  });

  it('section 模式 → 输出 content 字串', async () => {
    webMocks.readHtmlInternal.mockResolvedValueOnce(sectionResult('main body text'));
    const r = await runWeb('read-html /tmp/page.html --mode section --section main');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('main body text');
  });

  it('header 提示含 <script> warning', async () => {
    webMocks.readHtmlInternal.mockResolvedValueOnce(sectionResult('hello'));
    const r = await runWeb('read-html /tmp/page.html --mode section');
    expect(r.stdout).toContain('contains <script>');
  });

  it('--json 透传', async () => {
    const envelope = outlineResult();
    webMocks.readHtmlInternal.mockResolvedValueOnce(envelope);
    const r = await runWeb('read-html /tmp/page.html --json');
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(envelope);
  });
});

describe('web read-html — kernel failure handling', () => {
  it('kernel throw "File not accessible" → exit 1 + stderr', async () => {
    webMocks.readHtmlInternal.mockRejectedValueOnce(new Error('File not accessible: /nope'));
    const r = await runWeb('read-html /nope.html');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('File not accessible');
  });

  it('kernel throw + --json → exit 1,JSON 输出 stdout', async () => {
    webMocks.readHtmlInternal.mockRejectedValueOnce(new Error('boom'));
    const r = await runWeb('read-html /tmp/p.html --json');
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ success: false, error: 'boom' });
  });
});

describe('web read-html — ctx.signal 透传', () => {
  it('调 readHtmlInternal 时传入 options.signal', async () => {
    webMocks.readHtmlInternal.mockResolvedValueOnce(outlineResult());
    await runWeb('read-html /tmp/page.html');
    const [, options] = webMocks.readHtmlInternal.mock.calls[0];
    expect((options as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});
