/**
 * `read` 工具的 HTML backend 集成测试(`.html` / `.htm`)。
 *
 * 覆盖两条正交轴:
 * - `?query`(命名参数)→ 结构化 HTML 阅读(outline / section / selector),
 *   含 URL-encoded(`%23`)与原始(`#`)两种 CSS selector 写法。
 * - `:<sel>`(行/页/raw)→ 当纯文本读(走 filesystem backend,逐字)。
 * 以及非法 query 的错误透传。
 *
 * 用真盘临时文件 + 真 dispatch,不 mock —— HTML reader 是纯字符串处理,无外部依赖。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { read } from '../../read';
import type { ToolContext } from '../../types';
import { Tracer } from '@shared/log/trace';

let tmpDir = '';
let htmlPath = '';

const HTML = `<!DOCTYPE html>
<html>
<head><title>Doc</title></head>
<body>
<nav>menu</nav>
<main id="content" class="article-body"><p>Hello world from main.</p></main>
<footer>footer text</footer>
</body>
</html>`;

function makeCtx(): ToolContext {
  return {
    profileId: 'p_TEST',
    agentId: 'a',
    sessionId: 's',
    signal: new AbortController().signal,
    eventSender: null,
    tracer: Tracer.noop,
    isSubAgent: false,
    callId: 'c',
    chunkStream: null,
  };
}

async function readPath(p: string): Promise<Record<string, unknown>> {
  const result = await read.handler({ path: p }, makeCtx());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return JSON.parse(result.content) as Record<string, unknown>;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-html-be-'));
  htmlPath = path.join(tmpDir, 'page.html');
  fs.writeFileSync(htmlPath, HTML, 'utf8');
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('read HTML backend — query axis', () => {
  it('裸 .html → outline 模式(DOM 骨架 + suggestedSelectors)', async () => {
    const r = await readPath(htmlPath);
    expect(r.mode).toBe('outline');
    expect(Array.isArray(r.outline)).toBe(true);
    expect(Array.isArray(r.suggestedSelectors)).toBe(true);
    // 不是原始 HTML dump —— 没有 content 字段塞整页
    expect(r.content).toBeUndefined();
  });

  it('?mode=section&section=main → 抽 main 纯文本', async () => {
    const r = await readPath(`${htmlPath}?mode=section&section=main`);
    expect(r.mode).toBe('section');
    expect(String(r.content)).toContain('Hello world from main.');
    expect(String(r.content)).not.toContain('<p>');
  });

  it('?mode=selector&selector=%23content(URL-encoded #)→ 抽 #content', async () => {
    const r = await readPath(`${htmlPath}?mode=selector&selector=%23content`);
    expect(r.mode).toBe('selector');
    expect(String(r.content)).toContain('Hello world from main.');
  });

  it('?mode=selector&selector=#content(原始 #,URLSearchParams 保字面)→ 抽 #content', async () => {
    const r = await readPath(`${htmlPath}?mode=selector&selector=#content`);
    expect(r.mode).toBe('selector');
    expect(String(r.content)).toContain('Hello world from main.');
  });

  it('?mode=selector&selector=.article-body → class selector 命中', async () => {
    const r = await readPath(`${htmlPath}?mode=selector&selector=.article-body`);
    expect(r.mode).toBe('selector');
    expect(String(r.content)).toContain('Hello world from main.');
  });
});

describe('read HTML backend — selector axis = plain text', () => {
  it(':raw → 逐字原始 HTML(走 filesystem,不进 HTML reader)', async () => {
    const r = await readPath(`${htmlPath}:raw`);
    // filesystem backend 不带 mode 字段;内容是原始 HTML
    expect(r.mode).toBeUndefined();
    expect(JSON.stringify(r)).toContain('<main id=');
  });

  it(':1-3 行范围 → 纯文本读(filesystem),不是 outline', async () => {
    const r = await readPath(`${htmlPath}:1-3`);
    expect(r.mode).toBeUndefined();
  });
});

describe('read HTML backend — error passthrough', () => {
  it('?mode=bogus → 抛错', async () => {
    await expect(read.handler({ path: `${htmlPath}?mode=bogus` }, makeCtx())).rejects.toThrow(/mode must be/);
  });

  it('?mode=selector 缺 selector → 抛错', async () => {
    await expect(read.handler({ path: `${htmlPath}?mode=selector` }, makeCtx())).rejects.toThrow(/selector=<css> required/);
  });

  it('?mode=section&section=bogus → 抛错', async () => {
    await expect(read.handler({ path: `${htmlPath}?mode=section&section=bogus` }, makeCtx())).rejects.toThrow(/section must be/);
  });
});
