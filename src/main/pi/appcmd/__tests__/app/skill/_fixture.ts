/**
 * `skill` 命令测试族的共享 fixture + helper。与 `agent/_fixture.ts` /
 * `mcp/_fixture.ts` 完全同形。
 *
 * 设计:
 *   - 所有 kernel `*Internal()` 都用 `vi.hoisted` 替成 spy fn,subcommand 实测
 *     时拿到的就是这些 mock 的返回值。
 *   - persist 层(`Profiles.get().active() / activeSync()` + `profile.skills.items`
 *     + `getAgent`)统一 mock 为对一个内部状态 obj 的读写,beforeEach 重置。
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

  // persist 层(uninstall.ts 走 activeSync 做 dry-run 提示;
  // _shared.resolveDefaultAgentTarget 走 activeSync + getAgent;
  // bind.ts kernel 自己也读 activeSync 但是 kernel 已被 mock 掉了)
  profileActiveSync: vi.fn(),
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

vi.mock('@main/persist', () => ({
  Profiles: {
    get: () => ({
      activeSync: skillMocks.profileActiveSync,
    }),
  },
}));

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
  const ctx = makeCtx(overrides);
  const internal = await dispatchAppCommand(skillCommand, argv, ctx);
  return {
    content: formatAppCmdContent(internal),
    stdout: internal.stdout,
    stderr: internal.stderr,
    exitCode: internal.exitCode,
  };
}

/**
 * beforeEach 默认状态:
 *   - profile.activeSync() 成功(空 skills,getAgent → undefined)
 *   - 所有 kernel mock 未配置(测试自己 mockResolvedValue / mockReturnValue)
 */
export function resetSkillMocks(): void {
  for (const fn of Object.values(skillMocks)) {
    fn.mockReset();
  }
  skillMocks.profileSkillsItems.mockReturnValue([]);
  skillMocks.profileGetAgent.mockResolvedValue(undefined);
  skillMocks.profileActiveSync.mockImplementation(() => ({
    skills: { items: skillMocks.profileSkillsItems() },
    getAgent: skillMocks.profileGetAgent,
  }));
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
        'profileActiveSync',
        'profileGetAgent',
        'profileSkillsItems',
        'searchLibraryInternal',
        'unbindSkillInternal',
        'uninstallSkillInternal',
      ].sort(),
    );
  });
});
