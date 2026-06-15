/**
 * `web` 命令测试族的共享 fixture + helper。
 *
 * 设计:
 * - 4 个 kernel mock 全部 hoisted —— `BingWebSearchTool.execute` /
 *   `BingImageSearchTool.execute` / `FetchWebContentTool.execute` 是 class
 *   static method,mock 时把整个 class 替换成 `{ execute: vi.fn() }`;
 *   `readHtmlInternal` 是 module-level function,mock 直接给 fn。
 * - dispatcher 走真路径 —— 不 mock parseCmdline / dispatcher / app.ts,只在
 *   kernel 边界 mock。这样测试覆盖了"cmdline → tokenize → flags → runXxx →
 *   kernel call" 全链路。
 *
 * **vi.hoisted 纪律**:`webMocks` 必须用 `const = vi.hoisted(...)` 同名 const,
 * **不**能 `export const webMocks = vi.hoisted(...)` —— vitest transformer 报
 * "Cannot access 'webMocks' before initialization"。export 走 `export { webMocks }`
 * 间接形态(与 mcp / agent / skill / schedule fixture 同纪律,参见
 * `mcp/_fixture.ts` 注释)。
 */

import { vi } from 'vitest';

import type { ToolContext } from '@main/pi/tools/types';

// ---------------------------------------------------------------------------
// 被 mock 模块的 stub state(必须 hoisted)
// ---------------------------------------------------------------------------

const webMocks = vi.hoisted(() => ({
  bingWebExecute: vi.fn(),
  bingImageExecute: vi.fn(),
  fetchWebContentExecute: vi.fn(),
  readHtmlInternal: vi.fn(),
}));

export { webMocks };

vi.mock('@main/pi/appcmd/builtins/web/kernel/bingWebSearch', () => ({
  BingWebSearchTool: { execute: webMocks.bingWebExecute },
}));

vi.mock('@main/pi/appcmd/builtins/web/kernel/bingImageSearch', () => ({
  BingImageSearchTool: { execute: webMocks.bingImageExecute },
}));

vi.mock('@main/pi/appcmd/builtins/web/kernel/fetchWebContent', () => ({
  FetchWebContentTool: { execute: webMocks.fetchWebContentExecute },
}));

vi.mock('@main/pi/appcmd/builtins/web/kernel/readHtml', () => ({
  readHtmlInternal: webMocks.readHtmlInternal,
}));

// ---------------------------------------------------------------------------
// 被测对象 —— 必须在 vi.mock 之后再 import
// ---------------------------------------------------------------------------
import { dispatchAppCommand, formatAppCmdContent } from '@main/pi/appcmd/dispatcher';
// side-effect import:把 webCommand 等全部注册进单例 appCommands。
// 这样 `router.test.ts` 可以对 `appCommands.has('web')` 做断言。
import '@main/pi/appcmd';
import { webCommand } from '@main/pi/appcmd/builtins/web';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const base: ToolContext = {
    profileId: 'profile-1',
    agentId: 'agent-1',
    sessionId: 'session-1',
    callId: 'call-1',
    signal: new AbortController().signal,
    tracer: { traceId: 't', traceSpan: () => ({ end: () => {}, addTag: () => {}, log: () => {} }) } as never,
    eventSender: null,
    chunkStream: null,
    isSubAgent: false,
  };
  return { ...base, ...overrides };
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** dispatcher 合成的最终 LLM 可见字符串 */
  content: string;
}

/**
 * 用真实 dispatcher 跑一次 `web <subcommand> ...`,返回结构化输出。
 *
 * 入参既可以是 argv 数组(`['search', 'foo']`),也可以是 cmdline 字符串
 * (`'search foo'`)—— 字符串走 split 简化形态,空格分词,**不**做完整
 * shell quoting。要测真实 quoting 走 `argvOrCmdline` 数组形态。
 */
export async function runWeb(
  argvOrCmdline: string | readonly string[],
  overrides?: Partial<ToolContext>,
): Promise<RunResult> {
  const argv = typeof argvOrCmdline === 'string'
    ? argvOrCmdline.split(/\s+/).filter((t) => t.length > 0)
    : Array.from(argvOrCmdline);
  const ctx = makeCtx(overrides);
  const result = await dispatchAppCommand(webCommand, argv, ctx);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    content: formatAppCmdContent(result),
  };
}

/** beforeEach 默认:所有 mock reset 到 undefined return。test 自己 set return value。 */
export function resetWebMocks(): void {
  webMocks.bingWebExecute.mockReset();
  webMocks.bingImageExecute.mockReset();
  webMocks.fetchWebContentExecute.mockReset();
  webMocks.readHtmlInternal.mockReset();
}

// ---------------------------------------------------------------------------
// vitest 把 `src/**/__tests__/**/*.ts` 全部视作 test 文件 —— fixture 必须
// 至少含一个 test 才不会被 "No test suite found" 报错。
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';
describe('web fixture sanity', () => {
  it('webMocks exposes all 4 kernel handles', () => {
    expect(typeof webMocks.bingWebExecute).toBe('function');
    expect(typeof webMocks.bingImageExecute).toBe('function');
    expect(typeof webMocks.fetchWebContentExecute).toBe('function');
    expect(typeof webMocks.readHtmlInternal).toBe('function');
  });
  it('runWeb resolves with dispatcher-shaped result', async () => {
    webMocks.bingWebExecute.mockResolvedValueOnce({
      success: true,
      totalQueries: 1,
      totalResults: 0,
      results: [],
      timestamp: new Date().toISOString(),
    });
    const r = await runWeb('search foo');
    expect(r.exitCode).toBe(0);
    expect(typeof r.content).toBe('string');
  });
});
