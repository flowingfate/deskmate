/**
 * SubAgentSession — sub-agent 一轮对话的最小可复用单元。
 *
 * 不继承 BaseSession（落盘形态）—— sub-agent 是内存 + wrapper 控制 turn 节奏的
 * 第三种形态，强行借 BaseSession.runTurnLoop 会把 30 轮 for 嵌套进来，wrapper
 * 想要 "1 次调用 = 1 轮 LLM + 工具 + 压缩决策" 的原子，自己写更直接。
 *
 * 复用的 pi 原子能力：
 * - pi.stream（动态 import）：流式 + tool call args 自动 parse
 * - messageBridge.toPiContext / fromPiAssistantMessage：chatTypes <-> pi.Message
 * - pi.checkAndCompress：跨形态共用的压缩链路（阈值可注入）
 * - resolveModel / resolveCredentials：跨 provider model + apiKey + baseUrl 解析
 * - pi.executeToolCall：local / mcp tool 执行 + isSubAgent 透传
 * - pi.errors.classifyError：服务端 overflow 走强制压缩重试
 *
 * 消息历史只放在 this.messages（内存数组）—— 没有任何持久化形态需要同步。
 */

import type {
  AssistantMessage as PiAssistantMessage,
  Api as PiApi,
  Context as PiContext,
  Model as PiModel,
  Usage as PiUsage,
} from '@earendil-works/pi-ai';

import type {
  AssistantMessage,
  Message,
  ToolResult,
  UserMessage,
} from '@shared/types/message';
import type { ContextState } from '@shared/types/agentChatTypes';

import { parseAgentModel } from '@shared/utils/agentModelId';
import { CancellationError } from '@main/lib/utilities/errors';
import { log } from '@main/log';

import { resolveModel, resolveCredentials } from '@main/pi/model';
import { toPiContext, fromPiAssistantMessage } from '@main/pi/utils/messageBridge';
import { deriveToolTracer, executeToolCall } from '@main/pi/tool';
import type { ToolCatalog } from '@main/pi/toolCatalog';
import type { ToolContext } from '@main/pi/tools/types';
import { checkAndCompress } from '@main/pi/compression';
import { classifyError } from '@main/pi/errors';
import { Tracer } from '@shared/log/trace';
const logger = log;

export interface SubAgentSessionInit {
  profileId: string;
  /**
   * 透传给本地工具 `ToolContext.agentId` 的**父 agent id**。
   * skill / schedule 类本地工具(searchSkills / applySkillToAgents /
   * createSchedule 等)用它定位"当前 agent" 配置;sub-agent 不持久化,
   * 不能用自己的临时 id。
   */
  agentId: string;
  /**
   * 透传给本地工具 `ToolContext.sessionId` 的**父 session id**。
   * createSchedule 等 session 维度的本地工具要把工件绑回父 session。
   */
  sessionId: string;
  /** `provider::id` 复合 key。 */
  model: string;
  /** 压缩触发阈值（0..1）。默认 0.85；sub-agent 传 0.60。 */
  compressionThreshold: number;
}

/** wrapper 通过 hooks 注入 step update 与 tool result 后处理。 */
export interface SubAgentSessionHooks {
  /** LLM 流式 text 增量（用于 UI step） */
  onLlmStreaming?: (text: string) => void;
  /** 即将执行某个 tool call（解析后的 arguments）。 */
  onToolStart?: (toolCallId: string, toolName: string, toolArgs: Record<string, unknown>) => void;
  /** tool 执行完成（成功）。 */
  onToolDone?: (toolCallId: string, toolName: string, durationMs: number, toolResultLength: number) => void;
  /** tool 执行失败。 */
  onToolError?: (toolCallId: string, toolName: string, durationMs: number) => void;
  /**
   * tool 结果后处理：wrapper 可在这里做截断 / 蒸馏。返回值替换原始 content。
   * 入参 args 已经 parse 过；rawContent 是 executeToolCall 拿到的原始字符串。
   */
  onToolResultPostprocess?: (toolName: string, toolArgs: Record<string, unknown>, rawContent: string) => Promise<string>;
}

export interface RunTurnArgs {
  systemPrompt: string;
  /**
   * 本轮工具目录。caller(SubAgentChat)在每轮 runTurn 之前用
   * `buildToolCatalogForSubAgent(cfg, resolvedMcpServers)` 构建,session
   * 不再自己接 SubAgentToolDef[] —— catalog 包含 `pi.Tool` specs(给 LLM)
   * 与 server-scoped 路由(给 executeToolCall)。
   */
  catalog: ToolCatalog;
  signal: AbortSignal;
  hooks: SubAgentSessionHooks;
  /**
   * 主链路 tracer:复用同一 tid;本轮内 LLM / tool 作为它的子 span。
   * 缺省时本轮内 LLM / tool 不打 trace 字段(命令行 / 测试场景)。
   */
  tracer?: Tracer;
}

export interface RunTurnResult {
  textContent: string;
  stopReason: 'stop' | 'length' | 'toolUse' | 'aborted';
  hadToolCalls: boolean;
}


export class SubAgentSession {
  private readonly profileId: string;
  /** 父 agent id(透传给本地工具 ToolContext 用) */
  private readonly agentId: string;
  /** 父 session id(透传给本地工具 ToolContext 用) */
  private readonly sessionId: string;
  private readonly modelKey: string;
  private readonly compressionThreshold: number;

  private messages: Message[] = [];
  private contextState: ContextState = { compressions: [] };
  /** 上一轮 pi 返回的 usage；首请求时为 null（roughEstimate 兜底）。 */
  private lastUsage: PiUsage | null = null;
  /** 持有 abortor 以便 dispose 时取消进行中的 stream。 */
  private abortor: AbortController | null = null;
  private disposed = false;

  constructor(init: SubAgentSessionInit) {
    this.profileId = init.profileId;
    this.agentId = init.agentId;
    this.sessionId = init.sessionId;
    this.modelKey = init.model;
    this.compressionThreshold = init.compressionThreshold;
  }

  // -------------------------------------------------------------------------
  // wrapper 直调：在内存对话历史末尾追加一条 user message
  // -------------------------------------------------------------------------

  public appendUserMessage(msg: UserMessage): void {
    this.messages.push(msg);
  }

  /**
   * 把头部 N 条消息替换为单条 summary。供 wrapper Phase 0 压缩用。
   * 同时清空 `lastUsage` —— 它反映的是压缩前对话量，留着会让下一轮
   * pi.checkAndCompress 用 stale 大数判定阈值，触发不必要的二次压缩。
   */
  public replaceHead(n: number, summary: Message): void {
    if (n <= 0 || n >= this.messages.length) return;
    this.messages = [summary, ...this.messages.slice(n)];
    this.lastUsage = null;
  }

  public snapshotMessages(): Message[] {
    return [...this.messages];
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortor?.abort();
  }

  // -------------------------------------------------------------------------
  // 主入口：跑一轮 LLM + tool batch
  // -------------------------------------------------------------------------

  public async runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
    if (this.disposed) {
      throw new Error('[SubAgentSession] runTurn called on disposed session');
    }
    const abortor = new AbortController();
    this.abortor = abortor;
    const composedSignal = composeSignals(args.signal, abortor.signal);

    try {
      const parsed = parseAgentModel(this.modelKey);
      if (!parsed) {
        throw new Error(`[SubAgentSession] Invalid model key: ${this.modelKey}`);
      }
      const baseModel: PiModel<PiApi> = await resolveModel(parsed);
      const contextWindow = baseModel.contextWindow || 128_000;
      const piTools = args.catalog.specs;

      const doCompress = async (force?: boolean) => {
        // 缺省 Tracer.noop —— `chat.compress` 日志总是写，只是非主链路下没 trace 字段。
        const compressTracer = (args.tracer ?? Tracer.noop).derive().bind({ mod: 'chat.compress' });
        const result = await checkAndCompress({
          messages: this.messages,
          contextState: this.contextState,
          systemPrompt: args.systemPrompt,
          toolsForEstimate: piTools,
          contextWindow,
          agentName: this.agentId,
          profileId: this.profileId,
          lastUsage: this.lastUsage,
          compressionThreshold: this.compressionThreshold,
          force,
          tracer: compressTracer,
        });
        if (result.applied) {
          log.info(compressTracer.fields({
            msg: force ? 'compress applied (force)' : 'compress applied',
            chatSessionId: this.sessionId,
            agentId: this.agentId,
            compressedTokens: result.usage.tokenCount,
          }, 'self'));
        }
        return result;
      };

      // 一轮 = 1 次 LLM 调用 + 跟随的 tool batch（如果有）。
      // 多轮节奏由 wrapper 控制，session 这里不嵌循环。
      if (composedSignal.aborted) {
        throw new CancellationError('Sub-agent turn cancelled');
      }

      const compressionResult = await doCompress();
      this.contextState = {
        ...compressionResult.nextContextState,
        lastTokenUsage: compressionResult.usage,
      };
      if (compressionResult.applied) {
        this.lastUsage = null;
      }

      const { apiKey, model } = await resolveCredentials(baseModel, this.profileId);
      let llmMessages = compressionResult.llmContext;
      let piContext = toPiContext(llmMessages, args.systemPrompt, piTools);

      let final: PiAssistantMessage;
      try {
        final = await this.streamOneRound(model, apiKey, piContext, composedSignal, args.hooks, args.tracer);
      } catch (err) {
        if (classifyError(err) !== 'overflow') throw err;
        if (composedSignal.aborted) throw new CancellationError('Cancelled during overflow recovery');

        const forced = await doCompress(true);
        if (!forced.applied) throw err;
        this.contextState = { ...forced.nextContextState, lastTokenUsage: forced.usage };
        this.lastUsage = null;

        if (composedSignal.aborted) throw new CancellationError('Cancelled after overflow recovery compaction');

        llmMessages = forced.llmContext;
        piContext = toPiContext(llmMessages, args.systemPrompt, piTools);
        final = await this.streamOneRound(model, apiKey, piContext, composedSignal, args.hooks, args.tracer);
      }

      // aborted：把已收到的 partial 落进历史并退出
      if (final.stopReason === 'aborted') {
        const partial = fromPiAssistantMessage(final);
        if (partial.content.length > 0 || (partial.tool_calls?.length ?? 0) > 0) {
          this.addAssistantMessage(partial);
        }
        return {
          textContent: extractAssistantText(partial),
          stopReason: 'aborted',
          hadToolCalls: false,
        };
      }

      const assistantMsg = fromPiAssistantMessage(final);
      this.addAssistantMessage(assistantMsg);

      this.lastUsage = final.usage;
      this.contextState = {
        ...this.contextState,
        lastTokenUsage: {
          tokenCount: final.usage.input,
          totalMessages: this.messages.length,
          contextMessages: llmMessages.length + 1,
          compressionRatio: 1.0,
        },
      };

      const toolCalls = final.content.filter((c): c is Extract<typeof c, { type: 'toolCall' }> => c.type === 'toolCall');
      const summary: RunTurnResult = {
        textContent: extractAssistantText(assistantMsg),
        stopReason: mapStopReason(final.stopReason),
        hadToolCalls: toolCalls.length > 0,
      };

      if (final.stopReason === 'toolUse' && toolCalls.length > 0) {
        if (composedSignal.aborted) {
          throw new CancellationError('Cancelled before tool execution');
        }
        await this.handleToolCalls(toolCalls, composedSignal, args.catalog, args.hooks, args.tracer);
      }

      return summary;
    } catch (err) {
      if (err instanceof CancellationError) {
        return { textContent: '', stopReason: 'aborted', hadToolCalls: false };
      }
      throw err;
    } finally {
      if (this.abortor === abortor) this.abortor = null;
    }
  }

  // -------------------------------------------------------------------------
  // 内部：流式调用 + tool 执行
  // -------------------------------------------------------------------------

  private async streamOneRound(
    model: PiModel<PiApi>,
    apiKey: string,
    piContext: PiContext,
    signal: AbortSignal,
    hooks: SubAgentSessionHooks,
    parentTracer?: Tracer,
  ): Promise<PiAssistantMessage> {
    const tracer = (parentTracer ?? Tracer.noop).derive().bind({
      mod: 'chat.llm',
      chatSessionId: this.sessionId,
      agentId: this.agentId,
      profileId: this.profileId,
    });
    log.info(tracer.fields({
      msg: 'stream start',
      modelId: model.id,
      toolsCount: piContext.tools?.length ?? 0,
    }));
    let ttft: number | undefined;

    try {
      const pi = await import('@earendil-works/pi-ai');
      const events = pi.stream(model, piContext, {
        signal,
        apiKey,
        toolChoice: piContext.tools?.length ? 'auto' : undefined,
      });

      let lastEmittedText = '';
      for await (const evt of events) {
        if (ttft === undefined && (evt.type === 'text_delta' || evt.type === 'toolcall_delta' || evt.type === 'thinking_delta')) {
          ttft = tracer.dur;
        }
        if (evt.type === 'text_delta' && hooks.onLlmStreaming) {
          // pi 的 partial.content 已经是聚合后的完整 text contents 数组
          const accumulated = aggregateAssistantText(evt.partial);
          if (accumulated.length > lastEmittedText.length) {
            lastEmittedText = accumulated;
            hooks.onLlmStreaming(accumulated);
          }
        }
        // 其它事件（toolcall_delta / toolcall_end / thinking_*）静默 drain
      }

      const final = await events.result();
      if (final.stopReason === 'error') {
        const err = new Error(final.errorMessage ?? 'pi stream error');
        log.warn(tracer.fields({
          msg: 'stream failed',
          stopReason: final.stopReason,
          errClass: classifyError(err),
          err,
        }, 'self'));
        (err as Error & { __chatLlmLogged?: boolean }).__chatLlmLogged = true;
        throw err;
      }
      log.info(tracer.fields({
        msg: 'stream ok',
        ttft,
        inputTokens: final.usage.input,
        outputTokens: final.usage.output,
        stopReason: final.stopReason,
      }, 'self'));
      return final;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      const alreadyLogged = (e as Error & { __chatLlmLogged?: boolean }).__chatLlmLogged === true;
      if (!alreadyLogged) {
        log.error(tracer.fields({
          msg: 'stream failed',
          errClass: classifyError(e),
          err: e,
        }, 'self'));
        (e as Error & { __chatLlmLogged?: boolean }).__chatLlmLogged = true;
      }
      throw e;
    }
  }

  private async handleToolCalls(
    toolCalls: ReadonlyArray<{ id: string; name: string; arguments: Record<string, unknown> }>,
    signal: AbortSignal,
    catalog: ToolCatalog,
    hooks: SubAgentSessionHooks,
    parentTracer?: Tracer,
  ): Promise<void> {
    // 顺序执行(与老 SubAgentChat 行为一致:sub-agent 内 turn 较短,顺序
    // 更易追踪日志)。每个 tool call 各自一个 chat.tool span。
    for (const tc of toolCalls) {
      const startTime = Date.now();
      hooks.onToolStart?.(tc.id, tc.name, tc.arguments);

      const call = { id: tc.id, name: tc.name, arguments: tc.arguments };
      const ctx: ToolContext = {
        profileId: this.profileId,
        agentId: this.agentId,
        sessionId: this.sessionId,
        signal,
        eventSender: null,
        tracer: deriveToolTracer(parentTracer, call, {
          profileId: this.profileId,
          agentId: this.agentId,
          sessionId: this.sessionId,
        }),
        isSubAgent: true,
        callId: call.id,
        chunkStream: null,
        catalog,
        // sub-agent 不能再 spawn 子 sub-agent;留这两个 stub 给 spawn 工具
        // 内部的"缺失即抛"断言走不到(catalog 已不暴露 spawn_*)。
      };

      const result = await executeToolCall(call, catalog, ctx);

      let content = result.content;
      if (!result.isError && hooks.onToolResultPostprocess) {
        try {
          content = await hooks.onToolResultPostprocess(tc.name, tc.arguments, content);
        } catch (err) {
          logger.warn({
            msg: '[SubAgentSession] tool result postprocess failed; using raw content',
            toolName: tc.name,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Domain 路径:把 tool 结果折回最近一条 assistant.tool_calls 对应 ToolCall.response
      const toolResult: ToolResult = {
        time: Date.now(),
        status: result.isError ? 'fail' : 'success',
        result: content,
        images: result.images ?? [],
      };
      this.applyToolResponse(call.id, toolResult);

      if (result.isError) {
        hooks.onToolError?.(tc.id, tc.name, Date.now() - startTime);
      } else {
        hooks.onToolDone?.(tc.id, tc.name, Date.now() - startTime, content.length);
      }
    }
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  private addAssistantMessage(msg: AssistantMessage): void {
    this.messages.push(msg);
  }

  /** 反向找最近一条 assistant 中 id 匹配的 ToolCall, 写入 response。 */
  private applyToolResponse(toolCallId: string, result: ToolResult): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role !== 'assistant') continue;
      const tc = m.tool_calls.find((c) => c.id === toolCallId);
      if (!tc) continue;
      tc.response = { ...result };
      return;
    }
    throw new Error(`[SubAgentSession] applyToolResponse: no assistant.tool_calls matches id "${toolCallId}"`);
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** Domain AssistantMessage 的可见文本就是 content 串(think 不算)。 */
function extractAssistantText(msg: AssistantMessage): string {
  return msg.content;
}

/** pi.AssistantMessage 中 text 块聚合（用于流式 partial 摘取）。 */
function aggregateAssistantText(msg: PiAssistantMessage): string {
  let out = '';
  for (const block of msg.content) {
    if (block.type === 'text') out += block.text;
  }
  return out;
}

/** pi StopReason → wrapper 简化集（error 在 streamOneRound 已转成 throw）。 */
function mapStopReason(reason: PiAssistantMessage['stopReason']): RunTurnResult['stopReason'] {
  switch (reason) {
    case 'length': return 'length';
    case 'toolUse': return 'toolUse';
    case 'aborted': return 'aborted';
    default: return 'stop';
  }
}

/**
 * 把外部 signal 与内部 abortor 合并：任一 abort 都会触发返回的 signal。
 * pi.stream 只支持单个 AbortSignal，所以需要前置合成。
 */
function composeSignals(...signals: AbortSignal[]): AbortSignal {
  if (signals.length === 1) return signals[0];
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const s of signals) {
    if (s.aborted) { controller.abort(); break; }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}
