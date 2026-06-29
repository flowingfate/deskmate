/**
 * `web` 顶层路由(经 `makeRouterCommand` 路由 `webCommands` 注册表)+ 4 个
 * subcommand 的 `--help` 行为 + 未知子命令的「松散」兜底。
 *
 * 关键:`web` 与 `app` **完全对等** —— 顶层入口松散(空 / `--help` / 未知命令
 * 一律降级到顶层 help,不附 exit code);成员命令**内部**的 flag / 参数错才严格
 * `(exit 2)`(见 search.test / fetch.test 等)。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { appCommands } from '@main/pi/appcmd/builtins/app';

// `./_fixture` 必须**先**于 `builtins/web` import —— 它的 vi.mock 要在 web 子命令
// 的 kernel 被首次加载前注册,否则会跑真实 Playwright。
import { resetWebMocks, runWeb, webMocks } from './_fixture';
import { webCommands } from '@main/pi/appcmd/builtins/web';

beforeEach(() => {
  resetWebMocks();
});

describe('web 顶层路由', () => {
  it('web 不在全局 appCommands —— 它有独立的 webCommands 注册表', () => {
    expect(appCommands.has('web')).toBe(false);
  });

  it('webCommands 注册了全部 4 个子命令', () => {
    expect(webCommands.listNames().sort()).toEqual(['download', 'fetch', 'research', 'search']);
  });

  it('空 sub → 顶层 help(命令索引),不调 kernel', async () => {
    const r = await runWeb([]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Available commands:');
    expect(r.stdout).toContain('search');
    expect(r.stdout).toContain('fetch');
    expect(webMocks.tavilyExecute).not.toHaveBeenCalled();
    expect(webMocks.fetchWebContentExecute).not.toHaveBeenCalled();
  });

  it('`web --help` → 顶层 help', async () => {
    const r = await runWeb('--help');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Available commands:');
    expect(r.stdout).toContain('download');
  });

  it('`web -h` → 顶层 help', async () => {
    const r = await runWeb('-h');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Available commands:');
  });

  it('未知 subcommand → 顶层 help + tip,**不**附 exit code(与 app 顶层松散对等)', async () => {
    const r = await runWeb('bogus');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Available commands:');
    expect(r.stdout).toContain('no command named "bogus"');
    expect(r.content).not.toMatch(/\(exit/);
    expect(webMocks.tavilyExecute).not.toHaveBeenCalled();
  });

  it.each([
    ['search', 'web search'],
    ['research', 'web research'],
    ['fetch', 'web fetch'],
    ['download', 'web download'],
  ])('`web %s --help` 展示 subcommand help,exit 0,不调 kernel', async (sub, usage) => {
    const r = await runWeb(`${sub} --help`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout).toContain(usage);
    expect(webMocks.tavilyExecute).not.toHaveBeenCalled();
    expect(webMocks.bingImageExecute).not.toHaveBeenCalled();
    expect(webMocks.fetchWebContentExecute).not.toHaveBeenCalled();
    expect(webMocks.downloadFileInternal).not.toHaveBeenCalled();
  });
});
