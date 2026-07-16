/**
 * RegularSession —— UI 交互聊天的流式 turn loop。
 *
 * 在 `BaseSession` 之上补齐:public 入口(startStream / retryStream /
 * editUserMessage / stopStream)、`streamOneRound` 把 pi 事件流实时推成
 * `StreamingChunk`、`handleToolCalls` 并行执行 + 回推 tool_result、status 机
 * 与 Electron WebContents 依赖。
 */

import type {
  AssistantMessage as PiAssistantMessage,
  ToolCall as PiToolCall,
} from '@earendil-works/pi-ai';

import type { AssistantMessage, ToolResult, UserMessage } from '@shared/persist/types'
import type { StreamingChunk } from '@shared/types/streamingTypes';
import { ChatStatus } from '@shared/types/agentChatTypes';
import Stream from '@shared/stream-iterator';

import { log } from '@main/log';
import { Tracer } from '@shared/log/trace';

import { deriveToolTracer, executeToolCall, ToolCatalog } from '../tool';
import type { ToolContext } from '../tools/types';
import { classifyError } from '../utils/errors';
import {
  BaseSession,
  deriveFallbackTitle,
  type StreamOneRoundArgs,
  type SimpleStreamOptionsWithToolChoice,
} from './base';

export class RegularSession extends BaseSession {
  public title = '';
  public update_at = 0;
  public status: ChatStatus = ChatStatus.IDLE;

  private activeStream: Stream<StreamingChunk> | null = null;
  private activeEventSender: Electron.WebContents | null = null;

  // ─── public entry points ────────────────────────────────────────────────
  async startStream(
    userMessage: UserMessage,
    stream: Stream<StreamingChunk>,
    eventSender: Electron.WebContents,
    parentTracer?: Tracer,
  ): Promise<void> {
    await this.restoreTask;
    this.guardIdle();
    this.prepareSessionTracer(parentTracer);
    await this.consumePendingResume();
    await this.markTurnRunning();
    await this.appendUserMessage(userMessage);
    await this.runStreamingTurnLoop(stream, eventSender);
  }

  async retryStream(
    stream: Stream<StreamingChunk>,
    eventSender: Electron.WebContents,
    parentTracer?: Tracer,
  ): Promise<void> {
    await this.restoreTask;
    this.guardIdle();
    this.prepareSessionTracer(parentTracer);
    await this.consumePendingResume();
    await this.truncateToLastUserMessage();
    await this.markTurnRunning();
    await this.runStreamingTurnLoop(stream, eventSender);
  }

  async editUserMessage(
    messageId: string,
    updatedMessage: UserMessage,
    stream: Stream<StreamingChunk>,
    eventSender: Electron.WebContents,
    parentTracer?: Tracer,
  ): Promise<void> {
    await this.restoreTask;
    this.guardIdle();
    this.prepareSessionTracer(parentTracer);
    await this.consumePendingResume();
    const idx = this.messages.findIndex((m) => m.id === messageId && m.role === 'user');
    if (idx < 0) throw new Error(`User message not found: ${messageId}`);
    // 中段截断 + 立刻接上新 user message:全量重写 jsonl 保证磁盘事实=内存。
    this.messages = [...this.messages.slice(0, idx), updatedMessage];
    await this.persistSession.rewriteMessages(this.messages);
    this.update_at = Date.now();
    await this.markTurnRunning();
    await this.runStreamingTurnLoop(stream, eventSender);
  }

  async canEditUserMessage(messageId: string): Promise<{ canEdit: boolean; reason?: string }> {
    await this.restoreTask;
    if (this.status !== ChatStatus.IDLE) {
      return { canEdit: false, reason: `Session is ${this.status}` };
    }
    const msg = this.messages.find((m) => m.id === messageId);
    if (!msg) return { canEdit: false, reason: 'Message not found' };
    if (msg.role !== 'user') return { canEdit: false, reason: 'Only user messages can be edited' };
    return { canEdit: true };
  }

  async stopStream(): Promise<void> {
    // 只 abort。turn loop 自然走到 stopReason='aborted' 分支 → setStatus(IDLE)
    // → 推 status_changed → 自行 close stream。在这里 close stream 会让 status
    // chunk 发不出去，UI 按钮卡在"取消"形态。
    await this.abort();
  }

  // ─── turn loop wiring ───────────────────────────────────────────────────

  /** 把 stream / eventSender 绑到实例字段后进入 base turn loop。 */
  private async runStreamingTurnLoop(
    stream: Stream<StreamingChunk>,
    eventSender: Electron.WebContents,
  ): Promise<void> {
    this.activeStream = stream;
    this.activeEventSender = eventSender;
    await this.runTurnLoop();
  }

  protected async streamOneRound(args: StreamOneRoundArgs): Promise<PiAssistantMessage> {
    this.setStatus(ChatStatus.SENDING_RESPONSE);
    const { model, apiKey, piContext, catalog, signal, parent, thinkingLevel } = args;
    const stream = this.requireActiveStream();

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let chunkSeq = 0;
    let receivedFirstToken = false;
    let ttft: number | undefined;

    const tracer = parent.derive().bind({ mod: 'chat.llm' });
    log.info(tracer.fields({
      msg: 'stream start',
      modelId: model.id,
      toolsCount: piContext.tools?.length ?? 0,
    }));

    try {
      // 动态 import：pi-ai 是 ESM-only 包，main 进程是 CJS bundle，
      // 用 `import()` 让 Node 走 ESM loader。
      const pi = await import('@earendil-works/pi-ai');
      // streamSimple 而非 pi.stream：simple 入口接受 ThinkingLevel 标准字段
      // 并跨 provider 翻译（见 StreamOneRoundArgs.thinkingLevel 说明）。
      //
      // toolChoice:'auto' 显式声明 —— 多数 provider 默认就是 auto，但 Codex / 部分
      // responses 接口默认行为不一致；显式传一次保持跨 provider 一致。仅在确实
      // 带 tools 时附加，避免 provider 把 'auto' 当成"必须有工具"造成 schema 报错。
      const options: SimpleStreamOptionsWithToolChoice = {
        signal,
        apiKey,
        reasoning: thinkingLevel,
        toolChoice: piContext.tools?.length ? 'auto' : undefined,
      };
      const events = pi.streamSimple(model, piContext, options);

      for await (const evt of events) {
        if (
          !receivedFirstToken &&
          (evt.type === 'text_delta' ||
            evt.type === 'toolcall_delta' ||
            evt.type === 'thinking_delta')
        ) {
          receivedFirstToken = true;
          // tracer 自带 startAt，直接量 TTFT。
          ttft = tracer.dur;
          this.setStatus(ChatStatus.RECEIVED_RESPONSE);
        }

        if (evt.type === 'text_delta') {
          stream.send({
            chunkId: `${messageId}_${chunkSeq++}`,
            messageId,
            agentId: this.agentId,
            chatSessionId: this.id,
            timestamp: Date.now(),
            type: 'content',
            text: evt.delta,
          });
        } else if (evt.type === 'toolcall_end') {
          // toolcall_delta 阶段(args 文本片段流入)不再发 chunk —— Domain
          // ToolCall.args 是结构化对象;UI 直到 args 解完才能展示。pi-ai 在
          // toolcall_end 把已解析好的完整 args 一次性回灌,这里就一次发完。
          const tc = evt.toolCall;
          const { name, mcp } = catalog.resolveIdentity(tc.name);
          stream.send({
            chunkId: `${messageId}_${chunkSeq++}`,
            messageId,
            agentId: this.agentId,
            chatSessionId: this.id,
            timestamp: Date.now(),
            type: 'tool_call',
            index: evt.contentIndex,
            id: tc.id,
            name,
            args: tc.arguments ?? {},
            time: Date.now(),
            mcp,
          });
        } else if (evt.type === 'thinking_delta') {
          // pi-ai 把推理内容以独立流分段;UI 把这条线拼到 AssistantMessage.think。
          // content / tool_call 三条流并行,renderer 各自累积到对应字段。
          stream.send({
            chunkId: `${messageId}_${chunkSeq++}`,
            messageId,
            agentId: this.agentId,
            chatSessionId: this.id,
            timestamp: Date.now(),
            type: 'thinking',
            text: evt.delta,
          });
        }
      }

      const final = await events.result();

      // pi 把错误以 event 形式发出而不是 throw —— result() 返回 stopReason='error'
      // 的 AssistantMessage 而非抛错。这里手动 throw 让外层 overflow 兜底 /
      // failTurn 能像处理 SDK 异常一样接住。
      if (final.stopReason === 'error') {
        const err = new Error(final.errorMessage ?? 'pi stream error');
        log.warn(tracer.fields({
          msg: 'stream failed',
          stopReason: final.stopReason,
          errClass: classifyError(err),
          err,
        }, 'self'));
        // sentinel：让外层 catch 知道这条 err 已经写过 WARN 了，不再补写 ERROR。
        (err as Error & { __chatLlmLogged?: boolean }).__chatLlmLogged = true;
        throw err;
      }

      stream.send({
        chunkId: `${messageId}_complete`,
        messageId,
        agentId: this.agentId,
        chatSessionId: this.id,
        timestamp: Date.now(),
        type: 'complete',
        hasToolCalls: final.content.some((c) => c.type === 'toolCall'),
        usage: {
          in: final.usage.input,
          out: final.usage.output,
          cache: [final.usage.cacheRead, final.usage.cacheWrite],
          total: final.usage.totalTokens,
        },
      });

      log.info(tracer.fields({
        msg: 'stream ok',
        ttft,
        inputTokens: final.usage.input,
        outputTokens: final.usage.output,
        stopReason: final.stopReason,
      }, 'self'));

      return final;
    } catch (err) {
      // SDK throw 路径（abort / 网络 / 服务端 4xx）：上面 stopReason='error' 已
      // 经写过 WARN 并打了 sentinel；这里只为"没有上半场就硬抛"补 ERROR。
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

  protected async handleToolCalls(
    toolCalls: PiToolCall[],
    signal: AbortSignal,
    parent: Tracer,
    catalog: ToolCatalog,
  ): Promise<void> {
    const stream = this.requireActiveStream();
    const eventSender = this.requireActiveEventSender();

    // 并行发起所有 toolCall;回填用下标顺序的 for-of 消费,确保
    // assistant/tool 配对的回放顺序稳定。每个 tool 各自一个 chat.tool span。
    const settled = await Promise.all(
      toolCalls.map((tc) => {
        const call = { id: tc.id, name: tc.name, arguments: tc.arguments ?? {} };
        const ctx: ToolContext = {
          mode: 'agent',
          profileId: this.profileId,
          agentId: this.agentId,
          sessionId: this.id,
          signal,
          eventSender,
          tracer: deriveToolTracer(parent, call, { profileId: this.profileId, agentId: this.agentId, sessionId: this.id }),
          callId: call.id,
          chunkStream: stream,
          catalog,
          getParentContextSummary: () => this.getContextSummary(),
        };
        return executeToolCall(call, catalog, ctx);
      }),
    );

    for (const result of settled) {
      const toolResult: ToolResult = {
        time: Date.now(),
        status: result.isError ? 'fail' : 'success',
        result: result.content,
        images: result.images ?? [],
      };
      this.applyToolResponse(result.toolCallId, toolResult);
      stream.send({
        chunkId: `${result.toolCallId}_result`,
        messageId: result.toolCallId,
        agentId: this.agentId,
        chatSessionId: this.id,
        timestamp: toolResult.time,
        type: 'tool_result',
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        result: result.content,
        status: toolResult.status,
        time: toolResult.time,
      });
    }
    // 批 flush:N 个 tool_res 行合并成一次 appendText IO,避免每 tool 串行写盘。
    if (settled.length > 0) await this.persistSession.flushMessages();
  }

  protected async appendUserMessage(m: UserMessage): Promise<void> {
    this.update_at = Date.now();
    await super.appendUserMessage(m);
  }

  protected async appendAssistantMessage(m: AssistantMessage): Promise<void> {
    this.update_at = Date.now();
    await super.appendAssistantMessage(m);
  }

  protected applyToolResponse(toolCallId: string, result: ToolResult): void {
    this.update_at = Date.now();
    super.applyToolResponse(toolCallId, result);
  }

  protected async onCompressionApplied(): Promise<void> {
    this.setStatus(ChatStatus.COMPRESSED_CONTEXT);
    await this.persistMetadata();
  }

  protected onWillCompress(): void {
    this.setStatus(ChatStatus.COMPRESSING_CONTEXT);
  }

  protected async onTurnComplete(): Promise<void> {
    this.setStatus(ChatStatus.IDLE);
    this.activeStream?.close();
    await this.markTurnIdle();
    await this.persistMetadata();
  }

  protected async onTurnCancelled(): Promise<void> {
    this.setStatus(ChatStatus.IDLE);
    // cancel 时若 turn 顶部是 assistant 且 outcome 未明,标 aborted/partial。
    this.setLastAssistantOutcome({ kind: 'aborted', partial: true });
    await this.markTurnIdle();
    await this.persistMetadata();
    this.activeStream?.close();
  }

  protected async failTurn(err: Error): Promise<never> {
    this.setStatus(ChatStatus.IDLE);
    this.activeStream?.close();
    this.stampFailureOutcome(err);
    await this.markTurnIdleSafe('failTurn');
    throw err;
  }

  protected onTurnFinally(): void {
    this.activeStream = null;
    this.activeEventSender = null;
  }

  protected onRestored(): void {
    this.title = this.persistSession.config.title ?? '';
    const updatedAt = this.persistSession.config.updatedAt;
    this.update_at = updatedAt ? new Date(updatedAt).getTime() || 0 : 0;
  }

  private async persistMetadata(): Promise<void> {
    const lastUpdated = new Date(this.update_at || Date.now()).toISOString();
    const desiredTitle = this.title || deriveFallbackTitle(this.messages, 'New ChatSession');
    await this.persist(desiredTitle, lastUpdated);
  }

  /**
   * 启动期把 pendingResume 消费完。常规入口 (startStream / retryStream /
   * editUserMessage) 在自身工作前调用一次。
   *
   * - markIdle: 上次 turn 正常收尾或本来就是 idle,直接返回。
   * - markTerminal: 把 outcome 落到内存(已在 restore 里看见),并标 turn=idle。
   * - runMissingTools / continueLoop: 尾部一定是 in-flight assistant —— 把它标
   *   `aborted + partial`,turn 拉回 idle。**不**主动续跑 tool —— 这是终态设计。
   * - startTurn: 尾部是 user(上次崩在 LLM 响应前)。**不**调
   *   `setLastAssistantOutcome` —— 它倒序扫到的是上一轮已正常收尾的 assistant,
   *   把那条标 aborted 既不准确,后续 editUserMessage→rewriteMessages 还会持久化
   *   错误 outcome。只 markTurnIdle,等用户重发触发新 turn。
   *
   * 异常状态由 `loadChatSessionSnapshot` 在 `turn=running` 时通过 `interrupted`
   * 字段透到 UI,渲染端的 ErrorBar + Retry 按钮负责让用户手动 retry。
   */
  private async consumePendingResume(): Promise<void> {
    const action = this.pendingResume;
    if (action.kind === 'markIdle') return;
    this.pendingResume = { kind: 'markIdle' };
    if (action.kind === 'markTerminal') {
      this.setLastAssistantOutcome(action.outcome);
    } else if (action.kind === 'runMissingTools' || action.kind === 'continueLoop') {
      this.setLastAssistantOutcome({ kind: 'aborted', partial: true });
    }
    // startTurn:不动 outcome,直接 markIdle
    await this.markTurnIdle();
  }

  private guardIdle(): void {
    if (this.status !== ChatStatus.IDLE) {
      throw new Error(`Cannot start turn while session status is ${this.status}`);
    }
  }

  private setStatus(s: ChatStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.activeStream?.send({
      type: 'status_changed',
      agentId: this.agentId,
      chatSessionId: this.id,
      timestamp: Date.now(),
      chatStatus: s,
      contextStats: this.contextState.lastTokenUsage,
    });
  }

  private requireActiveStream(): Stream<StreamingChunk> {
    if (!this.activeStream) {
      throw new Error('RegularSession streaming hooks called without an active stream');
    }
    return this.activeStream;
  }

  private requireActiveEventSender(): Electron.WebContents {
    if (!this.activeEventSender) {
      throw new Error('RegularSession streaming hooks called without an active eventSender');
    }
    return this.activeEventSender;
  }
}
