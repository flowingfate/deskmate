/**
 * BaseSession —— RegularSession(UI 流式) / JobRun(scheduler 静默)共用的
 * turn loop / 持久化 / 上下文导出抽象基类。
 *
 * 形态差异落在子类钩子(streamOneRound / handleToolCalls / onTurnComplete /
 * onTurnCancelled / onTurnFinally / onCompressionApplied / onWillCompress /
 * failTurn / onRestored)。turn loop / overflow 兜底 / 压缩决策 / resume 消费
 * 是**单一权威**,都在本文件;子类只填钩子,不复制 loop。
 */

import type {
  Api as PiApi,
  AssistantMessage as PiAssistantMessage,
  Context as PiContext,
  Model as PiModel,
  SimpleStreamOptions,
  Usage as PiUsage,
  ToolCall as PiToolCall,
} from '@earendil-works/pi-ai';

import type { AssistantMessage,
AssistantOutcome,
Message,
ToolResult,
UserMessage, } from '@shared/persist/types'
import type { ContextState } from '@shared/persist/types'
import type { ThinkingLevel } from '@shared/persist/types'

import { CancellationError } from '@main/lib/utilities/errors';

import { readAgentRuntimeConfig, type AgentConfig } from '../utils/config';
import { resolveCredentials, getModelInfo } from '../model';
import { buildSystemPrompt } from '../prompt';
import { toPiContext, fromPiAssistantMessage } from '../utils/messageBridge';
import { buildToolCatalogForAgent, ToolCatalog } from '../tool';
import { checkAndCompress } from '../compression';
import { classifyError, type PiErrorKind } from '../utils/errors';
import { planResume, type ResumeAction } from '../utils/resume';
import { log } from '@main/log';
import { Tracer } from '@shared/log/trace';

/**
 * pi-ai 0.77 的 `SimpleStreamOptions` 没暴露 `toolChoice`，但所有 provider 实现
 * 都从 `options?.toolChoice` 读这个字段并透传到原生 API（属于类型遗漏）。本地
 * 扩展类型显式表达这层依赖，值集合与 OpenAI `tool_choice` 一致；我们仅用 `'auto'`。
 */
export type SimpleStreamOptionsWithToolChoice = SimpleStreamOptions & {
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
};

const MAX_TURN_ITERATIONS = 30;

/**
 * BaseSession 对持久化的最小依赖面。pi 拥有的契约（非 persist 暴露的细节），
 * 默认实现是 `@main/persist` 的 Session 类；eval / 测试可注入内存实现。
 * 不要扩它，更不要让 pi.Session 直接 mutate `config`——多余的字段应转成显式 setter。
 */
export interface PersistSessionLike {
  readonly config: {
    title: string;
    updatedAt: string;
    contextState?: ContextState;
    turn?: { status: 'idle' | 'running'; startedAt?: number };
  };
  /** 折回 Domain Message;orphan tool_res 由调用方决定记录。 */
  loadDomainMessages(): Promise<{
    messages: Message[];
    orphanResponses: readonly { id: string; time: number; status: 'success' | 'fail'; result: string }[];
  }>;
  /** 追加一条 Domain user / assistant 消息。dehydrate 在 persist 内部完成。 */
  appendDomainMessage(m: Message): void;
  /** 追加一条 tool 结果。`toolCallId` 必须与上一条 assistant 中某 tool_call.id 对齐。 */
  appendToolResponse(toolCallId: string, result: ToolResult): void;
  /** 全量重写 messages.jsonl。edit / retry 路径用。 */
  rewriteMessages(messages: readonly Message[]): Promise<void>;
  flushMessages(): Promise<void>;
  persist(): Promise<void>;
}

/** Base 子类执行一轮 LLM 调用时的入参。streaming / 静默形态共用。 */
export interface StreamOneRoundArgs {
  model: PiModel<PiApi>;
  apiKey: string;
  piContext: PiContext;
  catalog: ToolCatalog;
  signal: AbortSignal;
  parent: Tracer;
  /**
   * pi-ai `ThinkingLevel` 标准枚举。`undefined` ⇒ 不传 `reasoning`，pi-ai 走
   * provider 默认。透传给 `pi.streamSimple({ reasoning })`，跨 provider 翻译
   * （`reasoning_effort` / `thinking.enabled+budget` / `enable_thinking` 等）由
   * pi-ai 完成，deskmate 不在内部做翻译。
   */
  thinkingLevel?: ThinkingLevel;
}

/** 单次 turn loop 在开始 LLM 循环前确定的不可变运行环境。 */
export interface RunEnvironment {
  agentCfg: AgentConfig;
  baseModel: PiModel<PiApi>;
  systemPrompt: string;
  catalog: ToolCatalog;
  maxTurns: number;
}


export interface TurnCompletion {
  iterations: number;
  stopReason: string | undefined;
}

/**
 * 共用 turn loop / 持久化 / 上下文导出能力的抽象基类。形态差异落在子类钩子
 * （streamOneRound / handleToolCalls / onTurnComplete / onTurnCancelled /
 * onTurnFinally / onCompressionApplied / onWillCompress / failTurn / onRestored）。
 */
export abstract class BaseSession {
  public messages: Message[] = [];
  public contextState: ContextState = { compressions: [] };
  // pi 上一轮返回的 usage：作为下一轮压缩决策的 input token 来源。
  // 重启后没有这个值（不持久化），首请求走 roughEstimate 兜底。
  protected lastUsage: PiUsage | null = null;

  protected readonly restoreTask: Promise<void>;
  protected abortor: AbortController | null = null;

  /**
   * 主链路 tracer。入口（`startStream / retryStream / editUserMessage / JobRun.run`）必
   * 调 `prepareSessionTracer` 注入：parent 给则复用（chat.ipc → chat.turn psid 自动成链），
   * 缺则本地 `Tracer.start()` 兜底（eval / scheduler 路径，chat.turn 为顶层 span）。
   * **不入 persist** —— 仅运行时分析。
   */
  protected sessionTracer: Tracer = Tracer.noop;

  constructor(
    public readonly id: string,
    public readonly profileId: string,
    public readonly agentId: string,
    protected readonly persistSession: PersistSessionLike,
  ) {
    this.restoreTask = this.restore();
  }

  // ─── readonly accessors for sub-agent / external bridges ────────────────

  /** 当前 agent 配置的 model id。读不到走 default model。供 SubAgentManager
   *  解析 sub-agent "inherit" 时使用。 */
  async getCurrentModelId(): Promise<string> {
    const cfg = await readAgentRuntimeConfig(this.profileId, this.agentId);
    if (cfg.ok) return cfg.agent.model;
    // 配置缺失时由调用方决定 fallback；这里返回空字符串而非默认值，
    // 避免 SubAgentManager 把"配置错误"误解为合法模型。
    return '';
  }

  /** 返回经过 compression snapshot 折叠后的对话历史，等价于老
   *  AgentChat.getContextHistory()。用于 SubAgent 的 full_history 模式。 */
  async getContextHistory(): Promise<Message[]> {
    await this.restoreTask;
    const top =
      this.contextState.compressions.length > 0
        ? this.contextState.compressions[this.contextState.compressions.length - 1]
        : null;
    if (top) {
      const { earlyPreservedCount, summary, compressedBeforeIndex } = top;
      return [
        ...this.messages.slice(0, earlyPreservedCount),
        summary,
        ...this.messages.slice(compressedBeforeIndex),
      ];
    }
    return [...this.messages];
  }

  /** 取最近 20 条 user/assistant 文本拼成摘要。供 SubAgent 的 parent_summary 模式。 */
  async getContextSummary(): Promise<string> {
    const history = await this.getContextHistory();
    if (history.length === 0) return '';
    const recent = history.slice(-20);
    const parts: string[] = [];
    for (const msg of recent) {
      // Domain 形态:user / assistant 的可见文本就是 content 串。
      // assistant 的 think 是模型推理过程,不进 parent_summary。
      const text = msg.content.trim();
      if (text) parts.push(`[${msg.role}]: ${text.substring(0, 500)}`);
    }
    return parts.join('\n');
  }


  // ─── core turn loop ─────────────────────────────────────────────────────

  /**
   * 通用 turn loop：配置 -> 压缩决策 -> streamOneRound -> tool -> 重复。
   *
   * 入口约定：子类负责在调本方法之前绑好本轮 turn 需要的运行时引用
   * （RegularSession 绑 activeStream / activeEventSender；JobRun 绑 running）。
   * base 只管 abortor，清理统一在 `onTurnFinally`。
   */
  protected async runTurnLoop(): Promise<void> {
    this.abortor = new AbortController();
    const signal = this.abortor.signal;

    // 防御兜底：正常路径下子类入口已通过 prepareSessionTracer 注入。直接调
    // runTurnLoop 时新起一个 trace，避免 chat.turn 起点彻底无 trace 字段。
    if (this.sessionTracer === Tracer.noop) {
      this.sessionTracer = Tracer.start().bind({
        chatSessionId: this.id,
        agentId: this.agentId,
        profileId: this.profileId,
      });
    }
    const turnTracer = this.sessionTracer.derive().bind({ mod: 'chat.turn' });
    log.info(turnTracer.fields({ msg: 'turn start' }));

    let iters = 0;
    let lastStopReason: string | undefined;
    let turnOutcome: 'done' | 'cancelled' | 'failed' = 'done';
    let turnError: Error | null = null;

    try {
      const environment = await this.prepareRunEnvironment();
      const { agentCfg, baseModel, systemPrompt, catalog, maxTurns } = environment;
      const piTools = catalog.specs;
      const contextWindow = baseModel.contextWindow || 128_000;

      // 仅当 applied=true 时写 INFO `chat.compress applied`；跳过路径绝不 log。
      const doCompress = async (force?: boolean) => {
        const beforeTokens = this.lastUsage?.input ?? null;
        // 每次 doCompress 自起一个 chat.compress span；summarizer 把 child span 挂这下面。
        const compressTracer = turnTracer.derive().bind({ mod: 'chat.compress' });
        const result = await checkAndCompress({
          messages: this.messages,
          contextState: this.contextState,
          systemPrompt,
          toolsForEstimate: piTools,
          contextWindow,
          agentName: agentCfg.name,
          profileId: this.profileId,
          lastUsage: this.lastUsage,
          onWillCompress: () => this.onWillCompress(),
          force,
          tracer: compressTracer,
        });
        if (result.applied) {
          log.info(compressTracer.fields({
            msg: force ? 'compress applied (force)' : 'compress applied',
            originalTokens: beforeTokens ?? undefined,
            compressedTokens: result.usage.tokenCount,
          }, 'self'));
        }
        return result;
      };

      for (let iter = 0; iter < maxTurns; iter++) {
        iters = iter + 1;
        this.onTurnStarted(iters);
        if (signal.aborted) throw new CancellationError('Turn cancelled');

        const compressionResult = await doCompress();
        this.contextState = {
          ...compressionResult.nextContextState,
          lastTokenUsage: compressionResult.usage,
        };
        if (compressionResult.applied) {
          await this.onCompressionApplied();
          this.lastUsage = null;
        }

        // resolveCredentials 留在循环内：returned token + baseUrl 是快照，长 turn
        // 跨越 OAuth 过期点时下一次循环会重新拿 fresh credentials 派生（GHC
        // 企业账户的 proxy-ep 字段决定 baseUrl，跨过期点必须重新派生）。
        const { apiKey, model } = await resolveCredentials(baseModel, this.profileId);

        let llmMessages = compressionResult.llmContext;
        let piContext = toPiContext(llmMessages, systemPrompt, piTools);
        const final = await this.streamOneRound({ model, apiKey, piContext, catalog, signal, parent: turnTracer, thinkingLevel: agentCfg.thinkingLevel }).catch(async (err) => {
          // 服务端 context overflow：本地估算偏低导致首请求被拒。强制压一次再
          // 重试本轮一次；force 压缩仍不能 applied 时只能抛原始错误。
          // pi 在收到 first chunk 前抛错时 stream 还没污染，retry 安全。
          const kind: PiErrorKind = classifyError(err);
          if (kind !== 'overflow') throw err;
          log.warn(turnTracer.fields({ msg: 'overflow retry', iter, errClass: kind }));
          if (signal.aborted) throw new CancellationError('Cancelled during overflow recovery');
          const forced = await doCompress(true);
          if (!forced.applied) throw err;

          this.contextState = {
            ...forced.nextContextState,
            lastTokenUsage: forced.usage,
          };
          await this.onCompressionApplied();
          this.lastUsage = null;

          if (signal.aborted) throw new CancellationError('Cancelled after overflow recovery compaction');

          llmMessages = forced.llmContext;
          piContext = toPiContext(llmMessages, systemPrompt, piTools);
          return this.streamOneRound({ model, apiKey, piContext, catalog, signal, parent: turnTracer, thinkingLevel: agentCfg.thinkingLevel });
        });

        lastStopReason = final.stopReason;

        // aborted：把 partial 内容 push 进消息历史保留可见，然后跳出。
        // 不重新抛 CancellationError —— pi 已经把 error 事件正常发出，
        // 我们已在 stream 上推过 status / complete chunk，直接走清理流程即可。
        if (final.stopReason === 'aborted') {
          const partial = fromPiAssistantMessage(final, catalog);
          // fromPiAssistantMessage 已经把 aborted 翻译成 outcome.kind='aborted'
          const hasContent = partial.content.length + partial.think.length > 0 || partial.tool_calls.length > 0;
          if (hasContent) await this.appendAssistantMessage(partial);
          break;
        }

        const assistantMsg = fromPiAssistantMessage(final, catalog);
        await this.appendAssistantMessage(assistantMsg);

        // 用 pi 这一轮的 usage 作为下一轮压缩决策依据，并同步进 lastTokenUsage
        // 让 ContextBadge 显示真实数（而不是 roughEstimate）。
        this.lastUsage = final.usage;
        this.contextState = {
          ...this.contextState,
          // badge 显示历史总量(含 output);下一轮 prompt 基线 = 本轮 total + 新消息
          lastTokenUsage: {
            tokenCount: final.usage.totalTokens,
            totalMessages: this.messages.length,
            contextMessages: llmMessages.length + 1,
            compressionRatio: 1.0,
          },
        };

        const toolCalls = final.content.filter((c) => c.type === 'toolCall');

        // 仅当 pi 明确告知 toolUse 时继续；模型只输出 toolCall 但 stopReason
        // 非 'toolUse' 视作终止。
        if (final.stopReason !== 'toolUse' || toolCalls.length === 0) break;
        if (signal.aborted) throw new CancellationError('Cancelled before tool execution');
        await this.handleToolCalls(toolCalls, signal, turnTracer, catalog);
      }

      await this.onTurnComplete({ iterations: iters, stopReason: lastStopReason });
    } catch (err) {
      if (err instanceof CancellationError) {
        turnOutcome = 'cancelled';
        await this.onTurnCancelled();
        return;
      }
      turnOutcome = 'failed';
      turnError = err instanceof Error ? err : new Error(String(err));
      await this.failTurn(turnError);
    } finally {
      const tail = { iters, stopReason: lastStopReason };
      if (turnOutcome === 'cancelled') {
        log.info(turnTracer.fields({ msg: 'turn cancelled', ...tail }, 'self'));
      } else if (turnOutcome === 'failed' && turnError) {
        log.error(turnTracer.fields({
          msg: 'turn failed',
          ...tail,
          errClass: classifyError(turnError),
          err: turnError,
        }, 'self'));
      } else {
        log.info(turnTracer.fields({ msg: 'turn done', ...tail }, 'self'));
      }
      this.onTurnFinally();
    }
  }

  protected abstract streamOneRound(args: StreamOneRoundArgs): Promise<PiAssistantMessage>;
  protected abstract handleToolCalls(
    toolCalls: PiToolCall[],
    signal: AbortSignal,
    parent: Tracer,
    catalog: ToolCatalog,
  ): Promise<void>;

  /** turn 正常跑完（所有迭代 break / aborted partial 落盘后）。 */
  protected abstract onTurnComplete(completion: TurnCompletion): Promise<void>;
  /**
   * turn 抛 CancellationError 后的收尾。**默认收敛掉错误**——base 调完即 `return`，
   * runTurnLoop 整体 resolve。需要把 cancel 抛回上层（如 scheduler）的子类，在
   * 钩子内重新 `throw new CancellationError(...)` 即可，finally 仍会执行。
   */
  protected abstract onTurnCancelled(): Promise<void>;
  /**
   * turn 抛非取消错误。子类负责落盘 outcome / 标 idle 后再 throw 出去;
   * runTurnLoop `await this.failTurn(...)`,所以子类的 throw 会在写盘真正完成后
   * 才传播到 finally,避免 fire-and-forget 把 EIO/ENOSPC 静默吞掉。
   */
  protected abstract failTurn(err: Error): Promise<never>;
  /** turn 收尾固定的清理（finally 块），异常路径也会走。 */
  protected abstract onTurnFinally(): void;
  /** 一次成功的 compression 跑完，子类负责持久化 / 推 status。 */
  protected abstract onCompressionApplied(): Promise<void>;
  /** compression 即将启动（用于推 COMPRESSING_CONTEXT status）。默认 no-op。 */
  protected onWillCompress(): void {}

  /** 默认环境保持 RegularSession / JobRun 的既有 config、prompt、catalog 与 30-turn 语义。 */
  protected async prepareRunEnvironment(): Promise<RunEnvironment> {
    const { profileId, agentId, id } = this;
    const cfg = await readAgentRuntimeConfig(profileId, agentId);
    if (!cfg.ok) throw new Error(cfg.error);
    const { agent: agentCfg, parsedModel } = cfg;
    const resolved = await getModelInfo(parsedModel);
    if (!resolved) {
      throw new Error(`[pi/session] Model "${agentCfg.model}" not found; please reselect`);
    }
    const { model: baseModel, capabilities: cap } = resolved;
    const systemPrompt = await buildSystemPrompt({ agentCfg, profileId, agentId, sessionId: id });
    const catalog = cap.tools ? await buildToolCatalogForAgent(agentCfg) : ToolCatalog.empty();
    return { agentCfg, baseModel, systemPrompt, catalog, maxTurns: MAX_TURN_ITERATIONS };
  }

  /** 每个真实 iteration 恰调用一次；overflow retry 仍属于同一 iteration。 */
  protected onTurnStarted(_iteration: number): void {}


  // ─── helpers / persistence ──────────────────────────────────────────────
  /**
   * 入口注入 sessionTracer（`startStream / retryStream / editUserMessage / JobRun.run`
   * 必调一次）。parent 给则复用（chat.ipc → chat.turn psid 自动成链）；缺则本地
   * `Tracer.start()` 兜底，chat.turn 自成顶层 span，与 "无外部上游" 语义对齐。
   */
  protected prepareSessionTracer(parent?: Tracer): void {
    if (parent) {
      // parent 通常已经 bind 过 chatSessionId/agentId/profileId（chat.ipc 入口），不重复 bind。
      this.sessionTracer = parent;
    } else {
      this.sessionTracer = Tracer.start().bind({
        chatSessionId: this.id,
        agentId: this.agentId,
        profileId: this.profileId,
      });
    }
  }

  async abort(): Promise<void> {
    await this.restoreTask;
    this.abortor?.abort();
  }

  /**
   * 截断到最后一条 user message 之后(含)。retry 路径用 —— 把上次失败/取消产生
   * 的 assistant + tool_res 行全部抹掉,LLM 重新尝试同一条 user。
   * 全量重写而非裁行数:tool_res 行不在内存 messages 里(它们已折回 ToolCall.response),
   * 内存截断后直接 `rewriteMessages` 让磁盘与内存保持事实一致。
   */
  protected async truncateToLastUserMessage(): Promise<void> {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        const keepCount = i + 1;
        if (keepCount < this.messages.length) {
          this.messages = this.messages.slice(0, keepCount);
          await this.persistSession.rewriteMessages(this.messages);
          await this.persistSession.persist();
        }
        return;
      }
    }
    throw new Error('No user message to retry from');
  }

  /** 追加 user message:内存 push + persist append + flush。 */
  protected async appendUserMessage(m: UserMessage): Promise<void> {
    this.messages.push(m);
    this.persistSession.appendDomainMessage(m);
    await this.persistSession.flushMessages();
  }

  /** 追加 assistant message:内存 push + persist append + flush。tool_calls 内部 response
   *  由 `applyToolResponse` 通道单独落盘(persist 不会从 assistant 行展开 tool_res)。 */
  protected async appendAssistantMessage(m: AssistantMessage): Promise<void> {
    this.messages.push(m);
    this.persistSession.appendDomainMessage(m);
    await this.persistSession.flushMessages();
  }

  /**
   * tool 跑完后,把结果折回 *最近一条 assistant.tool_calls* 中匹配 id 的
   * ToolCall.response,同时让 persist 追加一条 `tool_res` 行 (只 push pending,
   * 不 flush)。N 个并行工具的写盘合并到 caller 的批 flush(`handleToolCalls`
   * 收尾一次性 `flushMessages`),避免 N 次串行 appendText IO。
   *
   * 找不到匹配的 id 视作 invariant 破坏,抛错。
   */
  protected applyToolResponse(toolCallId: string, result: ToolResult): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role !== 'assistant') continue;
      const tc = m.tool_calls.find((c) => c.id === toolCallId);
      if (!tc) continue;
      tc.response = { ...result };
      this.persistSession.appendToolResponse(toolCallId, result);
      return;
    }
    throw new Error(`applyToolResponse: no assistant.tool_calls matches id "${toolCallId}"`);
  }

  /**
   * 给最后一条 assistant message **就地** mutate outcome。**只动内存,不写盘** ——
   * outcome 在新设计里仅作 turn 内决策辅助,Resume 终态把所有异常分支收敛到
   * `turn=idle + ErrorBar`(`loadChatSessionSnapshot.errorMessage`),不依赖磁盘上
   * 的 outcome 字段;UI 渲染也不消费它。把整个 messages.jsonl 重写只为改一个
   * 字段属于过早承诺,长会话(MB 级 jsonl)上 cancel/fail 一次就要全量覆盖。
   *
   * 尾部不是 assistant message 时(user 之后还没下笔)不做事 —— 调用方负责判断。
   */
  protected setLastAssistantOutcome(outcome: AssistantOutcome): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') {
        (this.messages[i] as AssistantMessage).outcome = outcome;
        return;
      }
    }
  }

  /** 标记 session 进入一次 turn。turn.status 落盘后崩溃可被 planResume 识别。 */
  protected async markTurnRunning(): Promise<void> {
    this.persistSession.config.turn = { status: 'running', startedAt: Date.now() };
    await this.persistSession.persist();
  }

  /** 标记 session 结束 turn。complete / cancelled / failed 均调用。 */
  protected async markTurnIdle(): Promise<void> {
    this.persistSession.config.turn = { status: 'idle' };
    await this.persistSession.persist();
  }

  /** failTurn 把 err 翻成尾部 assistant 的 `outcome.kind='error'`。 */
  protected stampFailureOutcome(err: Error, fallbackMessage = 'turn failed'): void {
    const category = classifyError(err);
    this.setLastAssistantOutcome({
      kind: 'error',
      message: err.message || fallbackMessage,
      ...(category !== 'other' ? { category } : {}),
    });
  }

  /** failTurn 路径专用:写盘失败只 log,保原始 err 传播。 */
  protected async markTurnIdleSafe(label: string): Promise<void> {
    try {
      await this.markTurnIdle();
    } catch (writeErr) {
      log.error({
        msg: `[pi/session] ${label}: markTurnIdle failed`,
        sessionId: this.id,
        err: writeErr instanceof Error ? writeErr : new Error(String(writeErr)),
      });
    }
  }

  /**
   * 启动期 resume 提示:`restore` 看到 `turn.status === 'running'` 时,根据
   * messages 尾部状态计算续跑动作。子类在下一次入口(startStream / retryStream)
   * 前消化它 —— 详见 RegularSession.consumePendingResume。
   */
  public pendingResume: ResumeAction = { kind: 'markIdle' };

  /** 把已落盘的 messages / 元数据灌进内存。 */
  private async restore(): Promise<void> {
    const { messages, orphanResponses } = await this.persistSession.loadDomainMessages();
    this.messages = messages;
    if (orphanResponses.length > 0) {
      log.warn({
        msg: '[pi/session] orphan tool_res rows found during restore',
        sessionId: this.id,
        agentId: this.agentId,
        count: orphanResponses.length,
      });
    }
    this.contextState = this.persistSession.config.contextState ?? { compressions: [] };
    this.pendingResume =
      this.persistSession.config.turn?.status === 'running'
        ? planResume(this.messages)
        : { kind: 'markIdle' };
    this.onRestored();
  }

  /** restore 完成后子类钩子（同步）。RegularSession 用于回填 title / update_at。 */
  protected onRestored(): void {}

  /**
   * 把 title / contextState / updatedAt 刷到 data.json；messages 不在这里碰
   * （appendXxx / rewriteMessages 已各自同步过磁盘）。`desiredTitle` 与
   * `updatedAt` 由子类决定语义。
   */
  protected async persist(desiredTitle: string, updatedAt: string): Promise<void> {
    this.persistSession.config.title = desiredTitle;
    this.persistSession.config.contextState = this.contextState;
    this.persistSession.config.updatedAt = updatedAt;
    await this.persistSession.persist();
  }
}

/** user 首条消息前 40 字符做兜底标题;RegularSession / JobRun 共用。 */
export function deriveFallbackTitle(messages: Message[], fallback: string): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return fallback;
  return firstUser.content.slice(0, 40) || fallback;
}
