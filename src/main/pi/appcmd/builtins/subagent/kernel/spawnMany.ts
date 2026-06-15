/**
 * sub-agent spawn-many 业务内核 —— 并行多 task 派生。
 *
 * 角色:被 `appcmd/builtins/subagent/spawn-many.ts` 调用,把"N 个 task 配置
 * (每个含 name / task / shareContext)"展开成并行 `spawnSubAgent` 调用,
 * 再合成 LLM 可见的 markdown 段落 + JSON envelope。
 *
 * 与老 `pi/tools/spawnSubagents.ts::spawnSubagents.handler` 的关系:
 *   - 业务逻辑(`MAX_PARALLEL_TASKS` slice 截断 → per-task 独立 build parent
 *     context → `Promise.allSettled` → 失败 task 兜底为 failed result →
 *     markdown 拼接)整段平移过来,一字不改。
 *   - **绝不**走 `spawnMultipleSubAgents`:那条签名只接一个共享 parent
 *     context,per-task 的 shareContext 差异在那里会被丢弃,等价 bug。
 *   - 校验(`isSubAgent` 递归 / `getSubAgentConfig` 缺失)放在 caller 层做。
 *
 * 输出形态:`{ success, data: <markdown> }`,与 **现存
 * `ParallelSubAgentsToolCallView` 完全兼容**。
 */
import type { SubAgentManager } from '@main/lib/subAgent/subAgentManager';
import { SUB_AGENT_LIMITS, type SubAgentConfig } from '@shared/types/profileTypes';
import type { WebContents } from 'electron';
import type { Tracer } from '@shared/log/trace';

/** spawn-many 所需的 ctx 子集,语义同 SpawnSingleCtx。 */
export interface SpawnManyCtx {
  profileId: string;
  agentId: string;
  sessionId: string;
  signal: AbortSignal;
  tracer: Tracer;
  eventSender: WebContents | null;
  callId: string;
  getSubAgentConfig: (name: string) => Promise<SubAgentConfig | undefined>;
}

export interface SpawnManyTask {
  subAgentName: string;
  task: string;
  shareContext: boolean;
}

export interface SpawnManyArgs {
  /** caller 已保证非空,内核直接展开。 */
  tasks: readonly SpawnManyTask[];
}

export interface SpawnManyResult {
  content: string;
  /** 仅当所有 task 都成功才 true,与老 spawn_subagents.allSuccess 等价。 */
  ok: boolean;
}

/**
 * 并行派生 N 个 task。`MAX_PARALLEL_TASKS` 上限保留**两层**防护:
 *   ① 此处 `slice` 截断让"一次性投 100 task"不会爆并发;
 *   ② `SubAgentManager.spawnSubAgent` 内部按 `parentChildMap.size` 计数兜底,
 *      跨 spawn 调用累计的全局并发也会被拒。
 */
export async function spawnManyInternal(
  manager: SubAgentManager,
  ctx: SpawnManyCtx,
  args: SpawnManyArgs,
): Promise<SpawnManyResult> {
  const limitedTasks = args.tasks.slice(0, SUB_AGENT_LIMITS.MAX_PARALLEL_TASKS);

  const promises = limitedTasks.map(async (task, index) => {
    let parentContext: string | undefined;
    if (task.shareContext) {
      const subAgentConfig = await ctx.getSubAgentConfig(task.subAgentName);
      // 找不到 sub-agent 时不直接抛 —— spawnSubAgent 自己会回错;
      // 这里只决定是否要建 parentContext。
      if (subAgentConfig && subAgentConfig.context_access !== 'isolated') {
        parentContext = await manager.buildParentContext(
          ctx.sessionId,
          subAgentConfig.context_access,
          true,
        );
      }
    }
    return manager.spawnSubAgent({
      parentSessionId: ctx.sessionId,
      parentAgentId: ctx.agentId,
      profileId: ctx.profileId,
      subAgentName: task.subAgentName,
      task: task.task,
      parentContext,
      cancellationSignal: ctx.signal,
      eventSender: ctx.eventSender ?? undefined,
      // 与 spawnMultipleSubAgents 一致的 per-sub-task correlationId 格式 ——
      // renderer 端 sub-agent 卡片按 `{parent}_${idx}` 关联。
      correlationId: `${ctx.callId}_${index}`,
      tracer: ctx.tracer,
    });
  });

  // Promise.allSettled:单 task 失败不影响其它。Rejected 时统一格式化为
  // failed result,与老 spawnMultipleSubAgents 行为等价。
  const settled = await Promise.allSettled(promises);
  const results = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    return {
      subAgentName: limitedTasks[i].subAgentName,
      taskId: `failed_${i}`,
      success: false,
      error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      turnCount: 0,
      durationMs: 0,
    };
  });

  const formatted = results
    .map(
      (r, i) =>
        `### Task ${i + 1}: ${r.subAgentName}\n` +
        `**Status**: ${r.success ? '✅ Completed' : '❌ Failed'}\n` +
        `**Duration**: ${r.durationMs}ms | **Turns**: ${r.turnCount}\n\n` +
        (r.success ? r.result : `Error: ${r.error}`),
    )
    .join('\n\n---\n\n');

  const allSuccess = results.every((r) => r.success);

  return {
    content: JSON.stringify({ success: allSuccess, data: formatted }),
    ok: allSuccess,
  };
}
