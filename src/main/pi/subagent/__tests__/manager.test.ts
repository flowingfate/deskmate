import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubAgentRunRequest } from '../../../../shared/persist/types';
import { Tracer } from '../../../../shared/log/trace';
import type { SubAgentSessionOptions, SubAgentSessionRunOutcome } from '../session';

interface PendingSession {
  options: SubAgentSessionOptions;
  completion: PromiseWithResolvers<SubAgentSessionRunOutcome>;
}

const sessionHarness = vi.hoisted(() => {
  const pending: PendingSession[] = [];
  return {
    pending,
    reset(): void {
      pending.splice(0);
    },
  };
});

vi.mock('../session', () => ({
  SubAgentSession: class {
    private readonly completion: PromiseWithResolvers<SubAgentSessionRunOutcome>;

    constructor(options: SubAgentSessionOptions) {
      this.completion = Promise.withResolvers<SubAgentSessionRunOutcome>();
      sessionHarness.pending.push({ options, completion: this.completion });
    }

    public run(): Promise<SubAgentSessionRunOutcome> {
      return this.completion.promise;
    }
  },
}));

import type { SubAgentManager } from '../manager';

let tmpRoot = '';

function request(delegateAgentId: string): SubAgentRunRequest {
  return {
    delegateAgentId,
    task: 'Inspect the report.',
    expectedOutput: 'A concise review.',
    context: { kind: 'isolated' },
    policy: { maxTurns: 25, timeoutMs: 60_000 },
  };
}

function completedOutcome(options: SubAgentSessionOptions): SubAgentSessionRunOutcome {
  return {
    kind: 'result',
    result: {
      status: 'completed',
      subrunId: options.subrun.subrunId,
      delegateAgentId: options.subrun.delegateAgentId,
      content: 'Completed.',
      deliverables: [],
      warnings: [],
      usage: { turns: 1, durationMs: 1 },
    },
  };
}

async function waitForPending(count: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (sessionHarness.pending.length === count) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Expected ${count} pending delegated sessions.`);
}

async function setupRun(): Promise<{
  profileId: string;
  parentAgentId: string;
  parentSessionId: string;
  delegateAgentId: string;
  manager: SubAgentManager;
}> {
  vi.resetModules();
  const root = await import('../../../persist/lib/root');
  const { ProfileRegistry } = await import('../../../profileRegistry');
  const { ProfileDb } = await import('../../../persist/lib/db/db');
  const { SubAgentManager } = await import('../manager');
  root.setRootForTesting(tmpRoot);
  ProfileRegistry.resetForTesting();
  ProfileDb.resetForTesting();
  await ProfileRegistry.bootstrap();
  const store = ProfileRegistry.require(ProfileRegistry.defaultProfileId).store
  const parent = await store.createAgent({ name: 'Parent', version: '1', model: 'model-parent' });
  const delegate = await store.createAgent({ name: 'Delegate', version: '1', model: 'model-delegate' });
  await parent.patchFront({ delegates: [delegate.id] });
  const session = await parent.createSession({ title: 'Parent session' });

  return {
    profileId: store.id,
    parentAgentId: parent.id,
    parentSessionId: session.id,
    delegateAgentId: delegate.id,
    manager: new SubAgentManager(store),
  };
}

function scope(setup: Awaited<ReturnType<typeof setupRun>>) {
  return {
    profileId: setup.profileId,
    parentAgentId: setup.parentAgentId,
    parentSessionId: setup.parentSessionId,
    signal: new AbortController().signal,
    tracer: Tracer.noop,
    correlationId: 'call_1',
  };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-manager-test-'));
  sessionHarness.reset();
});

afterEach(async () => {
  const { ProfileDb } = await import('../../../persist/lib/db/db');
  ProfileDb.closeAll();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('SubAgentManager admission and cancellation', () => {
  it('enforces the parallel cap, aborts only the requested run, and releases slots after completion', async () => {
    const setup = await setupRun();
    const parentScope = scope(setup);
    const runs = Array.from({ length: 5 }, () => setup.manager.run(parentScope, request(setup.delegateAgentId)));
    await waitForPending(5);

    await expect(setup.manager.run(parentScope, request(setup.delegateAgentId))).resolves.toEqual({
      kind: 'rejected',
      error: 'Maximum parallel delegated runs (5) reached for this parent session.',
    });

    const [first, ...siblings] = sessionHarness.pending;
    expect(setup.manager.cancelRun({
      profileId: setup.profileId,
      parentAgentId: setup.parentAgentId,
      parentSessionId: setup.parentSessionId,
      subrunId: first.options.subrun.subrunId,
    })).toBe(true);
    expect(first.options.signal.aborted).toBe(true);
    expect(siblings.every((pending) => !pending.options.signal.aborted)).toBe(true);

    for (const pending of sessionHarness.pending) {
      pending.completion.resolve(completedOutcome(pending.options));
    }
    expect(await Promise.all(runs)).toHaveLength(5);
    expect(setup.manager.cancelRun({
      profileId: setup.profileId,
      parentAgentId: setup.parentAgentId,
      parentSessionId: setup.parentSessionId,
      subrunId: first.options.subrun.subrunId,
    })).toBe(false);
  });

  it('cancels every active sibling for one parent session', async () => {
    const setup = await setupRun();
    const parentScope = scope(setup);
    const runs = [
      setup.manager.run(parentScope, request(setup.delegateAgentId)),
      setup.manager.run(parentScope, request(setup.delegateAgentId)),
    ];
    await waitForPending(2);

    expect(setup.manager.cancelByParentSession({
      profileId: setup.profileId,
      parentAgentId: setup.parentAgentId,
      parentSessionId: setup.parentSessionId,
    })).toBe(2);
    expect(sessionHarness.pending.every((pending) => pending.options.signal.aborted)).toBe(true);

    for (const pending of sessionHarness.pending) {
      pending.completion.resolve(completedOutcome(pending.options));
    }
    await Promise.all(runs);
  });

  it('converts an unowned persisted running subrun into an interrupted terminal state', async () => {
    const setup = await setupRun();
    const { ProfileRegistry } = await import('../../../profileRegistry')
    const store = ProfileRegistry.require(ProfileRegistry.defaultProfileId).store
    const parent = await store.getAgent(setup.parentAgentId);
    if (!parent) throw new Error('Expected parent agent.');
    const session = await parent.getSession(setup.parentSessionId);
    if (!session) throw new Error('Expected parent session.');
    const created = await session.createSubrun(request(setup.delegateAgentId));
    if (created.kind !== 'created') throw new Error('Expected persisted subrun.');
    await created.subrun.start();

    const state = await setup.manager.getRuntimeState({
      profileId: setup.profileId,
      parentAgentId: setup.parentAgentId,
      parentSessionId: setup.parentSessionId,
      subrunId: created.subrun.subrunId,
    });

    expect(state).toMatchObject({
      status: 'failed',
      result: { error: 'Subrun interrupted by application restart.' },
    });
    const reloaded = await session.getSubrun(created.subrun.subrunId);
    if (reloaded.kind !== 'found') throw new Error('Expected recovered subrun on disk.');
    expect(reloaded.subrun.status).toBe('failed');
  });

  it('continues a terminal subrun without allocating another reservation', async () => {
    const setup = await setupRun();
    const { ProfileRegistry } = await import('../../../profileRegistry')
    const store = ProfileRegistry.require(ProfileRegistry.defaultProfileId).store
    const parent = await store.getAgent(setup.parentAgentId);
    if (!parent) throw new Error('Expected parent agent.');
    const session = await parent.getSession(setup.parentSessionId);
    if (!session) throw new Error('Expected parent session.');

    const created = await session.createSubrun(request(setup.delegateAgentId));
    if (created.kind !== 'created') throw new Error('Expected persisted subrun.');
    await created.subrun.start();
    await created.subrun.finish({
      status: 'completed',
      subrunId: created.subrun.subrunId,
      delegateAgentId: setup.delegateAgentId,
      content: 'Initial result.',
      deliverables: [],
      warnings: [],
      usage: { turns: 1, durationMs: 1 },
    });

    const outcome = setup.manager.continueRun(scope(setup), created.subrun.subrunId, {
      message: 'Add risks.',
      policy: { maxTurns: 5, timeoutMs: 60_000 },
    });
    await waitForPending(1);
    expect((await session.listSubruns()).subruns).toHaveLength(1);

    const [pending] = sessionHarness.pending;
    expect(pending.options.subrun.subrunId).toBe(created.subrun.subrunId);
    pending.completion.resolve(completedOutcome(pending.options));
    await expect(outcome).resolves.toMatchObject({
      kind: 'result',
      result: { subrunId: created.subrun.subrunId },
    });
  });

  it('applies the shared parallel cap before transitioning a continuation', async () => {
    const setup = await setupRun();
    const { ProfileRegistry } = await import('../../../profileRegistry')
    const store = ProfileRegistry.require(ProfileRegistry.defaultProfileId).store
    const parent = await store.getAgent(setup.parentAgentId);
    if (!parent) throw new Error('Expected parent agent.');
    const session = await parent.getSession(setup.parentSessionId);
    if (!session) throw new Error('Expected parent session.');

    const created = await session.createSubrun(request(setup.delegateAgentId));
    if (created.kind !== 'created') throw new Error('Expected persisted subrun.');
    await created.subrun.start();
    await created.subrun.finish({
      status: 'completed',
      subrunId: created.subrun.subrunId,
      delegateAgentId: setup.delegateAgentId,
      content: 'Initial result.',
      deliverables: [],
      warnings: [],
      usage: { turns: 1, durationMs: 1 },
    });

    const parentScope = scope(setup);
    const activeRuns = Array.from(
      { length: 5 },
      () => setup.manager.run(parentScope, request(setup.delegateAgentId)),
    );
    await waitForPending(5);

    await expect(setup.manager.continueRun(parentScope, created.subrun.subrunId, {
      message: 'Add risks.',
      policy: { maxTurns: 5, timeoutMs: 60_000 },
    })).resolves.toEqual({
      kind: 'rejected',
      error: 'Maximum parallel delegated runs (5) reached for this parent session.',
    });

    const unchanged = await session.getSubrun(created.subrun.subrunId);
    if (unchanged.kind !== 'found') throw new Error('Expected persisted subrun.');
    expect(unchanged.subrun.status).toBe('completed');

    for (const pending of sessionHarness.pending) {
      pending.completion.resolve(completedOutcome(pending.options));
    }
    await Promise.all(activeRuns);
  });
});
