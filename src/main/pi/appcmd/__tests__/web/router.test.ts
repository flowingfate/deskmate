/**
 * `web` 顶层路由 + 4 个 subcommand 的 `--help` 行为 + 未知子命令。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { appCommands } from '@main/pi/appcmd/registry';

import { resetWebMocks, runWeb, webMocks } from './_fixture';

beforeEach(() => {
  resetWebMocks();
});

describe('web 顶层路由', () => {
  it('注册到全局 appCommands', () => {
    expect(appCommands.has('web')).toBe(true);
  });

  it('空 sub → 顶层 help', async () => {
    const r = await runWeb([]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout).toContain('web <subcommand>');
    expect(r.stdout).toContain('search <query>');
    expect(r.stdout).toContain('fetch <url>');
    expect(webMocks.bingWebExecute).not.toHaveBeenCalled();
    expect(webMocks.fetchWebContentExecute).not.toHaveBeenCalled();
  });

  it('`web --help` → 顶层 help', async () => {
    const r = await runWeb('--help');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('SUBCOMMANDS');
  });

  it('`web -h` → 顶层 help', async () => {
    const r = await runWeb('-h');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('SUBCOMMANDS');
  });

  it('未知 subcommand → exit 2 + 提示', async () => {
    const r = await runWeb('bogus');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown subcommand');
    expect(r.stderr).toContain('"bogus"');
    expect(webMocks.bingWebExecute).not.toHaveBeenCalled();
  });

  it.each([
    ['search', 'web search'],
    ['image', 'web image'],
    ['fetch', 'web fetch'],
    ['read-html', 'web read-html'],
  ])('`web %s --help` 展示 subcommand help,exit 0,不调 kernel', async (sub, usage) => {
    const r = await runWeb(`${sub} --help`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout).toContain(usage);
    expect(webMocks.bingWebExecute).not.toHaveBeenCalled();
    expect(webMocks.bingImageExecute).not.toHaveBeenCalled();
    expect(webMocks.fetchWebContentExecute).not.toHaveBeenCalled();
    expect(webMocks.readHtmlInternal).not.toHaveBeenCalled();
  });
});
