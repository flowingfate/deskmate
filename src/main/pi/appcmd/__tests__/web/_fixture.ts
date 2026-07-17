/**
 * `web` 命令测试族的共享 fixture + helper。
 *
 * 设计:
 * - 4 个 kernel mock 全部 hoisted —— `BingWebSearchTool.execute` /
 *   `BingImageSearchTool.execute` / `FetchWebContentTool.execute` 是 class
 *   static method,mock 时把整个 class 替换成 `{ execute: vi.fn() }`;
 *   `downloadFileInternal` 是 module-level function,mock 直接给 fn。
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

import type { AgentToolContext } from '@main/pi/tools/types';
import { testProfile } from '../../../tools/__tests__/profileFixture';

// ---------------------------------------------------------------------------
// 被 mock 模块的 stub state(必须 hoisted)
// ---------------------------------------------------------------------------

const webMocks = vi.hoisted(() => ({
  tavilyExecute: vi.fn(),
  fetchWebContentExecute: vi.fn(),
  downloadFileInternal: vi.fn(),
}));

export { webMocks };

// `web search` 从 owning Profile settings / env 解析 Tavily key。
// 模块加载即设置环境变量,覆盖没有 `resetWebMocks` beforeEach 的套件。
process.env.TAVILY_API_KEY = 'tvly-test-key';

vi.mock('@main/pi/appcmd/builtins/web/kernel/tavilySearch', () => ({
  TavilySearchTool: { execute: webMocks.tavilyExecute },
}));

vi.mock('@main/pi/appcmd/builtins/web/kernel/fetchWebContent', () => ({
  FetchWebContentTool: { execute: webMocks.fetchWebContentExecute },
}));

vi.mock('@main/pi/appcmd/builtins/web/kernel/download', () => ({
  downloadFileInternal: webMocks.downloadFileInternal,
}));

// ---------------------------------------------------------------------------
// 被测对象 —— 必须在 vi.mock 之后再 import
// ---------------------------------------------------------------------------
import { dispatchAppCommand, formatAppCmdContent } from '@main/pi/appcmd/dispatcher';
import { makeRouterCommand } from '@main/pi/appcmd/makeRouterCommand';
// side-effect import:把 hello / mcp / ... 注册进全局 appCommands(其它 test
// 可能依赖)。`web` 自己不再进 appCommands —— 它有独立的 `webCommands` 注册表。
import '@main/pi/appcmd/builtins/app';
import { webCommands } from '@main/pi/appcmd/builtins/web';

// 与 `pi/tools/web.ts` 完全同构的 router —— 测试通过它跑 `web <sub> ...`,
// 走的就是生产路径(makeRouterCommand 路由 webCommands)。
const webRouter = makeRouterCommand({
  name: 'web',
  synopsis: 'Search / image-search the web, fetch URLs, download files',
  registry: webCommands,
});

export function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  const base: AgentToolContext = {
    mode: 'agent',
    profile: testProfile,
    profileId: 'profile-1',
    agentId: 'agent-1',
    sessionId: 'session-1',
    callId: 'call-1',
    signal: new AbortController().signal,
    tracer: { traceId: 't', traceSpan: () => ({ end: () => {}, addTag: () => {}, log: () => {} }) } as never,
    eventSender: null,
    chunkStream: null,
  };
  return { ...base, ...overrides, mode: 'agent' };
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** dispatcher 合成的最终 LLM 可见字符串 */
  content: string;
  /** run 期间通过 `ctx.addDeliverable` 登记的产出文件 URI。 */
  deliverables: string[];
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
  overrides?: Partial<AgentToolContext>,
): Promise<RunResult> {
  const argv = typeof argvOrCmdline === 'string'
    ? argvOrCmdline.split(/\s+/).filter((t) => t.length > 0)
    : Array.from(argvOrCmdline);
  const ctx = makeCtx(overrides);
  const result = await dispatchAppCommand(webRouter, argv, ctx);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    content: formatAppCmdContent(result),
    deliverables: result.deliverables,
  };
}

/** beforeEach 默认:所有 mock reset 到 undefined return。test 自己 set return value。 */
export function resetWebMocks(): void {
  // 设置 env 让 search.ts 在 owning Profile 未配置 key 时走到(被 mock 的)kernel。
  process.env.TAVILY_API_KEY = 'tvly-test-key';
  webMocks.tavilyExecute.mockReset();
  webMocks.fetchWebContentExecute.mockReset();
  webMocks.downloadFileInternal.mockReset();
}

// ---------------------------------------------------------------------------
// vitest 把 `src/**/__tests__/**/*.ts` 全部视作 test 文件 —— fixture 必须
// 至少含一个 test 才不会被 "No test suite found" 报错。
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';
describe('web fixture sanity', () => {
  it('webMocks exposes all 3 kernel handles', () => {
    expect(typeof webMocks.tavilyExecute).toBe('function');
    expect(typeof webMocks.fetchWebContentExecute).toBe('function');
    expect(typeof webMocks.downloadFileInternal).toBe('function');
  });
  it('runWeb resolves with dispatcher-shaped result', async () => {
    webMocks.tavilyExecute.mockResolvedValueOnce({
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
