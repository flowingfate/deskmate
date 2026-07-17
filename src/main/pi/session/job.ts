/**
 * JobRun —— scheduler 用的静默 turn loop。
 *
 * 与 RegularSession 行为等价但裁掉一切对外推流 / WebContents 依赖;
 * human-loop 类工具调用 (choice/form) 在 eventSender=null 时由 tool handler 的
 * sendHumanLoopRequest 自动返回 cancel 默认应答 —— 等价于"用户拒绝",turn 自然收敛。
 *
 * JobRun 一次性:scheduler 每次 run 创建新 session,`run` 在每个 session 上
 * 至多调一次;`pendingResume` 非 markIdle 直接 fail-fast(见 run 注释)。
 */

import type {
  AssistantMessage as PiAssistantMessage,
  ToolCall as PiToolCall,
} from '@earendil-works/pi-ai';

import type { UserMessage } from '@shared/persist/types'

import { CancellationError } from '@main/lib/utilities/errors';
import { log } from '@main/log';
import { Tracer } from '@shared/log/trace';

import { deriveToolTracer, executeToolCall, ToolCatalog } from '../tool';
import type { ToolContext } from '../tools/types';
import { buildDelegationPrompt } from '../subagent/prompt';
import { classifyError } from '../utils/errors';
import {
  BaseSession,
  deriveFallbackTitle,
  type StreamOneRoundArgs,
  type SimpleStreamOptionsWithToolChoice,
} from './base';

export class JobRun extends BaseSession {
  private running = false;

  async run(userMessage: UserMessage, parentTracer?: Tracer): Promise<{ messageCount: number }> {
    await this.restoreTask;
    if (this.running) throw new Error('JobRun already running');
    // JobRun 一次性:scheduler 每次 run 创建新 session,这条入口在每个 session
    // 上至多调一次。`BaseSession.restore` 仍会按尾部状态算 `pendingResume` ——
    // 正常路径下应该是 markIdle(从未跑过)。如果调用方喂进来一个崩溃过的旧
    // session,fail-fast 把这个不变量破坏暴露出来,而不是默默把 in-flight
    // 状态当 idle 续接。
    if (this.pendingResume.kind !== 'markIdle') {
      throw new Error(
        `[pi/session] JobRun.run invoked on a session with pending resume action ` +
        `kind=${this.pendingResume.kind} —— scheduler must create a fresh session per run`,
      );
    }
    this.running = true;
    this.prepareSessionTracer(parentTracer);
    try {
      const before = this.messages.length;
      await this.markTurnRunning();
      await this.appendUserMessage(userMessage);
      await this.runTurnLoop();
      return { messageCount: this.messages.length - before };
    } finally {
      this.running = false;
      this.abortor = null;
    }
  }

  protected override async prepareRunEnvironment(): Promise<import('./base').RunEnvironment> {
    const environment = await super.prepareRunEnvironment();
    if (!environment.catalog.specs.some((tool) => tool.name === 'subagent')) return environment;

    const delegationPrompt = await buildDelegationPrompt({
      profileId: this.profileId,
      parentAgentId: this.agentId,
    });
    if (!delegationPrompt) return environment;
    return { ...environment, systemPrompt: `${environment.systemPrompt}\n\n---\n\n${delegationPrompt}` };
  }

  protected async streamOneRound(args: StreamOneRoundArgs): Promise<PiAssistantMessage> {
    const { model, apiKey, piContext, signal, parent, thinkingLevel } = args;
    const tracer = parent.derive().bind({ mod: 'chat.llm' });
    log.info(tracer.fields({
      msg: 'stream start',
      modelId: model.id,
      toolsCount: piContext.tools?.length ?? 0,
    }));

    try {
      const pi = await import('@earendil-works/pi-ai');
      // 同 RegularSession.streamOneRound：streamSimple + reasoning + toolChoice。
      // 语义必须与 streaming 形态一致 —— 否则同一 agent 在交互聊天 vs schedule
      // run 下 reasoning 强度不一致，回复风格会偏。
      const options: SimpleStreamOptionsWithToolChoice = {
        signal,
        apiKey,
        reasoning: thinkingLevel,
        toolChoice: piContext.tools?.length ? 'auto' : undefined,
      };
      const events = pi.streamSimple(model, piContext, options);

      // 必须 drain：pi 的 events 是 async iterator，drain 完 result() 才 resolve。
      for await (const _ of events) {
        // no-op
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

  protected async handleToolCalls(
    toolCalls: PiToolCall[],
    signal: AbortSignal,
    parent: Tracer,
    catalog: ToolCatalog,
  ): Promise<void> {
    const settled = await Promise.all(
      toolCalls.map((tc) => {
        const call = { id: tc.id, name: tc.name, arguments: tc.arguments ?? {} };
        const ctx: ToolContext = {
          mode: 'agent',
          profileId: this.profileId,
          agentId: this.agentId,
          sessionId: this.id,
          signal,
          eventSender: null,
          tracer: deriveToolTracer(parent, call, { profileId: this.profileId, agentId: this.agentId, sessionId: this.id }),
          callId: call.id,
          chunkStream: null,
          catalog,
          getParentContextSummary: () => this.getContextSummary(),
        };
        return executeToolCall(call, catalog, ctx);
      }),
    );

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

  protected async onCompressionApplied(): Promise<void> {
    await this.persistMetadata();
  }

  protected async onTurnComplete(): Promise<void> {
    await this.markTurnIdle();
    await this.persistMetadata();
  }

  protected async onTurnCancelled(): Promise<void> {
    // cancel 后先把已 append 的消息元数据落盘（contextState 不能丢），再抛回
    // SchedulerManager，由它 finishRun({ status: 'failed' })。
    this.setLastAssistantOutcome({ kind: 'aborted', partial: true });
    await this.markTurnIdle();
    await this.persistMetadata();
    throw new CancellationError('Job cancelled');
  }

  protected async failTurn(err: Error): Promise<never> {
    this.stampFailureOutcome(err, 'job failed');
    await this.markTurnIdleSafe('JobRun.failTurn');
    throw err;
  }

  protected onTurnFinally(): void {
    // running flag 由 run() finally 处理；base 路径无额外清理。
  }

  private async persistMetadata(): Promise<void> {
    const desiredTitle =
      this.persistSession.config.title ||
      deriveFallbackTitle(this.messages, 'Scheduled Run');
    await this.persist(desiredTitle, new Date().toISOString());
  }
}
