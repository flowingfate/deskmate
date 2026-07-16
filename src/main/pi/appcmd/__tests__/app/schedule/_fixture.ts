/**
 * `schedule` 命令测试族的共享 fixture + helper。
 *
 * 关键点(与 `__tests__/mcp/_fixture.ts` 同纪律):
 *   - mock 走 `vi.hoisted(...)` —— vi.mock factory 在 import 之前执行,
 *     工厂内**只能**引用同名 `const x = vi.hoisted(...)`。
 *   - 用 `export { scheduleMocks }`(而非 `export const = vi.hoisted(...)`)
 *     间接导出,否则 vitest transformer 报 "Cannot access 'X' before
 *     initialization"。
 *   - 被 mock 的真实模块:5 个 schedule kernel 文件(全部使用 schedulerManager
 *     的薄包装)。这样 subcommand 测试只验"argv 解析 + flag 校验 + kernel
 *     调用契约 + 输出格式",**不**复测 schedulerManager 本身的行为。
 */

import { vi } from 'vitest';

import { Tracer } from '@shared/log/trace';
import type { AgentToolContext } from '@main/pi/tools/types';

// ---------------------------------------------------------------------------
// 被 mock 模块的 stub state(必须 hoisted)
// ---------------------------------------------------------------------------

const scheduleMocks = vi.hoisted(() => ({
  createJobInternal: vi.fn(),
  listJobsInternal: vi.fn(),
  updateJobInternal: vi.fn(),
  deleteJobInternal: vi.fn(),
  runJobNowInternal: vi.fn(),
}));

export { scheduleMocks };

vi.mock('@main/pi/appcmd/builtins/app/schedule/kernel/createJob', () => ({
  createJobInternal: scheduleMocks.createJobInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/schedule/kernel/listJobs', () => ({
  listJobsInternal: scheduleMocks.listJobsInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/schedule/kernel/updateJob', () => ({
  updateJobInternal: scheduleMocks.updateJobInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/schedule/kernel/deleteJob', () => ({
  deleteJobInternal: scheduleMocks.deleteJobInternal,
}));

vi.mock('@main/pi/appcmd/builtins/app/schedule/kernel/runJobNow', () => ({
  runJobNowInternal: scheduleMocks.runJobNowInternal,
}));

// ---------------------------------------------------------------------------
// 被测对象 —— 必须在 vi.mock 之后再 import
// ---------------------------------------------------------------------------
import { dispatchAppCommand, formatAppCmdContent } from '@main/pi/appcmd/dispatcher';
// Side-effect import registers all app commands, including schedule.
import '@main/pi/appcmd/builtins/app';
import { scheduleCommand } from '@main/pi/appcmd/builtins/app/schedule';


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
 * 用真实 dispatcher 跑一次 `schedule <subcommand> ...`,返回结构化输出。
 *
 * - 字符串入参:按空白切分,适合简单 case(如 `"create foo --cron \"...\""`
 *   这种含引号字段**不要**用字符串形态,改传数组)。
 * - 数组入参:精确传 argv,适合含空格 / 引号 / 复杂 flag value 的 case。
 */
export async function runSchedule(
  argvOrCmdline: string | readonly string[],
  overrides?: Partial<AgentToolContext>,
): Promise<RunResult> {
  const argv = Array.isArray(argvOrCmdline)
    ? Array.from(argvOrCmdline)
    : argvOrCmdline.trim() === ''
      ? []
      : argvOrCmdline.trim().split(/\s+/);
  const ctx = makeCtx(overrides);
  const internal = await dispatchAppCommand(scheduleCommand, argv, ctx);
  return {
    content: formatAppCmdContent(internal),
    stdout: internal.stdout,
    stderr: internal.stderr,
    exitCode: internal.exitCode,
  };
}

/** beforeEach 默认:全 mock reset 到 undefined return。各 test 自行 set return value。 */
export function resetScheduleMocks(): void {
  for (const fn of Object.values(scheduleMocks)) {
    fn.mockReset();
  }
}

// ---------------------------------------------------------------------------
// vitest 把 `src/**/__tests__/**/*.ts` 全部视作 test 文件 —— fixture 必须
// 至少含一个 test 才不会被 "No test suite found" 报错。
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';
describe('schedule fixture sanity', () => {
  it('scheduleMocks 对象拥有期望字段', () => {
    expect(Object.keys(scheduleMocks).sort()).toEqual(
      [
        'createJobInternal',
        'deleteJobInternal',
        'listJobsInternal',
        'runJobNowInternal',
        'updateJobInternal',
      ].sort(),
    );
  });
});
