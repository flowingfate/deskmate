import type {
  AgentDetail,
  AgentRecord,
  SubAgentRunPolicy,
  SubAgentRunRequest,
  SubAgentRunResult,
  SubrunId,
} from '@shared/persist/types';
import type { SubAgentRunStep, SubAgentRuntimeState } from '@shared/types/subAgentRunTypes';
import type { ListSubrunsResult, Profile, Session, Subrun } from '@main/persist';
import { log } from '@main/log';

import type {
  SubAgentCommandOutcome,
  SubAgentCommandScope,
  SubAgentDelegateDescription,
  SubAgentDescribeDelegateOutcome,
  SubAgentListDelegatesOutcome,
} from './commands';
import type { SubAgentContinuation } from './types';
import {
  advanceRuntimeState,
  completeRuntimeState,
  createPendingRuntimeState,
  interruptedResult,
  persistedRuntimeState,
  startRuntimeState,
} from './runtimeState';

export type SubAgentRuntimeStateListener = (state: SubAgentRuntimeState) => void;

const MAX_PARALLEL_RUNS = 5;
const MAX_TOTAL_RESERVATIONS = 20;

export interface SubAgentParent {
  profileId: string;
  parentAgentId: string;
  parentSessionId: string;
}

export interface SubAgentRunKey extends SubAgentParent {
  subrunId: SubrunId;
}


interface ActiveRun {
  abortor: AbortController;
  state: SubAgentRuntimeState;
}

interface ActiveRunAdmission {
  kind: 'admitted';
  active: ActiveRun;
  subrun: Subrun;
}

interface RejectedAdmission {
  kind: 'rejected';
  error: string;
}

interface PreparedSubrunAdmission {
  kind: 'prepared';
  subrun: Subrun;
}

/** 委派运行的唯一授权、reservation、timeout、cancellation 与 live-state owner。 */
export class SubAgentManager {
  private static readonly managers = new WeakMap<Profile, SubAgentManager>();
  private static readonly stateUpdateListeners = new Set<SubAgentRuntimeStateListener>();

  public static forProfile(profile: Profile): SubAgentManager {
    const existing = SubAgentManager.managers.get(profile);
    if (existing) return existing;

    const manager = new SubAgentManager(profile);
    SubAgentManager.managers.set(profile, manager);
    return manager;
  }

  public static subscribeStateUpdates(listener: SubAgentRuntimeStateListener): () => void {
    SubAgentManager.stateUpdateListeners.add(listener);
    return () => SubAgentManager.stateUpdateListeners.delete(listener);
  }

  private readonly activeRuns = new Map<string, Map<SubrunId, ActiveRun>>();
  private readonly parentLocks = new Map<string, Promise<void>>();
  private readonly stateListeners = new Set<SubAgentRuntimeStateListener>();

  private constructor(private readonly profile: Profile) {}

  public async listDelegates(scope: SubAgentCommandScope): Promise<SubAgentListDelegatesOutcome> {

    const delegates = await this.profile.resolveDelegates(scope.parentAgentId);
    if (!delegates) return { kind: 'rejected', error: 'Parent Agent configuration is unavailable.' };

    return {
      kind: 'result',
      available: delegates.available.map((record) => ({
        delegateAgentId: record.id,
        name: record.name,
        description: record.description,
        model: record.model,
      })),
      unavailableIds: delegates.unavailableIds,
    };
  }

  public async describeDelegate(
    scope: SubAgentCommandScope,
    delegateAgentId: string,
  ): Promise<SubAgentDescribeDelegateOutcome> {

    const delegate = await this.authorizeDelegate(scope.parentAgentId, delegateAgentId);
    if (!delegate.ok) return delegate.outcome;

    const detail = await this.profile.getAgentDetail(delegate.record.id);
    if (!detail) {
      return {
        kind: 'rejected',
        error: `Delegate Agent configuration is unavailable: ${delegate.record.id}.`,
      };
    }

    return { kind: 'result', delegate: toDelegateDescription(delegate.record, detail) };
  }

  public async run(
    scope: SubAgentCommandScope,
    request: SubAgentRunRequest,
  ): Promise<SubAgentCommandOutcome> {
    const parentSession = await this.loadParentSession(scope);
    if (!parentSession.ok) return parentSession.outcome;

    const delegate = await this.authorizeDelegate(scope.parentAgentId, request.delegateAgentId);
    if (!delegate.ok) return delegate.outcome;

    const admission = await this.admitExecution(
      scope,
      parentSession.session,
      async (existing) => {
        const reservationCount = existing.subruns.length + existing.incompleteIds.length;
        if (reservationCount >= MAX_TOTAL_RESERVATIONS) {
          return {
            kind: 'rejected',
            error: `Maximum delegated run reservations (${MAX_TOTAL_RESERVATIONS}) reached for this parent session.`,
          } satisfies RejectedAdmission;
        }

        const created = await parentSession.session.createSubrun(request);
        if (created.kind === 'exhausted') {
          return {
            kind: 'rejected',
            error: 'No Subrun IDs remain for this parent session.',
          } satisfies RejectedAdmission;
        }
        return { kind: 'prepared', subrun: created.subrun } satisfies PreparedSubrunAdmission;
      },
    );

    if (admission.kind === 'rejected') return admission;
    return this.executeRun(scope, request.policy, admission);
  }

  public async continueRun(
    scope: SubAgentCommandScope,
    subrunId: SubrunId,
    continuation: SubAgentContinuation,
  ): Promise<SubAgentCommandOutcome> {
    const parentSession = await this.loadParentSession(scope);
    if (!parentSession.ok) return parentSession.outcome;

    const loaded = await parentSession.session.getSubrun(subrunId);
    if (loaded.kind !== 'found') {
      return { kind: 'rejected', error: `Subrun ${subrunId} is unavailable: ${loaded.kind}.` };
    }

    const delegate = await this.authorizeDelegate(scope.parentAgentId, loaded.subrun.delegateAgentId);
    if (!delegate.ok) return delegate.outcome;

    const admission = await this.admitExecution(
      scope,
      parentSession.session,
      async () => {
        const current = await parentSession.session.getSubrun(subrunId);
        if (current.kind !== 'found') {
          return {
            kind: 'rejected',
            error: `Subrun ${subrunId} is unavailable: ${current.kind}.`,
          } satisfies RejectedAdmission;
        }

        const continued = await current.subrun.continueConversation(
          continuation.message,
          continuation.policy,
        );
        if (continued.kind !== 'continued') {
          return {
            kind: 'rejected',
            error: `Subrun ${subrunId} is already ${continued.status}.`,
          } satisfies RejectedAdmission;
        }
        return { kind: 'prepared', subrun: current.subrun } satisfies PreparedSubrunAdmission;
      },
    );

    if (admission.kind === 'rejected') return admission;
    return this.executeRun(scope, continuation.policy, admission);
  }

  public cancelRun(key: SubAgentRunKey): boolean {
    const active = this.activeRuns.get(parentKey(key))?.get(key.subrunId);
    if (!active) return false;
    active.abortor.abort();
    return true;
  }

  public cancelByParentSession(parent: SubAgentParent): number {
    const active = this.activeRuns.get(parentKey(parent));
    if (!active) return 0;

    for (const run of active.values()) run.abortor.abort();
    return active.size;
  }

  public subscribe(listener: SubAgentRuntimeStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public async getRuntimeState(key: SubAgentRunKey): Promise<SubAgentRuntimeState | null> {
    const active = this.activeRuns.get(parentKey(key))?.get(key.subrunId);
    if (active) return active.state;

    const parentSession = await this.loadParentSession(key);
    if (!parentSession.ok) return null;

    return this.withParentLock(key, async () => {
      const current = this.activeRuns.get(parentKey(key))?.get(key.subrunId);
      if (current) return current.state;

      const listed = await parentSession.session.listSubruns();
      await this.recoverStaleRuns(key, listed.subruns);
      const loaded = await parentSession.session.getSubrun(key.subrunId);
      return loaded.kind === 'found' ? persistedRuntimeState(loaded.subrun) : null;
    });
  }

  private async admitExecution(
    scope: SubAgentCommandScope,
    parentSession: Session,
    prepareSubrun: (
      existing: ListSubrunsResult,
    ) => Promise<PreparedSubrunAdmission | RejectedAdmission>,
  ): Promise<ActiveRunAdmission | RejectedAdmission> {
    return this.withParentLock(scope, async () => {
      const existing = await parentSession.listSubruns();
      await this.recoverStaleRuns(scope, existing.subruns);

      const active = this.activeRuns.get(parentKey(scope));
      if ((active?.size ?? 0) >= MAX_PARALLEL_RUNS) {
        return {
          kind: 'rejected',
          error: `Maximum parallel delegated runs (${MAX_PARALLEL_RUNS}) reached for this parent session.`,
        } satisfies RejectedAdmission;
      }

      const prepared = await prepareSubrun(existing);
      if (prepared.kind === 'rejected') return prepared;

      const activeRun = this.registerActiveRun(scope, prepared.subrun);
      return {
        kind: 'admitted',
        active: activeRun,
        subrun: prepared.subrun,
      } satisfies ActiveRunAdmission;
    });
  }

  private async executeRun(
    scope: SubAgentCommandScope,
    policy: SubAgentRunPolicy,
    admission: ActiveRunAdmission,
  ): Promise<SubAgentCommandOutcome> {
    const onParentAbort = (): void => admission.active.abortor.abort();
    if (scope.signal.aborted) admission.active.abortor.abort();
    else scope.signal.addEventListener('abort', onParentAbort, { once: true });
    const timeout = setTimeout(() => admission.active.abortor.abort(), policy.timeoutMs);

    try {
      const { SubAgentSession } = await import('./session');
      const outcome = await new SubAgentSession({
        subrun: admission.subrun,
        signal: admission.active.abortor.signal,
        parentTracer: scope.tracer,
        callbacks: {
          onStep: (step) => this.recordStep(scope, admission.subrun.subrunId, step),
          onResult: (result) => this.recordResult(scope, admission.subrun.subrunId, result),
        },
      }).run();

      if (outcome.kind === 'not_pending') {
        return {
          kind: 'rejected',
          error: `Subrun ${admission.subrun.subrunId} could not start from status ${outcome.status}.`,
        };
      }
      return { kind: 'result', result: outcome.result };
    } finally {
      clearTimeout(timeout);
      scope.signal.removeEventListener('abort', onParentAbort);
      this.releaseActiveRun(scope, admission.subrun.subrunId);
    }
  }

  private async loadParentSession(parent: SubAgentParent): Promise<
    { ok: true; session: Session }
    | { ok: false; outcome: { kind: 'rejected'; error: string } }
  > {
    const agent = await this.profile.getAgent(parent.parentAgentId);
    if (!agent) return { ok: false, outcome: { kind: 'rejected', error: 'Parent Agent is unavailable.' } };

    const session = await agent.findSessionAcrossKinds(parent.parentSessionId);
    if (!session) return { ok: false, outcome: { kind: 'rejected', error: 'Parent session is unavailable.' } };

    return { ok: true, session };
  }

  private async authorizeDelegate(
    parentAgentId: string,
    delegateAgentId: string,
  ): Promise<
    { ok: true; record: AgentRecord }
    | { ok: false; outcome: { kind: 'rejected'; error: string } }
  > {
    const delegates = await this.profile.resolveDelegates(parentAgentId);
    if (!delegates) {
      return { ok: false, outcome: { kind: 'rejected', error: 'Parent Agent configuration is unavailable.' } };
    }

    const record = delegates.available.find((candidate) => candidate.id === delegateAgentId);
    if (record) return { ok: true, record };

    if (delegateAgentId === parentAgentId) {
      return { ok: false, outcome: { kind: 'rejected', error: 'An Agent cannot delegate to itself.' } };
    }
    if (delegates.unavailableIds.includes(delegateAgentId)) {
      return {
        ok: false,
        outcome: { kind: 'rejected', error: `Delegate Agent is unavailable: ${delegateAgentId}.` },
      };
    }
    return {
      ok: false,
      outcome: { kind: 'rejected', error: `Delegate Agent is not allowed: ${delegateAgentId}.` },
    };
  }

  private registerActiveRun(
    scope: SubAgentCommandScope,
    subrun: Subrun,
  ): ActiveRun {
    const pending = createPendingRuntimeState(subrun, scope.correlationId);
    const active: ActiveRun = { abortor: new AbortController(), state: pending };
    const key = parentKey(scope);
    const runs = this.activeRuns.get(key) ?? new Map<SubrunId, ActiveRun>();
    runs.set(subrun.subrunId, active);
    this.activeRuns.set(key, runs);
    this.publish(pending);

    const running = startRuntimeState(pending);
    active.state = running;
    this.publish(running);
    return active;
  }

  private releaseActiveRun(parent: SubAgentParent, subrunId: SubrunId): void {
    const key = parentKey(parent);
    const runs = this.activeRuns.get(key);
    if (!runs) return;
    runs.delete(subrunId);
    if (runs.size === 0) this.activeRuns.delete(key);
  }

  private recordStep(parent: SubAgentParent, subrunId: SubrunId, step: SubAgentRunStep): void {
    const active = this.activeRuns.get(parentKey(parent))?.get(subrunId);
    if (!active) return;

    const next = advanceRuntimeState(active.state, step);
    if (!next) return;
    active.state = next;
    this.publish(next);
  }

  private recordResult(parent: SubAgentParent, subrunId: SubrunId, result: SubAgentRunResult): void {
    const active = this.activeRuns.get(parentKey(parent))?.get(subrunId);
    if (!active) return;

    const state = completeRuntimeState(active.state, result);
    if (!state) return;
    active.state = state;
    this.publish(state);
  }

  private async recoverStaleRuns(parent: SubAgentParent, subruns: readonly Subrun[]): Promise<void> {
    const active = this.activeRuns.get(parentKey(parent));

    for (const subrun of subruns) {
      if (subrun.status !== 'running' || active?.has(subrun.subrunId)) continue;

      const result = interruptedResult(subrun);
      const startedAt = subrun.startedAt;
      const finished = await subrun.finish(result);
      if (finished.kind !== 'finished') {
        throw new Error(`Could not recover Subrun ${subrun.subrunId}: ${finished.kind}`);
      }
      const started = startRuntimeState(createPendingRuntimeState(subrun), Date.parse(startedAt));
      const recovered = completeRuntimeState(started, result);
      this.publish(recovered ?? persistedRuntimeState(subrun));
      log.warn({
        msg: 'Recovered interrupted delegated run',
        mod: 'pi.subagent.manager',
        profileId: parent.profileId,
        parentAgentId: parent.parentAgentId,
        parentSessionId: parent.parentSessionId,
        subrunId: subrun.subrunId,
      });
    }
  }


  private async withParentLock<T>(parent: SubAgentParent, action: () => Promise<T>): Promise<T> {
    const key = parentKey(parent);
    const previous = this.parentLocks.get(key);
    const current = Promise.withResolvers<void>();
    this.parentLocks.set(key, current.promise);
    if (previous) await previous;

    try {
      return await action();
    } finally {
      current.resolve();
      if (this.parentLocks.get(key) === current.promise) this.parentLocks.delete(key);
    }
  }

  private publish(state: SubAgentRuntimeState): void {
    SubAgentManager.notifyStateListeners(this.stateListeners, state);
    SubAgentManager.notifyStateListeners(SubAgentManager.stateUpdateListeners, state);
  }

  private static notifyStateListeners(
    listeners: ReadonlySet<SubAgentRuntimeStateListener>,
    state: SubAgentRuntimeState,
  ): void {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        log.warn({ msg: 'Subrun state listener failed', mod: 'pi.subagent.manager', err: error });
      }
    }
  }

}


function parentKey(parent: SubAgentParent): string {
  return `${parent.parentAgentId}\u0000${parent.parentSessionId}`;
}


function toDelegateDescription(record: AgentRecord, detail: AgentDetail): SubAgentDelegateDescription {
  const localTools = detail.tools && detail.tools.length > 0
    ? { kind: 'selected' as const, names: detail.tools }
    : { kind: 'all' as const };
  const mcpServers = (detail.mcpServers ?? []).map((server) => ({
    serverName: server.name,
    toolNames: server.tools ?? [],
  }));
  const skills = Object.entries(detail.skills ?? {}).map(([name, tier]) => ({ name, tier }));

  return {
    delegateAgentId: record.id,
    name: record.name,
    description: record.description,
    model: record.model,
    thinkingLevel: detail.thinkingLevel,
    localTools,
    mcpServers,
    skills,
  };
}
