import type { AssistantMessage as PiAssistantMessage, ToolCall as PiToolCall } from '@earendil-works/pi-ai';

import type { AssistantMessage, SubAgentRunRequest, SubAgentRunResult, SubrunDataFile, TokenUsage } from '@shared/persist/types';
import type { SubAgentRunStep } from '@shared/types/subAgentRunTypes';
import type { Subrun } from '@main/persist';
import { Tracer } from '@shared/log/trace';
import { createUserMessage } from '@shared/utils/messageFactory';

import { runWithDelegateExecution } from '@main/lib/delegateExecutionScope';
import { buildToolCatalogForAgent, deriveToolTracer, executeToolCall, ToolCatalog, type ToolCallInput } from '../tool';
import {
  BaseSession,
  deriveFallbackTitle,
  type RunEnvironment,
  type SimpleStreamOptionsWithToolChoice,
  type StreamOneRoundArgs,
  type TurnCompletion,
} from '../session/base';
import type { ToolContext } from '../tools/types';
import { getModelInfo } from '../model';
import { readAgentRuntimeConfig } from '../utils/config';
import { buildDelegatedSystemPrompt } from './prompt';
import { buildFormalResult, createSubmitResultTool, decideMissingSubmit, type SubmittedResult, type SystemResult, SubmitResultController } from './submitResult';

const TEXT_SNIPPET_LIMIT = 1_000;
const TOOL_ARGUMENTS_SUMMARY_LIMIT = 500;

export interface SubAgentSessionCallbacks {
  onStep?(step: SubAgentRunStep): void;
  onResult?(result: SubAgentRunResult): void;
}

export interface SubAgentSessionOptions {
  subrun: Subrun;
  signal: AbortSignal;
  parentTracer?: Tracer;
  callbacks?: SubAgentSessionCallbacks;
}

export interface SubAgentSessionResult {
  kind: 'result';
  result: SubAgentRunResult;
}

export interface SubAgentSessionNotPending {
  kind: 'not_pending';
  status: SubrunDataFile['status'];
}

export type SubAgentSessionRunOutcome = SubAgentSessionResult | SubAgentSessionNotPending;

/** 一个已持久化的 delegated run。授权、并发、超时与生产工具注册均由 Step 9 manager 负责。 */
export class SubAgentSession extends BaseSession {
  private readonly request: SubAgentRunRequest;
  private readonly delegateAgentId: string;
  private readonly controller = new SubmitResultController();
  private readonly toolDeliverables: string[] = [];
  private readonly tokenUsage: TokenUsage = { in: 0, out: 0, cache: [0, 0], total: 0 };

  private currentTurn = 0;
  private startedAt = 0;
  private reminderSent = false;
  private lastAssistantContent = '';
  private hasAvailableTools = false;
  private terminalResult: SubAgentRunResult | undefined;
  private parentAborted = false;

  public constructor(private readonly options: SubAgentSessionOptions) {
    const data = options.subrun.toDataFile();
    super(data.parentSessionId, data.profileId, data.parentAgentId, options.subrun);
    this.request = data.request;
    this.delegateAgentId = data.delegateAgentId;
  }

  public async run(): Promise<SubAgentSessionRunOutcome> {
    return runWithDelegateExecution({ delegateId: this.delegateAgentId }, async () => {
      await this.restoreTask;
      const started = await this.options.subrun.start();
      if (started.kind !== 'started') return { kind: 'not_pending', status: started.status };

      this.startedAt = Date.now();
      this.options.signal.addEventListener('abort', this.handleParentAbort, { once: true });
      try {
        if (!(await this.finishIfAborted())) {
          this.prepareSessionTracer(this.options.parentTracer);
          if (await this.startUserTurn(this.request.task)) {
            await this.runDelegatedTurns();
          }
        }

        if (!this.terminalResult) {
          throw new Error('SubAgentSession completed without a terminal result.');
        }
        return { kind: 'result', result: this.terminalResult };
      } catch (error) {
        if (this.terminalResult) return { kind: 'result', result: this.terminalResult };
        throw error;
      } finally {
        this.options.signal.removeEventListener('abort', this.handleParentAbort);
        this.abortor = null;
      }
    });
  }

  protected override async prepareRunEnvironment(): Promise<RunEnvironment> {
    const cfg = await readAgentRuntimeConfig(this.profileId, this.delegateAgentId);
    if (!cfg.ok) throw new Error(cfg.error);

    const resolved = await getModelInfo(cfg.parsedModel);
    if (!resolved) {
      throw new Error(`[pi/subagent] Model "${cfg.agent.model}" not found; please reselect`);
    }

    const systemPrompt = await buildDelegatedSystemPrompt({
      agentCfg: cfg.agent,
      profileId: this.profileId,
      delegateAgentId: this.delegateAgentId,
      parentSessionId: this.id,
      request: this.request,
    });
    const catalog = resolved.capabilities.tools
      ? (await buildToolCatalogForAgent(cfg.agent)).withSubmitResult(createSubmitResultTool(this.controller))
      : ToolCatalog.empty();

    this.hasAvailableTools = catalog.specs.length > 0;
    return {
      agentCfg: cfg.agent,
      baseModel: resolved.model,
      systemPrompt,
      catalog,
      maxTurns: Math.max(0, this.request.policy.maxTurns - this.currentTurn),
    };
  }

  protected override onTurnStarted(): void {
    this.currentTurn += 1;
    this.emitStep({ kind: 'turn_started', turn: this.currentTurn, timestamp: Date.now() });
  }

  protected override async streamOneRound(args: StreamOneRoundArgs): Promise<PiAssistantMessage> {
    const pi = await import('@earendil-works/pi-ai');
    const options: SimpleStreamOptionsWithToolChoice = {
      signal: args.signal,
      apiKey: args.apiKey,
      reasoning: args.thinkingLevel,
      toolChoice: args.piContext.tools?.length ? 'auto' : undefined,
    };
    const events = pi.streamSimple(args.model, args.piContext, options);

    let textSnippet = '';
    for await (const event of events) {
      if (event.type !== 'text_delta') continue;
      textSnippet = `${textSnippet}${event.delta}`.slice(-TEXT_SNIPPET_LIMIT);
      this.emitStep({
        kind: 'assistant_text',
        turn: this.currentTurn,
        timestamp: Date.now(),
        textSnippet,
      });
    }

    const final = await events.result();
    if (final.stopReason === 'error') {
      throw new Error(final.errorMessage ?? 'pi stream error');
    }
    this.recordUsage(final.usage);
    return final;
  }

  protected override async appendAssistantMessage(message: AssistantMessage): Promise<void> {
    this.lastAssistantContent = message.content;
    await super.appendAssistantMessage(message);
  }

  protected override async handleToolCalls(
    toolCalls: PiToolCall[],
    signal: AbortSignal,
    parent: Tracer,
    catalog: ToolCatalog,
  ): Promise<void> {
    const settled = await Promise.all(toolCalls.map(async (toolCall) => {
      const call: ToolCallInput = {
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments ?? {},
      };
      const startedAt = Date.now();
      this.emitStep({
        kind: 'tool_started',
        turn: this.currentTurn,
        timestamp: startedAt,
        toolCallId: call.id,
        toolName: catalog.resolveIdentity(call.name).name,
        argumentsSummary: JSON.stringify(call.arguments).slice(0, TOOL_ARGUMENTS_SUMMARY_LIMIT),
      });
      const ctx: ToolContext = {
        mode: 'delegate',
        profileId: this.profileId,
        agentId: this.agentId,
        delegateId: this.delegateAgentId,
        sessionId: this.id,
        signal,
        eventSender: null,
        tracer: deriveToolTracer(parent, call, {
          profileId: this.profileId,
          agentId: this.agentId,
          sessionId: this.id,
        }),
        callId: call.id,
        chunkStream: null,
        catalog,
      };
      const result = await executeToolCall(call, catalog, ctx);
      const durationMs = Date.now() - startedAt;
      if (result.isError) {
        this.emitStep({
          kind: 'tool_failed',
          turn: this.currentTurn,
          timestamp: Date.now(),
          toolCallId: call.id,
          toolName: result.toolName,
          durationMs,
          error: result.content,
        });
      } else {
        if (result.deliverables) this.toolDeliverables.push(...result.deliverables);
        this.emitStep({
          kind: 'tool_completed',
          turn: this.currentTurn,
          timestamp: Date.now(),
          toolCallId: call.id,
          toolName: result.toolName,
          durationMs,
          resultLength: result.content.length,
        });
      }
      return result;
    }));

    for (const result of settled) {
      this.applyToolResponse(result.toolCallId, {
        time: Date.now(),
        status: result.isError ? 'fail' : 'success',
        result: result.content,
        images: result.images ?? [],
      });
    }
    if (settled.length > 0) await this.persistSession.flushMessages();
  }


  protected override async onCompressionApplied(): Promise<void> {
    await this.persist(this.titleForPersist(), new Date().toISOString());
  }

  protected override async onTurnComplete(_completion: TurnCompletion): Promise<void> {
    await this.markTurnIdle();
    await this.persist(this.titleForPersist(), new Date().toISOString());
  }

  protected override async onTurnCancelled(): Promise<void> {
    await this.finishSubmitted({ status: 'cancelled', reason: 'Subrun cancelled.' });
  }

  protected override async failTurn(error: Error): Promise<never> {
    await this.finishSubmitted({ status: 'failed', error: error.message || 'Subrun failed.' });
    throw error;
  }

  protected override onTurnFinally(): void {}

  private handleParentAbort = (): void => {
    this.parentAborted = true;
    this.abortor?.abort();
  };

  private async finishIfAborted(): Promise<boolean> {
    if (!this.parentAborted && !this.options.signal.aborted) return false;
    await this.finishSubmitted({ status: 'cancelled', reason: 'Subrun cancelled before execution.' });
    return true;
  }

  private async startUserTurn(content: string): Promise<boolean> {
    await this.markTurnRunning();
    if (await this.finishIfAborted()) return false;
    await this.appendUserMessage(createUserMessage({ content }));
    return true;
  }

  private async runDelegatedTurns(): Promise<void> {
    if (!await this.runNaturalTurn()) return;
    if (!await this.appendReminderIfNeeded()) return;
    if (!await this.runNaturalTurn()) return;

    // `reminderSent` makes this second decision terminal: no third user turn.
    await this.appendReminderIfNeeded();
  }

  private async runNaturalTurn(): Promise<boolean> {
    if (await this.finishIfAborted()) return false;
    await this.runTurnLoop();
    if (this.terminalResult) return false;
    return !(await this.finishIfAborted());
  }

  private async appendReminderIfNeeded(): Promise<boolean> {
    const submitted = this.controller.submitted;
    if (submitted) {
      await this.finishSubmitted(submitted);
      return false;
    }

    const decision = decideMissingSubmit({
      reminderSent: this.reminderSent,
      assistantContent: this.lastAssistantContent,
      hasAvailableTools: this.hasAvailableTools,
      reachedMaxTurns: this.currentTurn >= this.request.policy.maxTurns,
    });
    if (decision.kind !== 'remind') {
      await this.finishSubmitted(decision.submitted);
      return false;
    }

    this.reminderSent = true;
    return this.startUserTurn(decision.reminder);
  }

  private async finishSubmitted(submitted: SubmittedResult | SystemResult): Promise<SubAgentRunResult> {
    if (this.terminalResult) return this.terminalResult;

    const built = buildFormalResult({
      submitted,
      metadata: {
        subrunId: this.options.subrun.subrunId,
        delegateAgentId: this.delegateAgentId,
        usage: {
          turns: this.currentTurn,
          durationMs: Date.now() - this.startedAt,
          tokenUsage: this.tokenUsage,
        },
        toolDeliverables: this.toolDeliverables,
      },
    });
    if (built.kind !== 'result') throw new Error(`[pi/subagent] ${built.error}`);

    await this.persistSession.flushMessages();
    if (this.persistSession.config.turn?.status !== 'idle') {
      await this.persist(this.titleForPersist(), new Date().toISOString());
      await this.markTurnIdle();
    }
    const finished = await this.options.subrun.finish(built.result);
    if (finished.kind !== 'finished') {
      throw new Error(`[pi/subagent] Could not finish subrun: ${finished.kind}`);
    }

    this.terminalResult = built.result;
    this.options.callbacks?.onResult?.(built.result);
    return built.result;
  }

  private recordUsage(usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
  }): void {
    this.tokenUsage.in += usage.input;
    this.tokenUsage.out += usage.output;
    this.tokenUsage.cache[0] += usage.cacheRead;
    this.tokenUsage.cache[1] += usage.cacheWrite;
    this.tokenUsage.total += usage.totalTokens;
  }

  private titleForPersist(): string {
    return this.persistSession.config.title || deriveFallbackTitle(this.messages, 'Delegated Run');
  }

  private emitStep(step: SubAgentRunStep): void {
    this.options.callbacks?.onStep?.(step);
  }
}

