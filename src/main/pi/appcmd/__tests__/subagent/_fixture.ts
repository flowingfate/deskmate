/**
 * `subagent` 命令测试族的共享 fixture + helper。
 *
 * 模式同 `mcp/_fixture.ts` / `schedule/_fixture.ts`:
 *   - `vi.hoisted` 持有所有 mock fn(handler 入口替换),`export { mocks }`
 *     间接形态绕过 vitest transformer 的 "Cannot access X before
 *     initialization" 限制。
 *   - 业务内核(`spawnSingleInternal` / `spawnManyInternal`)整段被 mock —— 我们
 *     测的是 `subagent` 命令的 cmdline parsing / flag dispatch / 失败路径 /
 *     stdout 形态,**不**测 SubAgentManager 真实行为(那条路径由 SubAgentManager
 *     自己的测试覆盖)。
 *   - `SubAgentManager.getInstance()` 在 `_shared.ensureSpawnPrerequisites`
 *     里被调用,故 mock 整 class —— 返回一个 `getInstance()` thunk 给空 stub,
 *     避免触发真正 singleton 的初始化。
 *
 * **feature-gated 域**:`subagent` 命令由 `deskmateFeatureSubAgent` 守卫;
 * 测试环境 `featureFlagManager` 未 initialize → 所有 flag 默认 false →
 * `appcmd/index.ts` 不 register。fixture 顶层走 `has() ? noop : register`
 * 幂等模式(同 schedule 域)。
 */

import { vi } from 'vitest';

import { Tracer } from '@shared/log/trace';
import type { ToolContext } from '@main/pi/tools/types';

// ---------------------------------------------------------------------------
// 被 mock 模块的 stub state(必须 hoisted)
// ---------------------------------------------------------------------------

const subagentMocks = vi.hoisted(() => ({
  spawnSingleInternal: vi.fn(),
  spawnManyInternal: vi.fn(),
  // _shared.ensureSpawnPrerequisites 内部调 `SubAgentManager.getInstance()`,
  // 这个 fn 替换整个 class;每次调用返回同一个空对象 stub。命令永远不真正
  // 调 manager 的方法(那些调用都在被 mock 的 kernel 里)。
  getInstance: vi.fn(),
}));

export { subagentMocks };

vi.mock('@main/pi/appcmd/builtins/subagent/kernel/spawn', () => ({
  spawnSingleInternal: subagentMocks.spawnSingleInternal,
}));

vi.mock('@main/pi/appcmd/builtins/subagent/kernel/spawnMany', () => ({
  spawnManyInternal: subagentMocks.spawnManyInternal,
}));

vi.mock('@main/lib/subAgent/subAgentManager', () => ({
  SubAgentManager: {
    getInstance: subagentMocks.getInstance,
  },
}));

// ---------------------------------------------------------------------------
// 被测对象 —— 必须在 vi.mock 之后再 import
// ---------------------------------------------------------------------------
import { dispatchAppCommand, formatAppCmdContent } from '@main/pi/appcmd/dispatcher';
// side-effect import:把 helloCommand / mcpCommand / agentCommand 等灌进
// 单例 appCommands。subagentCommand 由 `deskmateFeatureSubAgent` 守卫;
// 测试环境 flag 默认 false → 不 register;故下面**幂等** register。
import { appCommands } from '@main/pi/appcmd/registry';
import '@main/pi/appcmd';
import { subagentCommand } from '@main/pi/appcmd/builtins/subagent';

if (!appCommands.has('subagent')) {
  appCommands.register(subagentCommand);
}

/**
 * `ToolContext` 默认值:`isSubAgent=false`,**包含 spawn 专属字段**(否则
 * `_shared.ensureSpawnPrerequisites` 会因缺字段而 exit 1)。各 test 覆盖
 * 时显式传递。
 */
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
    // 默认提供 spawn 专属字段以让 ensureSpawnPrerequisites 通过;
    // "测 ctx 字段缺失"的 case 自己显式置 undefined 覆盖。
    getSubAgentConfig: vi.fn(),
    getParentContextSummary: vi.fn(),
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
 * 用真实 dispatcher 跑一次 `subagent <subcommand> ...`,返回结构化输出。
 *
 * - 字符串入参:按空白切分,适合简单 case。
 * - 数组入参:精确传 argv,适合含空格 / 引号 / 复杂 flag value(如
 *   `["spawn", "researcher", "Do a thing with spaces"]`)。
 */
export async function runSubagent(
  argvOrCmdline: string | readonly string[],
  overrides?: Partial<ToolContext>,
): Promise<RunResult> {
  const argv = Array.isArray(argvOrCmdline)
    ? Array.from(argvOrCmdline)
    : argvOrCmdline.trim() === ''
      ? []
      : argvOrCmdline.trim().split(/\s+/);
  const ctx = makeCtx(overrides);
  const internal = await dispatchAppCommand(subagentCommand, argv, ctx);
  return {
    content: formatAppCmdContent(internal),
    stdout: internal.stdout,
    stderr: internal.stderr,
    exitCode: internal.exitCode,
  };
}

/** beforeEach 默认:全 mock reset + 给 getInstance 一个空 stub。 */
export function resetSubagentMocks(): void {
  for (const fn of Object.values(subagentMocks)) {
    fn.mockReset();
  }
  // 给 _shared 中的 `SubAgentManagerImpl.getInstance()` 提供一个 truthy 默认。
  // 内核 spawnSingleInternal / spawnManyInternal 已被 mock 替换,所以这个
  // 对象的方法**不会**被调到 —— 但 ensureSpawnPrerequisites 拿它当返回的
  // manager,需要至少非 undefined。
  subagentMocks.getInstance.mockReturnValue({});
}

// ---------------------------------------------------------------------------
// vitest 把 `src/**/__tests__/**/*.ts` 全部视作 test 文件 —— fixture 必须
// 至少含一个 test 才不会被 "No test suite found" 报错。
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';
describe('subagent fixture sanity', () => {
  it('subagentMocks 对象拥有期望字段', () => {
    expect(Object.keys(subagentMocks).sort()).toEqual(
      ['getInstance', 'spawnManyInternal', 'spawnSingleInternal'].sort(),
    );
  });
});
