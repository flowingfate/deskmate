/**
 * `agent` 命令测试族的共享 fixture + helper。与 `mcp/_fixture.ts` 完全同形。
 *
 * 设计:
 *   - 所有 kernel `*Internal()` 都用 `vi.hoisted` 替成 spy fn,subcommand 实测
 *     时拿到的就是这些 mock 的返回值。
 *   - owning `Profile.store` 的 `listAgents` 绑定到内部状态 spy,beforeEach 重置。
 *   - `runAgent('install foo --json')` 直接走真实 dispatcher,确保 dispatcher
 *     + parseFlags + 子命令路由都被测到,不只是 unit-test 单 subcommand。
 *
 * Vitest 限制:`vi.mock` factory 内部只能引用 `vi.hoisted` 出来的 const(必须
 * 同名 `const x = vi.hoisted(...)`)。`export const = vi.hoisted(...)` 会被
 * transformer 标记为 "Cannot access 'X' before initialization"。导出走
 * `export { x }` 间接形态。
 */

import { vi } from 'vitest';

import { Tracer } from '@shared/log/trace';
import type { AgentToolContext } from '@main/pi/tools/types';
import { testProfile } from '../../../../tools/__tests__/profileFixture';

// ---------------------------------------------------------------------------
// 被 mock 模块的 stub state(必须 hoisted —— vi.mock factory 在 import 前跑)
// ---------------------------------------------------------------------------

const agentMocks = vi.hoisted(() => ({
  createAgentInternal: vi.fn(),
  updateAgentInternal: vi.fn(),
  removeAgentInternal: vi.fn(),
  listAgentsInternal: vi.fn(),
  getStatusInternal: vi.fn(),
  setPrimaryInternal: vi.fn(),

  profileListAgents: vi.fn(),
}));

export { agentMocks };

vi.mock('@main/pi/appcmd/builtins/app/agent/kernel/createAgent', () => ({
  createAgentInternal: agentMocks.createAgentInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/agent/kernel/updateAgent', () => ({
  updateAgentInternal: agentMocks.updateAgentInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/agent/kernel/removeAgent', () => ({
  removeAgentInternal: agentMocks.removeAgentInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/agent/kernel/listAgents', () => ({
  listAgentsInternal: agentMocks.listAgentsInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/agent/kernel/getStatus', () => ({
  getStatusInternal: agentMocks.getStatusInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/agent/kernel/setPrimary', () => ({
  setPrimaryInternal: agentMocks.setPrimaryInternal,
}));


vi.spyOn(testProfile.store, 'listAgents').mockImplementation(() => agentMocks.profileListAgents());

// ---------------------------------------------------------------------------
// dispatch helper —— 必须在 vi.mock 之后再 import 被测对象。
// vitest 会把 vi.mock 提到 import 之上,但显式分段更清晰。
// ---------------------------------------------------------------------------
import { dispatchAppCommand, formatAppCmdContent } from '@main/pi/appcmd/dispatcher';
// side-effect import:把 agentCommand / mcpCommand / helloCommand 注册进 appCommands。
import '@main/pi/appcmd/builtins/app';
import { agentCommand } from '@main/pi/appcmd/builtins/app/agent';

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    profile: testProfile,
    profileId: 'profile-test',
    agentId: 'agent-test',
    sessionId: 'session-test',
    signal: new AbortController().signal,
    eventSender: null,
    tracer: new Tracer('test'),
    callId: 'call-test',
    chunkStream: null,
    ...overrides,
    mode: 'agent',
  };
}

export interface RunResult {
  content: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * 用真实 dispatcher 跑一次 `agent <subcommand> ...`,返回结构化输出。
 *
 * - 字符串入参:按空白切分,适合简单 case(如 `"install foo --json"`)。
 * - 数组入参:精确传 argv,适合含空格 / 引号 / 复杂 flag value 的 case。
 */
export async function runAgent(
  argvOrCmdline: string | readonly string[],
  overrides?: Partial<AgentToolContext>,
): Promise<RunResult> {
  const argv = Array.isArray(argvOrCmdline)
    ? Array.from(argvOrCmdline)
    : argvOrCmdline.trim() === ''
      ? []
      : argvOrCmdline.trim().split(/\s+/);
  const ctx = makeCtx(overrides);
  const internal = await dispatchAppCommand(agentCommand, argv, ctx);
  return {
    content: formatAppCmdContent(internal),
    stdout: internal.stdout,
    stderr: internal.stderr,
    exitCode: internal.exitCode,
  };
}

/** beforeEach 重置所有 kernel 与 owning Profile store spy。 */
export function resetAgentMocks(): void {
  for (const fn of Object.values(agentMocks)) {
    fn.mockReset();
  }
  agentMocks.profileListAgents.mockReturnValue([]);
}

// ---------------------------------------------------------------------------
// vitest 把 `src/**/__tests__/**/*.ts` 全部视作 test 文件。本 fixture 必须
// 至少含一个 test 才不会被 "No test suite found" 报错。沿用 `mcp/_fixture.ts`
// 同款 sanity test。
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';
describe('agent fixture sanity', () => {
  it('agentMocks 对象拥有期望字段', () => {
    expect(Object.keys(agentMocks).sort()).toEqual(
      [
        'createAgentInternal',
        'getStatusInternal',
        'listAgentsInternal',
        'profileListAgents',
        'removeAgentInternal',
        'setPrimaryInternal',
        'updateAgentInternal',
      ].sort(),
    );
  });
});
