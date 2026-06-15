/**
 * sub-agent spawn 业务内核 —— 单 task 派生。
 *
 * 角色:被 `appcmd/builtins/subagent/spawn.ts` 调用,把"sub-agent 名 + task
 * + 是否共享父上下文"翻译成 `SubAgentManager.spawnSubAgent(...)` 调用。
 *
 * 与老 `pi/tools/spawnSubagents.ts` 的关系:
 *   - 业务逻辑(查 SubAgentConfig → 按需 build parent context → 调
 *     SubAgentManager → 包装回结果)从 LocalTool handler 整段平移过来,
 *     一字不改;唯一变化是 ctx 形态 —— 不再依赖 ToolContext 的全部字段,
 *     只接收 spawn 真正需要的部分。
 *   - 校验(`isSubAgent` 递归 / `getSubAgentConfig` / `getParentContextSummary`
 *     缺失)放在 caller 层(`spawn.ts` 子命令)做,本 kernel 假定 ctx 已合法。
 *
 * 输出:走 LLM 友好的 JSON envelope `{ success, data | error }`,与
 * **现存 renderer view 完全兼容** —— `SubAgentToolCallView` 解析的就是
 * 这个 result 形态。
 */
import type { SubAgentManager } from '@main/lib/subAgent/subAgentManager';
import type { SubAgentConfig } from '@shared/types/profileTypes';
import type { WebContents } from 'electron';
import type { Tracer } from '@shared/log/trace';

/**
 * spawn 单 task 所需的 ctx 子集 —— 显式声明,避免把 `AppCmdContext`
 * 全部字段顺手 leak 给业务层。
 */
export interface SpawnSingleCtx {
  profileId: string;
  agentId: string;
  sessionId: string;
  signal: AbortSignal;
  tracer: Tracer;
  eventSender: WebContents | null;
  callId: string;
  /** 由 caller 校验过非 undefined 才传进来 —— 内核直接调,不再判空。 */
  getSubAgentConfig: (name: string) => Promise<SubAgentConfig | undefined>;
}

export interface SpawnSingleArgs {
  subAgentName: string;
  task: string;
  shareContext: boolean;
}

export interface SpawnSingleResult {
  /** LLM 看到的最终字符串(JSON envelope)—— caller 直接 `ctx.print(content)`。 */
  content: string;
  /** 任务是否成功;caller 用来决定 exit code(失败 → 1)。 */
  ok: boolean;
}

/**
 * 单 task 派生 + 结果包装。失败统一走 `{ success: false, error }` envelope ——
 * 不抛,与老 LocalTool 行为一致;LLM 拿到 envelope 后自己决定如何应对。
 */
export async function spawnSingleInternal(
  manager: SubAgentManager,
  ctx: SpawnSingleCtx,
  args: SpawnSingleArgs,
): Promise<SpawnSingleResult> {
  const subAgentConfig = await ctx.getSubAgentConfig(args.subAgentName);
  if (!subAgentConfig) {
    return {
      content: JSON.stringify({
        success: false,
        error: `Sub-agent "${args.subAgentName}" not found or not enabled for this agent`,
      }),
      ok: false,
    };
  }

  // share_context + 非 isolated 才组装 parent context(后者由 sub-agent
  // 自己再过滤)。
  let parentContext: string | undefined;
  if (args.shareContext && subAgentConfig.context_access !== 'isolated') {
    parentContext = await manager.buildParentContext(
      ctx.sessionId,
      subAgentConfig.context_access,
      true,
    );
  }

  const result = await manager.spawnSubAgent({
    parentSessionId: ctx.sessionId,
    parentAgentId: ctx.agentId,
    profileId: ctx.profileId,
    subAgentName: args.subAgentName,
    task: args.task,
    parentContext,
    cancellationSignal: ctx.signal,
    eventSender: ctx.eventSender ?? undefined,
    correlationId: ctx.callId,
    tracer: ctx.tracer,
  });

  if (result.success) {
    return {
      content: JSON.stringify({
        success: true,
        data:
          `Sub-agent "${args.subAgentName}" completed task ` +
          `(${result.turnCount} turns, ${(result.durationMs / 1000).toFixed(1)}s):\n\n` +
          result.result,
      }),
      ok: true,
    };
  }

  return {
    content: JSON.stringify({
      success: false,
      error: `Sub-agent "${args.subAgentName}" failed: ${result.error}`,
    }),
    ok: false,
  };
}
