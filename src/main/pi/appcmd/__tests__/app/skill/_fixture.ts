/**
 * `skill` 命令测试族的共享 fixture + helper。与 `agent/_fixture.ts` /
 * `mcp/_fixture.ts` 完全同形。
 *
 * 设计:
 *   - 所有 kernel `*Internal()` 都用 `vi.hoisted` 替成 spy fn,subcommand 实测
 *     时拿到的就是这些 mock 的返回值。
 *   - owning `Profile.store` 的 skills / getAgent 绑定到内部状态,beforeEach 重置。
 *   - `runSkill('install foo --dry-run')` 直接走真实 dispatcher,确保 dispatcher
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

const skillMocks = vi.hoisted(() => ({
  // kernel 全套(7 个 helper:install / uninstall / bind / unbind / list /
  // status / searchLibrary)
  installSkillInternal: vi.fn(),
  uninstallSkillInternal: vi.fn(),
  bindSkillInternal: vi.fn(),
  unbindSkillInternal: vi.fn(),
  listSkillsInternal: vi.fn(),
  getSkillStatusInternal: vi.fn(),
  searchLibraryInternal: vi.fn(),

  // owning Profile store state
  profileGetAgent: vi.fn(),
  profileSkillsItems: vi.fn(),
}));

export { skillMocks };

vi.mock('@main/pi/appcmd/builtins/app/skill/kernel/installSkill', () => ({
  installSkillInternal: skillMocks.installSkillInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/skill/kernel/uninstallSkill', () => ({
  uninstallSkillInternal: skillMocks.uninstallSkillInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/skill/kernel/bindSkill', () => ({
  bindSkillInternal: skillMocks.bindSkillInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/skill/kernel/unbindSkill', () => ({
  unbindSkillInternal: skillMocks.unbindSkillInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/skill/kernel/listSkills', () => ({
  listSkillsInternal: skillMocks.listSkillsInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/skill/kernel/getSkillStatus', () => ({
  getSkillStatusInternal: skillMocks.getSkillStatusInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/skill/kernel/searchLibrary', () => ({
  searchLibraryInternal: skillMocks.searchLibraryInternal,
}));


vi.spyOn(testProfile.store, 'getAgent').mockImplementation((id) => skillMocks.profileGetAgent(id));

// ---------------------------------------------------------------------------
// dispatch helper —— 必须在 vi.mock 之后再 import 被测对象。
// vitest 会把 vi.mock 提到 import 之上,但显式分段更清晰。
// ---------------------------------------------------------------------------
import { dispatchAppCommand, formatAppCmdContent } from '@main/pi/appcmd/dispatcher';
// side-effect import:把 skillCommand 等注册进 appCommands。
import '@main/pi/appcmd/builtins/app';
import { skillCommand } from '@main/pi/appcmd/builtins/app/skill';

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
 * 用真实 dispatcher 跑一次 `skill <subcommand> ...`,返回结构化输出。
 *
 * - 字符串入参:按空白切分,适合简单 case(如 `"install foo --dry-run"`)。
 * - 数组入参:精确传 argv,适合含空格 / 引号 / 复杂 flag value 的 case。
 */
export async function runSkill(
  argvOrCmdline: string | readonly string[],
  overrides?: Partial<AgentToolContext>,
): Promise<RunResult> {
  const argv = Array.isArray(argvOrCmdline)
    ? Array.from(argvOrCmdline)
    : argvOrCmdline.trim() === ''
      ? []
      : argvOrCmdline.trim().split(/\s+/);
  testProfile.store.skills.items = skillMocks.profileSkillsItems();
  const ctx = makeCtx(overrides);
  const internal = await dispatchAppCommand(skillCommand, argv, ctx);
  return {
    content: formatAppCmdContent(internal),
    stdout: internal.stdout,
    stderr: internal.stderr,
    exitCode: internal.exitCode,
  };
}

/** beforeEach 重置所有 kernel 与 owning Profile store state。 */
export function resetSkillMocks(): void {
  for (const fn of Object.values(skillMocks)) {
    fn.mockReset();
  }
  skillMocks.profileSkillsItems.mockReturnValue([]);
  skillMocks.profileGetAgent.mockResolvedValue(undefined);
  testProfile.store.skills.items = [];
}

// ---------------------------------------------------------------------------
// vitest 把 `src/**/__tests__/**/*.ts` 全部视作 test 文件。本 fixture 必须
// 至少含一个 test 才不会被 "No test suite found" 报错。沿用 `mcp/_fixture.ts`
// / `agent/_fixture.ts` 同款 sanity test。
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';
describe('skill fixture sanity', () => {
  it('skillMocks 对象拥有期望字段', () => {
    expect(Object.keys(skillMocks).sort()).toEqual(
      [
        'bindSkillInternal',
        'getSkillStatusInternal',
        'installSkillInternal',
        'listSkillsInternal',
        'profileGetAgent',
        'profileSkillsItems',
        'searchLibraryInternal',
        'unbindSkillInternal',
        'uninstallSkillInternal',
      ].sort(),
    );
  });
});
