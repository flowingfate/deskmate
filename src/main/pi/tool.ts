/**
 * pi 路径下的 tool 执行编排。
 *
 * Per-turn `ToolCatalog` 同时持 `pi.Tool[]`(给 LLM)与
 * `routes: Map<name, { kind: 'local' } | { kind: 'mcp'; serverName }>`
 * (执行 dispatch)。`executeToolCall` 按 route.kind 分发 —— **绝不**走"按
 * 裸 toolName 找源"的 API,从源头消灭多 MCP server 同名工具静默覆盖的
 * 歧义。
 *
 * `ask` 的 follow-up 只在 local 路径启用 —— 它的 tool result 后处理是
 * deskmate 内部约定,外部 MCP 不该被这条逻辑触碰。(Phase 8a 工具 LLM-name
 * 从 `request_interactive_input` 简化为 `ask`,内部类型名保留。)
 */

import type { ChoiceInteractionRequest, ChoiceInteractionResponse, FormInteractionRequest, FormInteractionResponse, InteractiveMap, InteractiveRequestType } from '@shared/types/interactiveRequestTypes';
import type { AskArgs, AskToolResult } from '@shared/types/askTypes';
import { request as humanLoopRequest } from '@shared/ipc/human-loop';
import { log } from '@main/log';
import { Tracer } from '@shared/log/trace';
import type { WebContents } from 'electron';

import { executeMcpToolOnServer } from './mcp';
import type { ToolCatalog } from './toolCatalog';
import { tools as localTools } from './tools/registry';
import type { ToolContext } from './tools/types';
import type { ToolResultImage } from '@shared/types/message';

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

  try {
    const route = catalog.routes.get(call.name);
    if (!route) {
      throw new Error(`Tool not in catalog: ${call.name}`);
    }

    const args = call.arguments ?? {};
    let rawContent: string;
    let images: ToolResultImage[] | undefined;
    let deliverables: readonly string[] | undefined;
    if (route.kind === 'local') {
      const result = await localTools.execute(call.name, args, ctx);
      if (!result.ok) throw new Error(result.error);
      rawContent = result.content;
      images = result.images;
      deliverables = result.deliverables;
    } else {
      // route.kind === 'mcp':server-scoped 执行,显式给定 serverName,避免
      // mcpClientManager 全局 toolToServerMap 的同名冲突歧义。
      rawContent = await executeMcpToolOnServer(route.serverName, call.name, args, ctx.signal);
    }

    // `ask` 的 follow-up 是 deskmate 内部 human-loop 约定,仅对本地实现生效。
    // 外部 MCP 即使取了同名工具(catalog 已禁止冲突,这条路径理论不可达;
    // 留作 belt-and-suspenders)也不触发。
    const content = route.kind === 'local' && call.name === 'ask'
      ? await runInteractiveInputFollowUp(rawContent, ctx)
      : rawContent;

    log.info(ctx.tracer.fields({
      msg: 'tool ok',
      isError: false,
      contentBytes: content.length,
    }, 'self'));
    return { toolCallId: call.id, toolName: call.name, content, isError: false, ...(images ? { images } : {}), ...(deliverables && deliverables.length > 0 ? { deliverables } : {}) };
  } catch (e) {
    log.warn(ctx.tracer.fields({
      msg: 'tool failed',
      isError: true,
      err: e,
    }, 'self'));
    return {
      toolCallId: call.id,
      toolName: call.name,
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

// ─── `ask` follow-up ───────────────────────────────────────────────────────

async function runInteractiveInputFollowUp(
  content: string,
  ctx: ToolContext,
): Promise<string> {
  let parsed: AskToolResult;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  if (!parsed?.success || !parsed.interactive_request) return content;

  const args: AskArgs = parsed.interactive_request;

  if (args.schema.kind === 'choice') {
    const id = generateInteractionId('choice');
    const request: ChoiceInteractionRequest = {
      chatSessionId: ctx.sessionId,
      title: args.title,
      description: args.description,
      submitLabel: args.submitLabel,
      skipLabel: args.skipLabel,
      mode: args.schema.mode,
      options: args.schema.options,
      minSelections: args.schema.minSelections,
      maxSelections: args.schema.maxSelections,
    };
    const cancel: ChoiceInteractionResponse = { action: 'skip', selectedValues: [] };
    const response = await sendHumanLoopRequest(ctx.eventSender, 'choice', id, request, cancel, ctx.signal);

    if (response.action === 'skip') {
      return JSON.stringify({
        success: true,
        status: 'skipped',
        request_type: 'choice',
        skipped_by_user: true,
        user_action: 'skip',
        message:
          'The user explicitly skipped or cancelled this interactive input request. Do not ask the same interactive question again unless the user later reopens the topic or provides new context.',
        selected_values: [],
      });
    }
    return JSON.stringify({
      success: true,
      status: 'submitted',
      request_type: 'choice',
      skipped_by_user: false,
      user_action: 'submit',
      message: 'The user submitted a response to this interactive input request.',
      selected_values: response.selectedValues || [],
    });
  }

  const id = generateInteractionId('form');
  const request: FormInteractionRequest = {
    chatSessionId: ctx.sessionId,
    title: args.title,
    description: args.description,
    submitLabel: args.submitLabel,
    skipLabel: args.skipLabel,
    fields: args.schema.fields.map((field) => ({
      key: field.key,
      label: field.label,
      control: field.control,
      type: field.control === 'checkbox' ? 'boolean' : field.control === 'number' ? 'double' : 'string',
      required: field.required,
      defaultValue: field.defaultValue,
      placeholder: field.placeholder,
      description: field.description,
      options: field.options,
      minSelections: field.minSelections,
      maxSelections: field.maxSelections,
    })),
  };
  const cancel: FormInteractionResponse = { action: 'skip', formValues: {} };
  const response = await sendHumanLoopRequest(ctx.eventSender, 'form', id, request, cancel, ctx.signal);

  if (response.action === 'skip') {
    return JSON.stringify({
      success: true,
      status: 'skipped',
      request_type: 'form',
      skipped_by_user: true,
      user_action: 'skip',
      message:
        'The user explicitly skipped or cancelled this interactive input request. Do not ask the same interactive question again unless the user later reopens the topic or provides new context.',
      form_values: null,
    });
  }
  return JSON.stringify({
    success: true,
    status: 'submitted',
    request_type: 'form',
    skipped_by_user: false,
    user_action: 'submit',
    message: 'The user submitted a response to this interactive input request.',
    form_values: response.formValues || {},
  });
}

function generateInteractionId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function sendHumanLoopRequest<K extends InteractiveRequestType>(
  sender: WebContents | null,
  type: K,
  id: string,
  request: InteractiveMap[K]['in'],
  cancelResponse: InteractiveMap[K]['out'],
  signal: AbortSignal,
): Promise<InteractiveMap[K]['out']> {
  if (!sender || sender.isDestroyed()) return cancelResponse;

  const task = humanLoopRequest(type, request, id).to(sender);
  if (signal.aborted) {
    task.resolve(cancelResponse);
  } else {
    signal.addEventListener('abort', () => { task.resolve(cancelResponse); }, { once: true });
  }
  return await task;
}
