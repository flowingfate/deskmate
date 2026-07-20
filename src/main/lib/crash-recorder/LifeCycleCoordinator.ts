import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import type { LifecycleRecord } from './types';
import { MAX_LIFE_ID } from './types';
import type { DiagnosticsStore } from './DiagnosticsStore';
import { safeStderr } from './safeStderr';

interface LogLifeRow {
  life_id: number;
  ts: number;
}

export interface AllocateLifeResult {
  lifeId: number;
  previous: LifecycleRecord | null;
}

export interface LifeMetadata {
  appVersion: string;
  electronVersion: string;
  platform: string;
  arch: string;
}

export function nextLifeId(previousLifeId: number): number {
  return (previousLifeId % MAX_LIFE_ID) + 1;
}

function newestLife(left: LogLifeRow | null, right: LogLifeRow | null): LogLifeRow | null {
  if (!left) return right;
  if (!right) return left;
  return left.ts >= right.ts ? left : right;
}

function readLatestLogLife(logDbPath: string): LogLifeRow | null {
  if (!fs.existsSync(logDbPath)) return null;
  const db = new Database(logDbPath);
  try {
    const table = db.prepare<[], { present: number }>("SELECT count(*) AS present FROM sqlite_master WHERE type = 'table' AND name = 'app_logs'").get();
    if (!table?.present) return null;
    return db.prepare<[], LogLifeRow>('SELECT life_id, ts FROM app_logs ORDER BY ts DESC, id DESC LIMIT 1').get() ?? null;
  } finally {
    db.close();
  }
}

function clearLogLife(logDbPath: string, lifeId: number): void {
  if (!fs.existsSync(logDbPath)) return;
  const db = new Database(logDbPath);
  try {
    const table = db.prepare<[], { present: number }>("SELECT count(*) AS present FROM sqlite_master WHERE type = 'table' AND name = 'app_logs'").get();
    if (table?.present) db.prepare('DELETE FROM app_logs WHERE life_id = ?').run(lifeId);
  } finally {
    db.close();
  }
}

export class LifeCycleCoordinator {
  public constructor(
    private readonly store: DiagnosticsStore,
    private readonly logDbPath: string,
    private readonly metadata: LifeMetadata,
  ) {}

  public allocate(startedAt = Date.now()): AllocateLifeResult {
    const previous = this.store.latestLifecycle();
    let logLife: LogLifeRow | null = null;
    try {
      logLife = readLatestLogLife(this.logDbPath);
    } catch (error) {
      safeStderr('log-life-read', `Log lifecycle read failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const storeLife = previous ? { life_id: previous.lifeId, ts: previous.startedAt } : null;
    const newest = newestLife(storeLife, logLife);
    const lifeId = nextLifeId(newest?.life_id ?? 0);

    this.store.deleteLifecycle(lifeId);
    try {
      clearLogLife(this.logDbPath, lifeId);
    } catch (error) {
      safeStderr('log-life-clear', `Log lifecycle cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.store.startLifecycle({
      lifeId,
      startedAt,
      state: 'running',
      closingAt: null,
      endedAt: null,
      shutdownReason: null,
      exitCode: null,
      appVersion: this.metadata.appVersion,
      electronVersion: this.metadata.electronVersion,
      platform: this.metadata.platform,
      arch: this.metadata.arch,
    });
    return { lifeId, previous };
  }

  public beginShutdown(lifeId: number, reason: string): void {
    if (lifeId === 0) return;
    this.store.beginShutdown(lifeId, reason, Date.now());
  }

  public finishShutdown(lifeId: number, exitCode: number): void {
    if (lifeId === 0) return;
    this.store.finishShutdown(lifeId, exitCode, Date.now());
  }
}
