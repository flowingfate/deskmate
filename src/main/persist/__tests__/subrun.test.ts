import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  PersistSubrunDataFile,
  SubAgentRunResultByStatus,
  SubAgentRunRequest,
  SubrunId,
} from '../../../shared/persist/types';
import { isSubrunId } from '../../../shared/persist/types';

import { Subrun, type SubrunParent } from '../subrun';
import { readJsonOrNull } from '../lib/atomic';

let tmpRoot = '';

const request: SubAgentRunRequest = {
  delegateAgentId: 'a_delegate',
  task: 'Write the report.',
  expectedOutput: 'A report.',
  context: { kind: 'isolated' },
  policy: { maxTurns: 25, timeoutMs: 60_000 },
};

function parent(): SubrunParent {
  return {
    profileId: 'p_test',
    parentAgentId: 'a_parent',
    parentSessionId: 's_parent',
    subrunsDir: path.join(tmpRoot, 'subruns'),
  };
}

function completedResult(subrunId: SubrunId, delegateAgentId: string): SubAgentRunResultByStatus['completed'] {
  return {
    status: 'completed',
    subrunId,
    delegateAgentId,
    content: 'Completed.',
    deliverables: [],
    warnings: [],
    usage: { turns: 1, durationMs: 10 },
  };
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'subrun-test-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('SubrunId', () => {
  it('accepts only three-digit parent-local sequences from 001 through 999', () => {
    expect(['001', '010', '999'].every(isSubrunId)).toBe(true);
    expect(['000', '1', '01', '1000', 'abc'].some(isSubrunId)).toBe(false);
  });
});

describe('Subrun allocation', () => {
  it('serializes concurrent reservations and never reuses an incomplete sequence', async () => {
    const owner = parent();
    const first = await Subrun.create(owner, request);
    expect(first.kind).toBe('created');

    await fs.mkdir(path.join(owner.subrunsDir, '002'));
    expect(await Subrun.load(owner, '002')).toEqual({ kind: 'incomplete', subrunId: '002' });

    const concurrent = await Promise.all([
      Subrun.create(owner, request),
      Subrun.create(owner, request),
      Subrun.create(owner, request),
    ]);
    const allocatedIds = concurrent.flatMap((result) => result.kind === 'created' ? [result.subrun.subrunId] : []);

    expect(allocatedIds.sort()).toEqual(['003', '004', '005']);
  });
});

describe('Subrun state machine', () => {
  it('persists only a matching terminal result after running', async () => {
    const owner = parent();
    const created = await Subrun.create(owner, request);
    if (created.kind !== 'created') throw new Error('Expected an allocated subrun.');

    const subrun = created.subrun;
    expect(await subrun.start()).toEqual({ kind: 'started' });
    expect(await subrun.finish(completedResult('999', subrun.delegateAgentId))).toEqual({ kind: 'result_mismatch' });
    expect(subrun.status).toBe('running');

    expect(await subrun.finish(completedResult(subrun.subrunId, subrun.delegateAgentId))).toEqual({ kind: 'finished' });
    expect(await fs.readdir(path.join(owner.subrunsDir, subrun.subrunId))).toEqual(['data.json']);

    const loaded = await Subrun.load(owner, subrun.subrunId);
    if (loaded.kind !== 'found') throw new Error('Expected the persisted subrun.');
    expect(loaded.subrun.status).toBe('completed');
    expect(loaded.subrun.result).toMatchObject({ status: 'completed', subrunId: subrun.subrunId });

    const persisted = await readJsonOrNull<PersistSubrunDataFile>(
      path.join(owner.subrunsDir, subrun.subrunId, 'data.json'),
    );
    expect(persisted).toEqual({
      version: 1,
      id: subrun.subrunId,
      delegateAgentId: subrun.delegateAgentId,
      histories: [{
        status: 'completed',
        execution: {
          kind: 'initial',
          message: request.task,
          expectedOutput: request.expectedOutput,
          context: request.context,
          policy: request.policy,
        },
        startedAt: expect.any(String),
        finishedAt: expect.any(String),
        result: {
          content: 'Completed.',
          deliverables: [],
          warnings: [],
          usage: { turns: 1, durationMs: 10 },
        },
      }],
      session: {
        title: '',
        updatedAt: expect.any(String),
        contextState: { compressions: [] },
      },
    });
    expect(persisted).not.toHaveProperty('profileId');
    expect(persisted).not.toHaveProperty('parentAgentId');
    expect(persisted).not.toHaveProperty('parentSessionId');
    expect(persisted).not.toHaveProperty('request');
    expect(persisted).not.toHaveProperty('result');
  });
});


describe('Subrun continuation', () => {
  it('reuses one terminal subrun', async () => {
    const owner = parent();
    const created = await Subrun.create(owner, request);
    if (created.kind !== 'created') throw new Error('Expected an allocated subrun.');

    const subrun = created.subrun;
    await subrun.start();
    const initial = completedResult(subrun.subrunId, subrun.delegateAgentId);
    await subrun.finish(initial);

    expect(await subrun.continueConversation(
      'Add rollout risks.',
      { maxTurns: 10, timeoutMs: 60_000 },
    )).toEqual({ kind: 'continued' });
    expect(subrun.status).toBe('running');
    expect(subrun.execution).toMatchObject({ kind: 'continuation', message: 'Add rollout risks.' });

    const followUp = { ...initial, content: 'Rollout risks added.', usage: { turns: 1, durationMs: 20 } };
    await subrun.finish(followUp);
    expect(subrun.status).toBe('completed');
    expect(subrun.result).toEqual(followUp);
    expect(subrun.execution).toEqual({
      kind: 'continuation',
      message: 'Add rollout risks.',
      policy: { maxTurns: 10, timeoutMs: 60_000 },
    });

    const persisted = await readJsonOrNull<PersistSubrunDataFile>(
      path.join(owner.subrunsDir, subrun.subrunId, 'data.json'),
    );
    expect(persisted?.histories).toHaveLength(2);
    expect(persisted?.histories[0]).toMatchObject({
      status: 'completed',
      execution: { kind: 'initial', message: request.task },
      result: { content: 'Completed.' },
    });
    expect(persisted?.histories[1]).toMatchObject({
      status: 'completed',
      execution: { kind: 'continuation', message: 'Add rollout risks.' },
      result: { content: 'Rollout risks added.' },
    });
    expect(persisted?.histories[0]).not.toHaveProperty('result.status');
    expect(persisted?.histories[0]).not.toHaveProperty('result.subrunId');
    expect(persisted?.histories[0]).not.toHaveProperty('result.delegateAgentId');
  });

  it('rejects continuation while the subrun is active', async () => {
    const owner = parent();
    const created = await Subrun.create(owner, request);
    if (created.kind !== 'created') throw new Error('Expected an allocated subrun.');

    expect(await created.subrun.continueConversation(
      'Follow up.',
      { maxTurns: 10, timeoutMs: 60_000 },
    )).toEqual({ kind: 'not_terminal', status: 'pending' });

  });
});
