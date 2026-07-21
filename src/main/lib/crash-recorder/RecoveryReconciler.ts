import type { DiagnosticsStore } from './DiagnosticsStore';
import type { EmergencyJournal } from './EmergencyJournal';
import type { IncidentCorrelator } from './IncidentCorrelator';
import type { MinidumpCandidate, MinidumpCollector } from './MinidumpCollector';
import type { EmergencyMainFatalRecord, LifecycleRecord } from './types';

export interface RecoveryNotice {
  type: 'shutdown_interrupted';
  lifeId: number;
  shutdownReason: string | null;
}

function lifecycleContains(lifecycle: LifecycleRecord, occurredAt: number): boolean {
  return lifecycle.startedAt <= occurredAt
    && (lifecycle.endedAt === null || occurredAt <= lifecycle.endedAt);
}

export class RecoveryReconciler {
  public constructor(
    private readonly journal: EmergencyJournal,
    private readonly journalPath: string,
    private readonly store: DiagnosticsStore,
    private readonly correlator: IncidentCorrelator,
    private readonly collector: MinidumpCollector,
    private readonly lifeId: number,
  ) {}

  public recover(
    previous: LifecycleRecord | null,
    currentStartedAt: number,
    candidates: MinidumpCandidate[],
  ): RecoveryNotice | null {
    this.importEmergency(previous);
    return this.reconcilePrevious(previous, currentStartedAt, candidates);
  }

  private importEmergency(previous: LifecycleRecord | null): void {
    const records = this.journal.importRecords(this.journalPath);
    let imported = 0;
    for (const record of records) {
      const normalized: EmergencyMainFatalRecord = {
        ...record,
        lifeId: this.journalLifeId(record, previous),
      };
      if (this.correlator.recordEmergency(normalized)) imported += 1;
    }
    if (imported === records.length) this.journal.truncateAfterImport(this.journalPath);
  }

  private journalLifeId(record: EmergencyMainFatalRecord, previous: LifecycleRecord | null): number {
    const recordedLifecycle = record.lifeId === 0 ? null : this.store.lifecycle(record.lifeId);
    if (recordedLifecycle && lifecycleContains(recordedLifecycle, record.occurredAt)) {
      return recordedLifecycle.lifeId;
    }
    if (previous && lifecycleContains(previous, record.occurredAt)) return previous.lifeId;
    return this.lifeId;
  }

  private reconcilePrevious(
    previous: LifecycleRecord | null,
    currentStartedAt: number,
    candidates: MinidumpCandidate[],
  ): RecoveryNotice | null {
    if (!previous || previous.state === 'clean' || previous.state === 'interrupted') return null;

    this.store.markInterrupted(previous.lifeId, currentStartedAt);
    if (previous.state === 'closing') {
      return {
        type: 'shutdown_interrupted',
        lifeId: previous.lifeId,
        shutdownReason: previous.shutdownReason,
      };
    }

    const matchingDumps = candidates.filter((candidate) =>
      candidate.modifiedAt >= previous.startedAt && candidate.modifiedAt <= currentStartedAt,
    );
    this.collector.associateCandidatesWithLife(matchingDumps, previous.lifeId);
    if (!this.correlator.hasDirectCrashEvidence(previous.lifeId) && matchingDumps.length === 1) {
      this.correlator.record({
        type: 'main_fatal',
        occurredAt: matchingDumps[0].modifiedAt,
        errorName: 'NativeCrash',
        errorMessage: 'Crashpad recorded a native process crash',
        stack: '',
        origin: 'uncaughtException',
      }, previous.lifeId);
    }
    if (!this.correlator.hasDirectCrashEvidence(previous.lifeId)) {
      this.correlator.record({
        type: 'run_interrupted',
        occurredAt: currentStartedAt,
        previousLifeId: previous.lifeId,
        previousState: 'running',
        previousStartedAt: previous.startedAt,
      }, previous.lifeId);
    }
    return null;
  }
}
