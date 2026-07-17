import {
  formatSubrunId,
  isSubrunId,
  parseSubrunId,
  type Message,
  type PersistedAssistantMessage,
  type PersistedJsonLine,
  type PersistedToolResponse,
  type PersistedUserMessage,
  type PersistSubrunDataFile,
  type PersistSubrunHistory,
  type SubAgentRunPolicy,
  type SubAgentRunRequest,
  type SubAgentRunResult,
  type SubrunExecution,
  type SubrunId,
  type SubrunSessionData,
  type SubrunStatus,
  type ToolResult,
} from '../../shared/persist/types';
import { PERSIST_PATH } from '../../shared/persist/path';
import type { PersistSessionLike } from '@main/pi';
import { log } from '@main/log';
import * as fsp from 'node:fs/promises';
import { dehydrate, rehydrate } from './messageWire';
import { appendText, ensureDir, listDirs, pathExists, readJsonOrNull, readTextOrNull, removeFileIfExists, writeJson, writeText } from './lib/atomic';

export interface SubrunParent {
  profileId: string;
  parentAgentId: string;
  parentSessionId: string;
  subrunsDir: string;
}

export type CreateSubrunResult =
  | { kind: 'created'; subrun: Subrun }
  | { kind: 'exhausted' };

export type GetSubrunResult =
  | { kind: 'found'; subrun: Subrun }
  | { kind: 'missing' }
  | { kind: 'invalid_id' }
  | { kind: 'incomplete'; subrunId: SubrunId };

export interface ListSubrunsResult {
  subruns: Subrun[];
  incompleteIds: SubrunId[];
}

export type StartSubrunResult =
  | { kind: 'started' }
  | { kind: 'not_pending'; status: SubrunStatus };

export type FinishSubrunResult =
  | { kind: 'finished' }
  | { kind: 'not_running'; status: SubrunStatus }
  | { kind: 'result_mismatch' };

export type ContinueSubrunResult =
  | { kind: 'continued' }
  | {
  kind: 'not_terminal';
  status: 'pending' | 'running';
};

const allocationLocks = new Map<string, Promise<void>>();

async function withAllocationLock<T>(subrunsDir: string, action: () => Promise<T>): Promise<T> {
  const previous = allocationLocks.get(subrunsDir) ?? Promise.resolve();
  let releaseCurrent: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  allocationLocks.set(subrunsDir, current);

  await previous;
  try {
    return await action();
  } finally {
    releaseCurrent();
    if (allocationLocks.get(subrunsDir) === current) allocationLocks.delete(subrunsDir);
  }
}

function validSubrunIds(parent: SubrunParent, directoryNames: readonly string[]): SubrunId[] {
  const ids: SubrunId[] = [];
  for (const directoryName of directoryNames) {
    if (isSubrunId(directoryName)) {
      ids.push(directoryName);
      continue;
    }
    log.warn({
      msg: 'Ignoring invalid subrun directory',
      profileId: parent.profileId,
      parentAgentId: parent.parentAgentId,
      parentSessionId: parent.parentSessionId,
      directoryName,
    });
  }
  return ids;
}

function createPendingData(
  subrunId: SubrunId,
  request: SubAgentRunRequest,
  createdAt: string,
): PersistSubrunDataFile {
  return {
    version: 1,
    id: subrunId,
    delegateAgentId: request.delegateAgentId,
    histories: [{
      status: 'pending',
      execution: {
        kind: 'initial',
        message: request.task,
        expectedOutput: request.expectedOutput,
        context: request.context,
        policy: request.policy,
      },
    }],
    session: {
      title: '',
      updatedAt: createdAt,
      contextState: { compressions: [] },
    },
  };
}

export class Subrun implements PersistSessionLike {
  private pendingMessages: PersistedJsonLine[] = [];
  private flushing?: Promise<void>;

  private constructor(
    private data: PersistSubrunDataFile,
    private readonly parent: SubrunParent,
  ) {}

  public get config(): SubrunSessionData {
    return this.data.session;
  }

  public get profileId(): string {
    return this.parent.profileId;
  }

  public get parentAgentId(): string {
    return this.parent.parentAgentId;
  }

  public get parentSessionId(): string {
    return this.parent.parentSessionId;
  }

  public get subrunId(): SubrunId {
    return this.data.id;
  }

  public get delegateAgentId(): string {
    return this.data.delegateAgentId;
  }

  public get request(): SubAgentRunRequest {
    const execution = this.initialExecution();
    return {
      delegateAgentId: this.delegateAgentId,
      task: execution.message,
      expectedOutput: execution.expectedOutput,
      context: execution.context,
      policy: execution.policy,
    };
  }

  public get execution(): SubrunExecution {
    return this.latestHistory().execution;
  }

  public get status(): SubrunStatus {
    return this.latestHistory().status;
  }

  public get startedAt(): string {
    const history = this.latestHistory();
    if (history.status === 'pending') {
      throw new Error(`Subrun ${this.subrunId} has not started.`);
    }
    return history.startedAt;
  }

  public get finishedAt(): string {
    const history = this.latestHistory();
    if (history.status === 'pending' || history.status === 'running') {
      throw new Error(`Subrun ${this.subrunId} has not finished.`);
    }
    return history.finishedAt;
  }

  public get result(): SubAgentRunResult {
    const history = this.latestHistory();
    const identity = {
      subrunId: this.subrunId,
      delegateAgentId: this.delegateAgentId,
    };
    switch (history.status) {
      case 'pending':
      case 'running':
        throw new Error(`Subrun ${this.subrunId} has no terminal result.`);
      case 'completed':
        return { ...identity, status: 'completed', ...history.result };
      case 'partial':
        return { ...identity, status: 'partial', ...history.result };
      case 'blocked':
        return { ...identity, status: 'blocked', ...history.result };
      case 'failed':
        return { ...identity, status: 'failed', ...history.result };
      case 'cancelled':
        return { ...identity, status: 'cancelled', ...history.result };
    }
  }

  private initialExecution(): Extract<SubrunExecution, { kind: 'initial' }> {
    const history = this.data.histories[0];
    if (!history || history.execution.kind !== 'initial') {
      throw new Error(`Subrun ${this.subrunId} has no initial execution.`);
    }
    return history.execution;
  }

  public static async create(
    parent: SubrunParent,
    request: SubAgentRunRequest,
  ): Promise<CreateSubrunResult> {
    return withAllocationLock(parent.subrunsDir, async () => {
      await ensureDir(parent.subrunsDir);
      const ids = validSubrunIds(parent, await listDirs(parent.subrunsDir));
      let sequence = 0;
      for (const id of ids) sequence = Math.max(sequence, parseSubrunId(id) ?? 0);

      while (sequence < 999) {
        sequence += 1;
        const subrunId = formatSubrunId(sequence);
        const directory = PERSIST_PATH.subrunDir(parent.subrunsDir, subrunId);
        try {
          await fsp.mkdir(directory);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue;
          throw error;
        }

        const createdAt = new Date().toISOString();
        const data = createPendingData(subrunId, request, createdAt);
        await writeJson(PERSIST_PATH.subrunData(parent.subrunsDir, subrunId), data);
        return { kind: 'created', subrun: new Subrun(data, parent) };
      }

      return { kind: 'exhausted' };
    });
  }

  public static async load(parent: SubrunParent, subrunId: SubrunId): Promise<GetSubrunResult> {
    if (!isSubrunId(subrunId)) return { kind: 'invalid_id' };

    const directory = PERSIST_PATH.subrunDir(parent.subrunsDir, subrunId);
    const data = await readJsonOrNull<PersistSubrunDataFile>(PERSIST_PATH.subrunData(parent.subrunsDir, subrunId));
    if (data === null) {
      return await pathExists(directory)
        ? { kind: 'incomplete', subrunId }
        : { kind: 'missing' };
    }
    return { kind: 'found', subrun: new Subrun(data, parent) };
  }

  public static async list(parent: SubrunParent): Promise<ListSubrunsResult> {
    const ids = validSubrunIds(parent, await listDirs(parent.subrunsDir));
    const subruns: Subrun[] = [];
    const incompleteIds: SubrunId[] = [];

    for (const subrunId of ids) {
      const result = await Subrun.load(parent, subrunId);
      if (result.kind === 'found') subruns.push(result.subrun);
      if (result.kind === 'incomplete') incompleteIds.push(subrunId);
    }

    return { subruns, incompleteIds };
  }

  public async start(): Promise<StartSubrunResult> {
    const current = this.latestHistory();
    if (current.status !== 'pending') return { kind: 'not_pending', status: current.status };

    const startedAt = new Date().toISOString();
    this.replaceLatestHistory({
      status: 'running',
      execution: current.execution,
      startedAt,
    });
    this.data.session.updatedAt = startedAt;
    await this.persist();
    return { kind: 'started' };
  }

  public async continueConversation(
    message: string,
    policy: SubAgentRunPolicy,
  ): Promise<ContinueSubrunResult> {
    const status = this.status;
    if (status === 'pending' || status === 'running') {
      return { kind: 'not_terminal', status };
    }

    const startedAt = new Date().toISOString();
    this.data.histories.push({
      status: 'running',
      startedAt,
      execution: { kind: 'continuation', message, policy },
    });
    this.data.session.updatedAt = startedAt;
    await this.persist();
    return { kind: 'continued' };
  }

  public async finish(result: SubAgentRunResult): Promise<FinishSubrunResult> {
    const current = this.latestHistory();
    if (current.status !== 'running') return { kind: 'not_running', status: current.status };
    if (result.subrunId !== this.subrunId || result.delegateAgentId !== this.delegateAgentId) {
      return { kind: 'result_mismatch' };
    }

    const finishedAt = new Date().toISOString();
    const resultBase = {
      deliverables: result.deliverables,
      warnings: result.warnings,
      usage: result.usage,
    };
    switch (result.status) {
      case 'completed':
        this.replaceLatestHistory({
          status: 'completed',
          execution: current.execution,
          startedAt: current.startedAt,
          finishedAt,
          result: { ...resultBase, content: result.content },
        });
        break;
      case 'partial':
        this.replaceLatestHistory({
          status: 'partial',
          execution: current.execution,
          startedAt: current.startedAt,
          finishedAt,
          result: { ...resultBase, content: result.content, incompleteReason: result.incompleteReason },
        });
        break;
      case 'blocked':
        this.replaceLatestHistory({
          status: 'blocked',
          execution: current.execution,
          startedAt: current.startedAt,
          finishedAt,
          result: { ...resultBase, reason: result.reason, content: result.content },
        });
        break;
      case 'failed':
        this.replaceLatestHistory({
          status: 'failed',
          execution: current.execution,
          startedAt: current.startedAt,
          finishedAt,
          result: { ...resultBase, error: result.error },
        });
        break;
      case 'cancelled':
        this.replaceLatestHistory({
          status: 'cancelled',
          execution: current.execution,
          startedAt: current.startedAt,
          finishedAt,
          result: { ...resultBase, reason: result.reason },
        });
        break;
    }

    this.data.session.updatedAt = finishedAt;
    await this.flushMessages();
    await this.persist();
    return { kind: 'finished' };
  }

  private latestHistory(): PersistSubrunHistory {
    const history = this.data.histories.at(-1);
    if (!history) throw new Error(`Subrun ${this.subrunId} has no execution history.`);
    return history;
  }

  private replaceLatestHistory(history: PersistSubrunHistory): void {
    this.data.histories[this.data.histories.length - 1] = history;
  }

  public appendDomainMessage(message: Message): void {
    if (message.role === 'user') {
      const line: PersistedUserMessage = {
        role: 'user',
        id: message.id,
        time: message.time,
        content: message.content,
      };
      if (message.attachments.length > 0) line.attachments = message.attachments;
      this.pendingMessages.push(line);
      return;
    }

    const line: PersistedAssistantMessage = {
      role: 'assistant',
      id: message.id,
      time: message.time,
      think: message.think,
      content: message.content,
    };
    if (message.tool_calls.length > 0) {
      line.tool_calls = message.tool_calls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        time: toolCall.time,
        args: toolCall.args,
      }));
    }
    if (message.outcome) line.outcome = message.outcome;
    if (message.model) line.model = message.model;
    if (message.usage) line.usage = message.usage;
    this.pendingMessages.push(line);
  }

  public appendToolResponse(toolCallId: string, result: ToolResult): void {
    const line: PersistedToolResponse = {
      role: 'tool_res',
      id: toolCallId,
      time: result.time,
      status: result.status,
      result: result.result,
      images: result.images.length > 0 ? result.images : undefined,
    };
    this.pendingMessages.push(line);
  }

  public async flushMessages(): Promise<void> {
    while (this.flushing) await this.flushing;
    if (this.pendingMessages.length === 0) return;

    const batch = this.pendingMessages;
    this.pendingMessages = [];
    const text = batch.map((line) => JSON.stringify(line)).join('\n') + '\n';
    this.flushing = appendText(PERSIST_PATH.subrunMessages(this.parent.subrunsDir, this.subrunId), text)
      .finally(() => { this.flushing = undefined; });
    await this.flushing;
  }

  public async rewriteMessages(messages: readonly Message[]): Promise<void> {
    while (this.flushing) await this.flushing;
    this.pendingMessages = [];
    const lines = dehydrate(messages);
    const file = PERSIST_PATH.subrunMessages(this.parent.subrunsDir, this.subrunId);
    if (lines.length === 0) {
      await removeFileIfExists(file);
      return;
    }
    const text = lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
    await writeText(file, text);
  }

  public async loadDomainMessages(): Promise<{
    messages: Message[];
    orphanResponses: PersistedToolResponse[];
  }> {
    const raw = await readTextOrNull(PERSIST_PATH.subrunMessages(this.parent.subrunsDir, this.subrunId));
    const lines: PersistedJsonLine[] = [];
    if (raw !== null) {
      for (const line of raw.split('\n')) {
        if (line.length === 0) continue;
        const parsed: PersistedJsonLine = JSON.parse(line);
        lines.push(parsed);
      }
    }
    return rehydrate([...lines, ...this.pendingMessages]);
  }

  public async persist(): Promise<void> {
    await writeJson(PERSIST_PATH.subrunData(this.parent.subrunsDir, this.subrunId), this.data);
  }
}
