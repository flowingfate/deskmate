/**
 * `web` 顶层 LocalTool facade 行为测试。
 *
 * 验证 `makeCommandFacade(makeRouterCommand({ ..., registry: webCommands }))`
 * 产出的 LocalTool:
 *   - spec.name / description 形态正确(LLM 看到 `web` 顶层工具,描述内嵌命令索引)
 *   - handler 把 cmdline 解析后交给 web router,空 / `--help` / 未知命令落顶层 help
 *   - cmdline 语法错降级到 router help + tip,不附 exit code
 *   - 正常子命令真正驱动 kernel(经 mock 验证)
 *
 * 关键:`./_fixture` 必须**先于** `@main/pi/tools/web` import —— 前者的
 * `vi.mock` 在 web 子命令的 kernel 被首次 import 之前注册,facade 才拿到
 * 被 mock 的 kernel。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { makeCtx, resetWebMocks, webMocks } from './_fixture';

import { web } from '@main/pi/tools/web';

beforeEach(() => {
  resetWebMocks();
});

async function run(cmd: string): Promise<string> {
  const result = await web.handler({ cmd } as never, makeCtx());
  if (!result.ok) throw new Error(`facade returned not-ok: ${result.error}`);
  return result.content;
}

describe('web facade — spec', () => {
  it('暴露为顶层工具,name 为 web', () => {
    expect(web.spec.name).toBe('web');
  });

  it('description 内嵌命令索引 + 渐进披露提示', () => {
    expect(web.spec.description).toContain('Available commands:');
    expect(web.spec.description).toContain('search');
    expect(web.spec.description).toContain('--help');
  });
});

describe('web facade — handler 路由', () => {
  it('空 cmdline → 顶层 help(命令索引),不调 kernel', async () => {
    const content = await run('');
    expect(content).toContain('Available commands:');
    expect(content).toContain('search');
    expect(webMocks.tavilyExecute).not.toHaveBeenCalled();
  });

  it('`--help` → 顶层 help', async () => {
    const content = await run('--help');
    expect(content).toContain('Available commands:');
  });

  it('cmdline 语法错 → router help + tip,无 exit code', async () => {
    const content = await run('search "unterminated');
    expect(content).toContain('Available commands:');
    expect(content).toContain('tip:');
    expect(content).not.toContain('(exit');
    expect(webMocks.tavilyExecute).not.toHaveBeenCalled();
  });

  it('`search foo` 真正驱动 kernel', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce({
      success: true,
      totalQueries: 1,
      totalResults: 0,
      results: [],
      timestamp: new Date().toISOString(),
    });
    const content = await run('search foo');
    expect(webMocks.tavilyExecute).toHaveBeenCalledTimes(1);
    expect(typeof content).toBe('string');
  });

  it('未知子命令 → 顶层 help + tip,不附 exit code(顶层松散)', async () => {
    const content = await run('bogus');
    expect(content).toContain('Available commands:');
    expect(content).toContain('no command named "bogus"');
    expect(content).not.toContain('(exit');
  });
});
