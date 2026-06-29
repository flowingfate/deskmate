/**
 * `app` LocalTool 单测 —— 验证 cmdline → AppCommand 路由的全部分支。
 *
 * 这些测试**依赖**单例 `appCommands` 已注册 `hello`(由 `pi/appcmd/index.ts`
 * 的副作用完成)。测试本身不再额外注册,直接用 `hello` 命令打通端到端。
 *
 * 测点:
 *   - 空 cmdline / `--help` / `-h` → 顶层帮助
 *   - cmdline 语法错 → exit 2
 *   - 未知命令 → exit 127 + 提示可用命令
 *   - 已知命令 + 已知 subcommand → 输出预期
 *   - exit code 透传(`hello fail` exit 42 → tool content 含 "(exit 42)")
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
  // sanity:确认骨架示范命令 hello 已注册(由 `appcmd/index.ts` 的副作用)
  expect(appCommands.has('hello')).toBe(true);
});

describe('app LocalTool — 顶层 / 路由', () => {
  it('空 cmdline → 顶层帮助', async () => {
    const out = await run('');
    expect(out).toMatch(/Available commands:/);
    expect(out).toMatch(/hello/);
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
    const out = await run('hello "unterminated');
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

describe('app LocalTool — 路由到 hello 命令', () => {
  it('`hello` → hello 顶层 help', async () => {
    const out = await run('hello');
    expect(out).toMatch(/USAGE\s+hello <subcommand>/);
  });

  it('`hello say world` → "Hello, world!"', async () => {
    const out = await run('hello say world');
    expect(out).toContain('Hello, world!');
    expect(out).not.toMatch(/\(exit/); // exit 0 不显示
  });

  it('`hello say world --json` → JSON 格式', async () => {
    const out = await run('hello say world --json');
    // 解析回来确认是结构化的
    const lines = out.split('\n').filter(Boolean);
    const obj = JSON.parse(lines[0]);
    expect(obj.greeting).toBe('Hello, world!');
  });

  it('`hello say` 缺位置参数 → exit 2', async () => {
    const out = await run('hello say');
    expect(out).toMatch(/missing required argument: <name>/);
    expect(out).toMatch(/\(exit 2\)/);
  });

  it('`hello say world --shout` 缺确认 → exit 1', async () => {
    const out = await run('hello say world --shout');
    expect(out).toMatch(/destructive/);
    expect(out).toMatch(/\(exit 1\)/);
  });

  it('`hello say world --shout --yes` → 大写输出', async () => {
    const out = await run('hello say world --shout --yes');
    expect(out).toContain('HELLO, WORLD!');
  });

  it('`hello say world --shout --dry-run` → 预览,不需 --yes', async () => {
    const out = await run('hello say world --shout --dry-run');
    expect(out).toMatch(/dry-run/);
    expect(out).toContain('HELLO, WORLD!');
    expect(out).not.toMatch(/\(exit/);
  });

  it('`hello say world --tag a --tag b` → 数组型 flag 收集', async () => {
    const out = await run('hello say world --tag a --tag b');
    expect(out).toMatch(/Tags: a, b/);
  });

  it('`hello fail` → exit 42(业务自选非零)', async () => {
    const out = await run('hello fail');
    expect(out).toMatch(/this command always fails by design/);
    expect(out).toMatch(/\(exit 42\)/);
  });

  it('`hello bogus-sub` → exit 2(边界 A:已知命令内部仍严格报错,不下沉到 help)', async () => {
    // 一旦 LLM 走进具体命令域,反馈就该精确。顶层 help 的松散兜底**不**渗透
    // 到子命令层面 —— 否则 LLM 永远只看顶层 help,失去具体命令的引导信号。
    const out = await run('hello bogus-sub');
    expect(out).toMatch(/unknown subcommand "bogus-sub"/);
    expect(out).toMatch(/\(exit 2\)/);
  });
});

describe('app LocalTool — description', () => {
  it('description 内嵌全部命令的 synopsis', () => {
    const desc = typeof app.spec.description === 'string' ? app.spec.description : '';
    expect(desc).toMatch(/Available commands:/);
    expect(desc).toMatch(/hello\s+Skeleton demo/);
  });

  it('description 提示 --help / --json / --dry-run / --yes', () => {
    const desc = typeof app.spec.description === 'string' ? app.spec.description : '';
    expect(desc).toMatch(/--help/);
    expect(desc).toMatch(/--json/);
    expect(desc).toMatch(/--dry-run/);
  });
});
