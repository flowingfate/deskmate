import { app, crashReporter } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { APP_VERSION } from '@shared/constants/branding';
import { getAppDataPath } from '@main/persist/lib/path';
import { DiagnosticsStore } from './DiagnosticsStore';
import { diagnosticLogRing } from './DiagnosticLogRing';
import { EmergencyJournal } from './EmergencyJournal';
import { IncidentCorrelator } from './IncidentCorrelator';
import { LifeCycleCoordinator } from './LifeCycleCoordinator';
import { MinidumpCollector } from './MinidumpCollector';
import { RecoveryReconciler, type RecoveryNotice } from './RecoveryReconciler';
import { WindowRegistry, type CrashWebContentsMeta, type CrashWindowMeta } from './WindowRegistry';
import { exportCrashIncident, type IncidentExportOptions, type IncidentExportResult } from './exporter';
import type {
  CrashRecorderStatus,
  IncidentListFilter,
  IncidentRecord,
  IncidentSummary,
  LifecycleRecord,
  ShutdownReason,
  WindowIdentity,
} from './types';
import { safeStderr } from './safeStderr';

export type { RecoveryNotice } from './RecoveryReconciler';

const CHILD_REPEAT_WINDOW_MS = 60_000;
const CHILD_REPEAT_THRESHOLD = 3;

interface ChildRepeatState {
  timestamps: number[];
}

interface ChildProcessGoneDetails {
  type: string;
  reason: string;
  exitCode: number;
  serviceName?: string;
  name?: string;
}

export class CrashRecorder {
  private initialized = false;
  private mode: 'dev' | 'prod' = 'prod';
  private lifeId = 0;
  private acceptingIncidents = true;
  private shuttingDown = false;
  private journalPath = '';
  private artifactDirectory = '';
  private journal = new EmergencyJournal();
  private store: DiagnosticsStore | null = null;
  private coordinator: LifeCycleCoordinator | null = null;
  private correlator: IncidentCorrelator | null = null;
  private collector: MinidumpCollector | null = null;
  private recoveryNotice: RecoveryNotice | null = null;
  private readonly childRepeats = new Map<string, ChildRepeatState>();
  private readonly windows = new WindowRegistry(
    (details, identity, expected) => this.onRendererGone(details, identity, expected),
    () => this.beginShutdown('os-session-end'),
  );

  public bootstrap(isDev: boolean): void {
    if (this.initialized) return;
    this.initialized = true;
    this.mode = isDev ? 'dev' : 'prod';
    const diagnosticsDirectory = path.join(getAppDataPath(), 'diagnostics', this.mode);
    const crashpadRoot = path.join(diagnosticsDirectory, 'crashpad');
    const artifactsDirectory = path.join(diagnosticsDirectory, 'artifacts');
    this.artifactDirectory = artifactsDirectory;
    this.journalPath = path.join(diagnosticsDirectory, 'emergency.ndjson');

    try {
      fs.mkdirSync(diagnosticsDirectory, { recursive: true, mode: 0o700 });
      fs.chmodSync(diagnosticsDirectory, 0o700);
    } catch (error) {
      safeStderr('diagnostics-directory', `Diagnostics directory unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.journal.open(this.journalPath);
    this.journal.setTailProvider(() => diagnosticLogRing.emergencyTailJson());
    this.journal.installFatalMonitor();

    let previous: LifecycleRecord | null = null;
    const startedAt = Date.now();
    try {
      this.store = new DiagnosticsStore(diagnosticsDirectory);
      this.coordinator = new LifeCycleCoordinator(
        this.store,
        path.join(getAppDataPath(), 'logs', isDev ? 'dev.db' : 'app.db'),
        {
          appVersion: APP_VERSION,
          electronVersion: process.versions.electron,
          platform: process.platform,
          arch: process.arch,
        },
      );
      const allocated = this.coordinator.allocate(startedAt);
      this.lifeId = allocated.lifeId;
      previous = allocated.previous;
    } catch (error) {
      this.store = null;
      this.coordinator = null;
      this.lifeId = 0;
      safeStderr('store-open', `Crash Recorder database unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    diagnosticLogRing.bindLife(this.lifeId);
    this.journal.bindLife(this.lifeId);
    this.startCrashpad(crashpadRoot);

    if (this.store) {
      this.correlator = new IncidentCorrelator(
        this.store,
        diagnosticLogRing,
        this.lifeId,
        APP_VERSION,
        process.versions.electron,
      );
      this.collector = new MinidumpCollector(crashpadRoot, artifactsDirectory, this.store, this.correlator);
      const candidates = this.collector.discoverCandidates();
      this.recoveryNotice = new RecoveryReconciler(
        this.journal,
        this.journalPath,
        this.store,
        this.correlator,
        this.collector,
        this.lifeId,
      ).recover(previous, startedAt, candidates);
      this.collector.collectSoon();
      setImmediate(() => {
        try {
          this.store?.runRetention();
          this.collector?.cleanup();
        } catch (error) {
          safeStderr('retention', `Retention failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    }
    this.registerAppEvents();
  }

  public registerWindow(window: Electron.BrowserWindow, meta: CrashWindowMeta): void {
    this.windows.register(window, meta);
  }

  public registerWebContents(webContents: Electron.WebContents, meta: CrashWebContentsMeta): void {
    this.windows.registerWebContents(webContents, meta);
  }

  public markWindowExpectedTermination(window: Electron.BrowserWindow): void {
    this.windows.markExpected(window);
  }

  public markWebContentsExpectedTermination(webContents: Electron.WebContents): void {
    this.windows.markWebContentsExpected(webContents);
  }

  public beginShutdown(reason: ShutdownReason): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.acceptingIncidents = false;
    this.windows.markAllExpected();
    try {
      this.coordinator?.beginShutdown(this.lifeId, reason);
      this.correlator?.finalizeAll();
    } catch (error) {
      safeStderr('begin-shutdown', `Failed to begin shutdown: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public finishShutdown(exitCode: number): void {
    try {
      this.coordinator?.finishShutdown(this.lifeId, exitCode);
    } catch (error) {
      safeStderr('finish-shutdown', `Failed to finish shutdown: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public close(): void {
    this.collector?.stop();
    this.collector = null;
    try {
      this.store?.close();
    } catch {
      // 退出时不阻塞应用。
    }
    this.store = null;
    this.journal.close();
  }

  public status(): CrashRecorderStatus {
    return { available: this.store !== null, lifeId: this.lifeId, mode: this.mode };
  }

  public listIncidents(filter: IncidentListFilter = {}): IncidentSummary[] {
    try {
      return this.store?.listIncidents(filter) ?? [];
    } catch (error) {
      safeStderr('incident-list', `Incident query failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  public readIncident(incidentId: string): IncidentRecord | null {
    try {
      return this.store?.incident(incidentId) ?? null;
    } catch (error) {
      safeStderr('incident-read', `Incident read failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  public async exportIncident(incidentId: string, options: IncidentExportOptions): Promise<IncidentExportResult> {
    const store = this.store;
    if (!store) return { success: false, error: 'Crash Recorder is unavailable.' };
    try {
      return await exportCrashIncident(store, this.artifactDirectory, incidentId, options);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  public takeRecoveryNotice(): RecoveryNotice | null {
    const notice = this.recoveryNotice;
    this.recoveryNotice = null;
    return notice;
  }

  public requestMinidumpCollection(): void {
    this.collector?.collectSoon(this.lifeId);
  }

  private startCrashpad(crashpadRoot: string): void {
    try {
      fs.mkdirSync(crashpadRoot, { recursive: true, mode: 0o700 });
      app.setPath('crashDumps', crashpadRoot);
      crashReporter.start({
        productName: app.getName(),
        uploadToServer: false,
        compress: false,
        globalExtra: {
          life_id: String(this.lifeId),
          app_version: APP_VERSION.slice(0, 127),
        },
      });
    } catch (error) {
      safeStderr('crashpad-start', `Crashpad failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private registerAppEvents(): void {
    app.on('child-process-gone', (_event, details) => this.onChildGone(details));
  }

  private onRendererGone(
    details: Electron.RenderProcessGoneDetails,
    window: WindowIdentity,
    expectedTermination: boolean,
  ): void {
    if (details.reason === 'clean-exit') return;
    if (details.reason === 'killed' && (this.shuttingDown || expectedTermination)) return;
    if (!this.acceptingIncidents) return;
    this.correlator?.record({
      type: 'renderer_gone',
      occurredAt: Date.now(),
      reason: details.reason,
      exitCode: details.exitCode,
      window,
    });
    this.collector?.collectSoon(this.lifeId);
  }

  private onChildGone(details: ChildProcessGoneDetails): void {
    if (details.reason === 'clean-exit') return;
    const occurredAt = Date.now();
    if (details.reason === 'killed' && this.shuttingDown) return;
    if (!this.acceptingIncidents) return;
    const serviceName = details.serviceName ?? null;
    const processName = details.name ?? null;
    if (details.reason === 'killed' && !this.correlator?.hasOpenIncidentNear(occurredAt)) {
      const key = `${details.type}:${serviceName ?? processName ?? ''}`;
      const state = this.childRepeats.get(key) ?? { timestamps: [] };
      state.timestamps = state.timestamps.filter((timestamp) => occurredAt - timestamp <= CHILD_REPEAT_WINDOW_MS);
      state.timestamps.push(occurredAt);
      this.childRepeats.set(key, state);
      if (state.timestamps.length < CHILD_REPEAT_THRESHOLD) return;
    }
    this.correlator?.record({
      type: 'child_gone',
      occurredAt,
      processType: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName,
      processName,
    });
    this.collector?.collectSoon(this.lifeId);
  }
}

declare global {
  var __deskmateCrashRecorder: CrashRecorder | undefined;
}

export const crashRecorder = globalThis.__deskmateCrashRecorder ??= new CrashRecorder();
