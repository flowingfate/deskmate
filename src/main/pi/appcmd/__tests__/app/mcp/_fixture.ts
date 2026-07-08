/**
 * `mcp` 命令测试族的共享 fixture + helper。
 *
 * 范式:
 *   - 顶层 `vi.mock(...)` 把所有 internal helper + mcpClientManager + Profiles
 *     替换为 `vi.fn()`。被测对象只看到 stub,不触网 / 不写盘。
 *   - 通过 `dispatchAppCommand` 直接驱动 `mcpCommand.run(argv, ctx)`,然后
 *     用 `formatAppCmdContent(result)` 把 stdout/stderr/exitCode 拼成
 *     LLM 可见字符串 —— 与生产路径完全一致。
 *   - 每个测试在 `beforeEach` 里 `resetMcpMocks()`,避免跨用例污染。
 *
 * 重要:`vi.mock` 是 hoist 的,被 mock 的模块依赖必须用 `vi.hoisted` 包返回
 * factory,subcommand 测试才能在 `beforeEach` 里 mutate 行为。
 */

import { vi } from 'vitest';

import { Tracer } from '@shared/log/trace';
import type { ToolContext } from '@main/pi/tools/types';

// ---------------------------------------------------------------------------
// 被 mock 模块的 stub state(必须 hoisted —— vi.mock factory 在 import 前跑)
// ---------------------------------------------------------------------------

// hoisted 对象:必须在 vi.mock factory 跑之前就有(vitest 把 vi.mock 提
// 到 import 之上)。Vitest 限制:`vi.mock` factory 内部**只能引用**通过
// `vi.hoisted(...)` 直接绑定的 const(同名 `const x = vi.hoisted(...)`)。
// 任何 `export const = vi.hoisted(...)` 或链式重导都会被 transformer
// 标记为 "Cannot access 'X' before initialization"。
const mcpMocks = vi.hoisted(() => ({
  createServerInternal: vi.fn(),
  updateServerInternal: vi.fn(),
  getStatusInternal: vi.fn(),

  mcpDelete: vi.fn(),
  mcpConnect: vi.fn(),
  mcpDisconnect: vi.fn(),
  mcpReconnect: vi.fn(),
  getMcpServerRuntimeState: vi.fn(),

  profileMcpGet: vi.fn(),
  profileActive: vi.fn(),
  profileActiveSync: vi.fn(),
}));

/**
 * 用 `export { mcpMocks }`(而非 `export const mcpMocks = vi.hoisted(...)`)
 * 把 hoisted 实例对外暴露。后者会被 vitest transformer 标记为
 * "Cannot access 'mcpMocks' before initialization"。
 */
export { mcpMocks };


vi.mock('@main/pi/appcmd/builtins/app/mcp/kernel/createServer', () => ({
  createServerInternal: mcpMocks.createServerInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/mcp/kernel/updateServer', () => ({
  updateServerInternal: mcpMocks.updateServerInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/mcp/kernel/getStatus', () => ({
  getStatusInternal: mcpMocks.getStatusInternal,
}));


vi.mock('@main/lib/mcpRuntime', () => ({
  mcpClientManager: {
    delete: mcpMocks.mcpDelete,
    connect: mcpMocks.mcpConnect,
    disconnect: mcpMocks.mcpDisconnect,
    reconnect: mcpMocks.mcpReconnect,
    getMcpServerRuntimeState: mcpMocks.getMcpServerRuntimeState,
  },
}));

vi.mock('@main/persist', () => ({
  Profiles: {
    get: () => ({
      active: mcpMocks.profileActive,
      activeSync: mcpMocks.profileActiveSync,
    }),
  },
}));

// ---------------------------------------------------------------------------
// dispatch helper —— 必须在 vi.mock 之后再 import 被测对象。
// vitest 会把 vi.mock 提到 import 之上,但显式分段更清晰。
// ---------------------------------------------------------------------------
import { dispatchAppCommand, formatAppCmdContent } from '@main/pi/appcmd/dispatcher';
// side-effect import:把 helloCommand / mcpCommand 注册进单例 appCommands。
// 单测在 `router.test.ts` 里直接对 `appCommands.has('mcp')` 做断言。
import '@main/pi/appcmd/builtins/app';
import { mcpCommand } from '@main/pi/appcmd/builtins/app/mcp';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    profileId: 'profile-test',
    agentId: 'agent-test',
    sessionId: 'session-test',
    signal: new AbortController().signal,
    eventSender: null,
    tracer: new Tracer('test'),
    isSubAgent: false,
    callId: 'call-test',
    chunkStream: null,
    ...overrides,
  };
}

export interface RunResult {
  content: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * 用真实 dispatcher 跑一次 `mcp <subcommand> ...`,返回结构化输出。
 *
 * - 字符串入参:按空白切分,适合简单 case(如 `"install foo --json"`)。
 * - 数组入参:精确传 argv,适合含空格 / 引号 / 复杂 flag value 的 case。
 */
export async function runMcp(
  argvOrCmdline: string | readonly string[],
  overrides?: Partial<ToolContext>,
): Promise<RunResult> {
  const argv = Array.isArray(argvOrCmdline)
    ? Array.from(argvOrCmdline)
    : argvOrCmdline.trim() === ''
      ? []
      : argvOrCmdline.trim().split(/\s+/);
  const ctx = makeCtx(overrides);
  const internal = await dispatchAppCommand(mcpCommand, argv, ctx);
  return {
    content: formatAppCmdContent(internal),
    stdout: internal.stdout,
    stderr: internal.stderr,
    exitCode: internal.exitCode,
  };
}

/** beforeEach 默认状态 —— 没有 active profile 失败 / 没有 server 安装 / 空 runtime。 */
export function resetMcpMocks(): void {
  for (const fn of Object.values(mcpMocks)) {
    fn.mockReset();
  }
  mcpMocks.profileMcpGet.mockReturnValue(undefined);
  mcpMocks.profileActive.mockResolvedValue({ mcp: { get: mcpMocks.profileMcpGet } });
  mcpMocks.profileActiveSync.mockReturnValue({ mcp: { get: mcpMocks.profileMcpGet } });
  mcpMocks.getMcpServerRuntimeState.mockReturnValue(undefined);
}

// ---------------------------------------------------------------------------
// vitest 把 `src/**/__tests__/**/*.ts` 全部视作 test 文件。本 fixture 必须
// 至少含一个 test 才不会被 "No test suite found" 报错。沿用 `fixtures/index.ts`
// 同款 sanity test。
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';
describe('mcp fixture sanity', () => {
  it('mcpMocks 对象拥有期望字段', () => {
    expect(Object.keys(mcpMocks).sort()).toEqual(
      [
        'createServerInternal',
        'getMcpServerRuntimeState',
        'getStatusInternal',
        'mcpConnect',
        'mcpDelete',
        'mcpDisconnect',
        'mcpReconnect',
        'profileActive',
        'profileActiveSync',
        'profileMcpGet',
        'updateServerInternal',
      ].sort(),
    );
  });
});
