/**
 * Resume 判定 —— 启动期决定怎么把"上次没收尾的 turn"接回去跑。
 *
 * 触发时机：`BaseSession.restore()` 完毕后，若 `SessionDataFile.turn.status ===
 * 'running'`（1-bit flag 位于 `shared/persist/types/index.ts`），就调一次 `planResume`，
 * 把结果缓存到 `BaseSession.pendingResume`；下一次 entry (startStream / retryStream)
 * 在常规流程前优先消化它。turn=idle 直接返 `markIdle`。
 *
 * 策略矩阵：
 *   ┌──────────────┬──────────────────────────┬───────────────────────┐
 *   │ 尾部消息     │ outcome / tool_calls     │ ResumeAction          │
 *   ├──────────────┼──────────────────────────┼───────────────────────┤
 *   │ 空 / user    │ —                        │ startTurn             │
 *   │ assistant    │ stop, 无 tool_calls      │ markIdle              │
 *   │ assistant    │ stop, 有 call 缺 response│ runMissingTools(ids)  │
 *   │ assistant    │ stop, 所有 call 有 resp  │ continueLoop          │
 *   │ assistant    │ aborted/error/maxIter    │ markTerminal(outcome) │
 *   └──────────────┴──────────────────────────┴───────────────────────┘
 *
 * 纯函数：只看 messages 尾部；不读盘、不写盘、不发 IPC。
 */

import type { AssistantOutcome, Message } from '@shared/persist/types'

/**
 * `planResume` 看 messages 尾部得出该返回什么 ResumeAction。结果会缓存在
 * `BaseSession.pendingResume`,主进程下一个 entry (startStream / retryStream /
 * editUserMessage) 在自身工作前消费。当前实现把所有非平凡分支(runMissingTools /
 * continueLoop / startTurn)都收敛回 `aborted + idle`,等用户主动重启 turn ——
 * 这是终态,不再扩展"自动续跑";异常状态由 `loadChatSessionSnapshot` 的
 * `errorMessage` 字段透到 UI 显示 ErrorBar + Retry 按钮。
 */
export type ResumeAction =
  | { kind: 'startTurn' }
  | { kind: 'runMissingTools'; toolCallIds: string[] }
  | { kind: 'continueLoop' }
  | { kind: 'markIdle' }
  | { kind: 'markTerminal'; outcome: AssistantOutcome };

export function planResume(messages: readonly Message[]): ResumeAction {
  if (messages.length === 0) return { kind: 'markIdle' };
  const last = messages[messages.length - 1];
  if (last.role === 'user') return { kind: 'startTurn' };

  const outcome: AssistantOutcome = last.outcome ?? { kind: 'stop' };
  if (outcome.kind === 'aborted' || outcome.kind === 'error' || outcome.kind === 'maxIter') {
    return { kind: 'markTerminal', outcome };
  }
  // outcome.kind === 'stop'
  if (last.tool_calls.length === 0) return { kind: 'markIdle' };
  const missing: string[] = [];
  for (const tc of last.tool_calls) if (!tc.response) missing.push(tc.id);
  return missing.length === 0
    ? { kind: 'continueLoop' }
    : { kind: 'runMissingTools', toolCallIds: missing };
}
