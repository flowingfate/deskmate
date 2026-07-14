/**
 * pi 路径下的 tool 执行编排。
 *
 * Per-turn `ToolCatalog` 同时持 `pi.Tool[]`(给 LLM)与
 * `routes: Map<llmName, { kind: 'local'; toolName } | { kind: 'mcp'; serverName; toolName }>`。
 * MCP 的 llmName 是 `serverName/toolName`；所有 route 都显式保存原始
 * `toolName`，绝不按 `/` 反解，也绝不按裸 toolName 找源。
 *
 * MCP tool 的执行 server-scoped(显式 serverName),绝不回到按裸 toolName 查
 * 全局 map 的老路径。
 */

import { log } from '@main/log';
import { Tracer } from '@shared/log/trace';

import { executeMcpToolOnServer } from './mcp';
import type { ToolCatalog } from './toolCatalog';
import { tools as localTools } from './tools/registry';
import type { ToolContext } from './tools/types';
import type { ToolResultImage } from '@shared/persist/types'

// ─── 执行 ────────────────────────────────────────────────────────────────────

/** pi 流式层已解析后的 toolCall 入参 */
export interface ToolCallInput {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
  /** 工具回传的图片(如 read 一个图片文件)。仅 local 工具可产出。 */
  images?: ToolResultImage[];
  /** 工具产出 / 修改的用户可见文件 URI(如 `web download`)。仅 local 工具可产出。 */
  deliverables?: readonly string[];
}

/**
 * 执行一次工具调用,返回的内容保证是字符串(错误也以字符串形式回填,避免
 * 破坏 assistant/tool 配对)。
 *
 * 注意 `ctx.tracer` 应该是 caller 已经 derive 出的 `chat.tool` span —— 这里
 * 不再 derive,因为同一 catalog 内并行多个 tool call 时各自的 span 已经在
 * caller 处建好(每个 tool 各自独立 span,共享 turn 的 psid)。
 */
export async function executeToolCall(
  call: ToolCallInput,
  catalog: ToolCatalog,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  log.info(ctx.tracer.fields({
    msg: 'tool start',
    argsBytes: typeof call.arguments === 'object' ? JSON.stringify(call.arguments).length : 0,
  }));

  const route = catalog.getRoute(call.name);
  const toolName = route?.toolName ?? call.name;

  try {
    if (!route) {
      throw new Error(`Tool not in catalog: ${call.name}`);
    }

    const args = call.arguments ?? {};
    let rawContent: string;
    let images: ToolResultImage[] | undefined;
    let deliverables: readonly string[] | undefined;
    if (route.kind === 'local') {
      const result = await localTools.execute(route.toolName, args, ctx);
      if (!result.ok) throw new Error(result.error);
      rawContent = result.content;
      images = result.images;
      deliverables = result.deliverables;
    } else {
      // route.kind === 'mcp':server-scoped 执行,显式给定 serverName,避免
      // mcpClientManager 全局 toolToServerMap 的同名冲突歧义。
      rawContent = await executeMcpToolOnServer(route.serverName, route.toolName, args, ctx.signal);
    }

    log.info(ctx.tracer.fields({
      msg: 'tool ok',
      isError: false,
      contentBytes: rawContent.length,
    }, 'self'));
    return { toolCallId: call.id, toolName, content: rawContent, isError: false, ...(images ? { images } : {}), ...(deliverables && deliverables.length > 0 ? { deliverables } : {}) };
  } catch (e) {
    log.warn(ctx.tracer.fields({
      msg: 'tool failed',
      isError: true,
      err: e,
    }, 'self'));
    return {
      toolCallId: call.id,
      toolName,
      content: e instanceof Error ? e.message : String(e),
      isError: true,
    };
  }
}

/**
 * 给 caller(turn loop / sub-agent)准备本轮 tool call 的 `chat.tool` span。
 * 拆出来让 RegularSession / JobRun / SubAgentSession 三处共用同一份 tracer
 * 形态;noop 路径保持完整 derive + bind 不变。
 */
export function deriveToolTracer(
  parent: Tracer | undefined,
  call: ToolCallInput,
  ids: { profileId: string; agentId: string; sessionId: string },
): Tracer {
  return (parent ?? Tracer.noop).derive().bind({
    mod: 'chat.tool',
    chatSessionId: ids.sessionId,
    agentId: ids.agentId,
    profileId: ids.profileId,
    toolName: call.name,
    callId: call.id,
  });
}

