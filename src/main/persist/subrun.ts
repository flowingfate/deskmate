import {
  formatSubrunId,
  isSubrunId,
  parseSubrunId,
  type Message,
  type PendingSubrunDataFile,
  type PersistedAssistantMessage,
  type PersistedJsonLine,
  type PersistedToolResponse,
  type PersistedUserMessage,
  type RunningSubrunDataFile,
  type SubAgentRunRequest,
  type SubAgentRunResult,
  type SubrunDataFile,
  type SubrunId,
  type TerminalSubrunDataFile,
  type ToolResult,
} from '../../shared/persist/types';
import { PERSIST_PATH } from '../../shared/persist/path';
import type { PersistSessionLike } from '@main/pi';
import { log } from '@main/log';
import * as fsp from 'node:fs/promises';
import { dehydrate, rehydrate } from './messageWire';
import {
  appendText,
  ensureDir,
  listDirs,
  pathExists,
  readJsonOrNull,
  readTextOrNull,
  removeFileIfExists,
  writeJson,
  writeText,
} from './lib/atomic';

export interface SubrunParent {
  profileId: string;
  parentAgentId: string;
  parentSessionId: string;
  subrunsDir: string;
}

export interface CreatedSubrun {
  kind: 'created';
  subrun: Subrun;
}

export interface ExhaustedSubrunAllocation {
  kind: 'exhausted';
}

export type CreateSubrunResult = CreatedSubrun | ExhaustedSubrunAllocation;

export interface FoundSubrun {
  kind: 'found';
  subrun: Subrun;
}

export interface MissingSubrun {
  kind: 'missing';
}

export interface InvalidSubrunId {
  kind: 'invalid_id';
}

export interface IncompleteSubrun {
  kind: 'incomplete';
  subrunId: SubrunId;
}

export interface CorruptSubrun {
  kind: 'corrupt';
  subrunId: SubrunId;
}

export type GetSubrunResult =
  | FoundSubrun
  | MissingSubrun
  | InvalidSubrunId
  | IncompleteSubrun
  | CorruptSubrun;

export interface ListSubrunsResult {
  subruns: Subrun[];
  incompleteIds: SubrunId[];
  corruptIds: SubrunId[];
}

export interface StartedSubrun {
  kind: 'started';
}

export interface NotPendingSubrun {
  kind: 'not_pending';
  status: SubrunDataFile['status'];
}

export type StartSubrunResult = StartedSubrun | NotPendingSubrun;

export interface FinishedSubrun {
  kind: 'finished';
}

export interface NotRunningSubrun {
  kind: 'not_running';
  status: SubrunDataFile['status'];
}

export interface MismatchedSubrunResult {
  kind: 'result_mismatch';
}

export type FinishSubrunResult = FinishedSubrun | NotRunningSubrun | MismatchedSubrunResult;

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

function isDataForParent(data: SubrunDataFile, parent: SubrunParent, subrunId: SubrunId): boolean {
  return data.version === 1
    && data.kind === 'subrun'
    && data.subrunId === subrunId
    && data.profileId === parent.profileId
    && data.parentAgentId === parent.parentAgentId
    && data.parentSessionId === parent.parentSessionId
    && data.delegateAgentId === data.request.delegateAgentId;
}

function createPendingData(
  parent: SubrunParent,
  subrunId: SubrunId,
  request: SubAgentRunRequest,
  createdAt: string,
): PendingSubrunDataFile {
  return {
    version: 1,
    kind: 'subrun',
    status: 'pending',
    subrunId,
    profileId: parent.profileId,
    parentAgentId: parent.parentAgentId,
    parentSessionId: parent.parentSessionId,
    delegateAgentId: request.delegateAgentId,
    request,
    createdAt,
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
    private data: SubrunDataFile,
    private readonly parent: SubrunParent,
  ) {}

  public get config(): SubrunDataFile['session'] {
    return this.data.session;
  }

  public get subrunId(): SubrunId {
    return this.data.subrunId;
  }

  public get delegateAgentId(): string {
    return this.data.delegateAgentId;
  }

  public get status(): SubrunDataFile['status'] {
    return this.data.status;
  }

  public toDataFile(): SubrunDataFile {
    return this.data;
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
        const data = createPendingData(parent, subrunId, request, createdAt);
        await writeJson(PERSIST_PATH.subrunData(parent.subrunsDir, subrunId), data);
        return { kind: 'created', subrun: new Subrun(data, parent) };
      }

      return { kind: 'exhausted' };
    });
  }

  public static async load(parent: SubrunParent, subrunId: SubrunId): Promise<GetSubrunResult> {
    if (!isSubrunId(subrunId)) return { kind: 'invalid_id' };

    const directory = PERSIST_PATH.subrunDir(parent.subrunsDir, subrunId);
    const data = await readJsonOrNull<SubrunDataFile>(PERSIST_PATH.subrunData(parent.subrunsDir, subrunId));
    if (data === null) {
      return await pathExists(directory)
        ? { kind: 'incomplete', subrunId }
        : { kind: 'missing' };
    }
    if (!isDataForParent(data, parent, subrunId)) return { kind: 'corrupt', subrunId };
    return { kind: 'found', subrun: new Subrun(data, parent) };
  }

  public static async list(parent: SubrunParent): Promise<ListSubrunsResult> {
    const ids = validSubrunIds(parent, await listDirs(parent.subrunsDir));
    const subruns: Subrun[] = [];
    const incompleteIds: SubrunId[] = [];
    const corruptIds: SubrunId[] = [];

    for (const subrunId of ids) {
      const result = await Subrun.load(parent, subrunId);
      if (result.kind === 'found') subruns.push(result.subrun);
      if (result.kind === 'incomplete') incompleteIds.push(subrunId);
      if (result.kind === 'corrupt') corruptIds.push(subrunId);
    }

    return { subruns, incompleteIds, corruptIds };
  }

  public async start(): Promise<StartSubrunResult> {
    if (this.data.status !== 'pending') return { kind: 'not_pending', status: this.data.status };

    const startedAt = new Date().toISOString();
    const data: RunningSubrunDataFile = {
      ...this.data,
      status: 'running',
      startedAt,
      session: {
        ...this.data.session,
        updatedAt: startedAt,
      },
    };
    this.data = data;
    await this.persist();
    return { kind: 'started' };
  }

  public async finish(result: SubAgentRunResult): Promise<FinishSubrunResult> {
    if (this.data.status !== 'running') return { kind: 'not_running', status: this.data.status };
    if (result.subrunId !== this.subrunId || result.delegateAgentId !== this.delegateAgentId) {
      return { kind: 'result_mismatch' };
    }

    const finishedAt = new Date().toISOString();
    const base = {
      ...this.data,
      finishedAt,
      session: {
        ...this.data.session,
        updatedAt: finishedAt,
      },
    };
    let data: TerminalSubrunDataFile;
    switch (result.status) {
      case 'completed':
        data = { ...base, status: 'completed', result };
        break;
      case 'partial':
        data = { ...base, status: 'partial', result };
        break;
      case 'blocked':
        data = { ...base, status: 'blocked', result };
        break;
      case 'failed':
        data = { ...base, status: 'failed', result };
        break;
      case 'cancelled':
        data = { ...base, status: 'cancelled', result };
        break;
    }

    this.data = data;
    await this.flushMessages();
    await this.persist();
    return { kind: 'finished' };
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
