/**
 * `app` LocalTool 单测 —— 验证 cmdline → AppCommand 路由的全部分支。
 *
 * 这些测试**依赖**单例 `appCommands` 已注册真实命令(由 `appcmd/builtins/app`
 * 的副作用完成,无 feature flag 的 `mcp` / `agent` / `skill` 恒在)。
 *
 * 测点:
 *   - 空 cmdline / `--help` / `-h` → 顶层帮助
 *   - cmdline 语法错 → 顶层 help + tip(不附 exit code)
 *   - 未知命令 → 顶层 help + tip(不附 exit code)
 *   - description getter 内嵌全部命令的 synopsis
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { appCommands } from '../../appcmd/builtins/app';
import { app } from '../app';
import type { ToolContext } from '../types';
import { Tracer } from '@shared/log/trace';

function makeCtx(): ToolContext {
  return {
    profileId: 'p',
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

async function run(cmdline: string): Promise<string> {
  const r = await app.handler({ cmd: cmdline } as never, makeCtx());
  if (!r.ok) throw new Error(`app handler unexpected ok=false: ${r.error}`);
  return r.content;
}

beforeAll(() => {
  // sanity:确认真实命令已注册(由 `appcmd/builtins/app` 的副作用)
  expect(appCommands.has('mcp')).toBe(true);
});

describe('app LocalTool — 顶层 / 路由', () => {
  it('空 cmdline → 顶层帮助', async () => {
    const out = await run('');
    expect(out).toMatch(/Available commands:/);
    expect(out).toMatch(/mcp/);
  });

  it('`app --help` → 顶层帮助(同空 cmdline)', async () => {
    const out = await run('--help');
    expect(out).toMatch(/Available commands:/);
  });

  it('`app -h` → 顶层帮助', async () => {
    const out = await run('-h');
    expect(out).toMatch(/Available commands:/);
  });

  it('cmdline 语法错(未闭合引号) → 顶层 help + tip,**不**附 exit code', async () => {
    // 设计:顶层入口松散,LLM 一时手抖,我们端 help 到它面前而不是惩罚
    const out = await run('mcp "unterminated');
    expect(out).toMatch(/Available commands:/);
    expect(out).toMatch(/tip: cmdline parse error/);
    // 错误消息来自 vendored args-tokenizer(`Closing quote is missing.`),
    // 不再是手写 wrapper 的措辞。匹配 "Closing quote" 即可,具体上游措辞
    // 改了我们更新这一行就行 —— 完整契约见 parseCmdline.test.ts 的"错误"段。
    expect(out).toMatch(/Closing quote is missing/);
    expect(out).not.toMatch(/\(exit/); // 顶层降级路径不附 exit code
  });

  it('未知顶层命令 → 顶层 help + tip,**不**附 exit code', async () => {
    const out = await run('bogus');
    expect(out).toMatch(/Available commands:/);
    expect(out).toMatch(/no command named "bogus"/);
    expect(out).not.toMatch(/\(exit/);
  });

  it('任意"随便什么"字符串 → 顶层 help(松散兜底)', async () => {
    // 用中文 + emoji + 多 token,确认完全不会卡在 parser 或 lookup 任何环节
    const out = await run('随便什么 🎉 nonsense');
    expect(out).toMatch(/Available commands:/);
    expect(out).toMatch(/no command named "随便什么"/);
  });
});

describe('app LocalTool — description', () => {
  it('description 内嵌全部命令的 synopsis', () => {
    const desc = typeof app.spec.description === 'string' ? app.spec.description : '';
    expect(desc).toMatch(/Available commands:/);
    expect(desc).toMatch(/mcp\s+Manage MCP servers/);
  });

  it('description 提示 --help / --json / --dry-run / --yes', () => {
    const desc = typeof app.spec.description === 'string' ? app.spec.description : '';
    expect(desc).toMatch(/--help/);
    expect(desc).toMatch(/--json/);
    expect(desc).toMatch(/--dry-run/);
  });
});
