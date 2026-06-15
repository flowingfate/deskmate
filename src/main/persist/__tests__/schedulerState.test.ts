import { vi } from 'vitest';

// Step 9：mock `ProfileDb` —— mock-fs 测试不真打开 SQLite。
const _fakeStmt = { run: () => ({ changes: 0 }), get: () => undefined, all: () => [] };
const _fakeDb = {
  db: { prepare: () => _fakeStmt, pragma: () => 'wal', exec: () => undefined, transaction: (fn: (rows: unknown[]) => void) => (rows: unknown[]) => fn(rows), close: () => undefined },
  checkIntegrity: () => true,
  schemaVersion: () => 1,
};
vi.mock('../lib/db/db', () => ({
  ProfileDb: { open: () => _fakeDb, close: () => undefined, closeAll: () => undefined, resetForTesting: () => undefined },
  profileDbPath: (id: string) => `/mock-fs/${id}/index.db`,
  unlinkProfileDb: () => undefined,
}));

import { beforeEach, describe, expect, it } from 'vitest';

// 内嵌 in-memory fs（与 registries.test.ts 同模板）
interface MemFs { files: Map<string, string>; dirs: Set<string>; }
let state: MemFs = { files: new Map(), dirs: new Set(['/']) };
function resetMemFs() { state = { files: new Map(), dirs: new Set(['/']) }; }
function dirname(p: string) { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); }
function ensureParents(p: string) {
  const parts = p.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) { acc += '/' + part; state.dirs.add(acc); }
}
function enoent(p: string) {
  const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
  e.code = 'ENOENT';
  return e;
}
const memFsPromises = {
  async mkdir(p: string, opts?: { recursive?: boolean }) {
    if (opts?.recursive) ensureParents(p); else state.dirs.add(p);
  },
  async access(p: string) { if (!state.files.has(p) && !state.dirs.has(p)) throw enoent(p); },
  async readFile(p: string) { const v = state.files.get(p); if (v === undefined) throw enoent(p); return v; },
  async writeFile(p: string, c: string) { ensureParents(dirname(p)); state.files.set(p, c); },
  async rename(from: string, to: string) {
    const v = state.files.get(from); if (v === undefined) throw enoent(from);
    state.files.delete(from); ensureParents(dirname(to)); state.files.set(to, v);
  },
  async unlink(p: string) { if (!state.files.has(p)) throw enoent(p); state.files.delete(p); },
};
vi.mock('node:fs/promises', () => ({ ...memFsPromises, default: memFsPromises }));

const ROOT = '/test-root';
const PID = 'p_test';

async function fresh() {
  vi.resetModules();
  const root = await import('../lib/root');
  root.setRootForTesting(ROOT);
  return (await import('../schedulerState')).SchedulerState;
}

beforeEach(() => { resetMemFs(); });

describe('SchedulerState', () => {
  it('load() 文件不存在时返默认空状态', async () => {
    const SchedulerState = await fresh();
    const s = new SchedulerState(PID);
    await s.load();
    expect(s.isActive).toBe(false);
    expect(s.lastActivatedAt).toBeUndefined();
    expect(s.lastDeactivatedAt).toBeUndefined();
    expect(s.pending.size).toBe(0);
  });

  it('markActivated / markDeactivated 落盘并 round-trip', async () => {
    const SchedulerState = await fresh();
    const s = new SchedulerState(PID);
    await s.markActivated('2026-06-04T08:00:00.000Z');
    await s.markDeactivated('2026-06-04T18:00:00.000Z');

    const SchedulerState2 = await fresh();
    const s2 = new SchedulerState2(PID);
    await s2.load();
    expect(s2.isActive).toBe(false);
    expect(s2.lastActivatedAt).toBe('2026-06-04T08:00:00.000Z');
    expect(s2.lastDeactivatedAt).toBe('2026-06-04T18:00:00.000Z');
  });

  it('enqueueCatchUp / dequeueCatchUp 同 jobId 覆盖且持久化', async () => {
    const SchedulerState = await fresh();
    const s = new SchedulerState(PID);
    await s.enqueueCatchUp('j_1', '2026-06-04T09:00:00.000Z', '2026-06-04T10:00:00.000Z');
    await s.enqueueCatchUp('j_2', '2026-06-04T09:30:00.000Z', '2026-06-04T10:00:00.000Z');
    expect(s.pending.size).toBe(2);

    // 同 id 覆盖
    await s.enqueueCatchUp('j_1', '2026-06-04T09:15:00.000Z', '2026-06-04T10:05:00.000Z');
    expect(s.pending.get('j_1')?.occurrenceAt).toBe('2026-06-04T09:15:00.000Z');
    expect(s.pending.size).toBe(2);

    await s.dequeueCatchUp('j_2');
    expect(s.pending.size).toBe(1);
    expect(s.pending.has('j_2')).toBe(false);

    // 重新 load 一致
    const SchedulerState2 = await fresh();
    const s2 = new SchedulerState2(PID);
    await s2.load();
    expect(s2.pending.size).toBe(1);
    expect(s2.pending.get('j_1')?.occurrenceAt).toBe('2026-06-04T09:15:00.000Z');
  });

  it('getBaseline + getPending 返快照', async () => {
    const SchedulerState = await fresh();
    const s = new SchedulerState(PID);
    await s.markActivated('2026-06-04T08:00:00.000Z');
    await s.enqueueCatchUp('j_1', '2026-06-04T09:00:00.000Z', '2026-06-04T10:00:00.000Z');

    const baseline = s.getBaseline();
    expect(baseline).toEqual({
      isActive: true,
      lastActivatedAt: '2026-06-04T08:00:00.000Z',
      lastDeactivatedAt: undefined,
    });

    const pending = s.getPending();
    expect(pending).toEqual({
      j_1: { occurrenceAt: '2026-06-04T09:00:00.000Z', recordedAt: '2026-06-04T10:00:00.000Z' },
    });
  });

  it('dequeueCatchUp 不存在的 jobId no-op，不写盘', async () => {
    const SchedulerState = await fresh();
    const s = new SchedulerState(PID);
    // 不写盘 → 文件不应被创建
    await s.dequeueCatchUp('j_missing');
    expect(state.files.size).toBe(0);
  });

  it('toFile() 空 pending 不输出 pendingColdStartCatchUps 字段', async () => {
    const SchedulerState = await fresh();
    const s = new SchedulerState(PID);
    await s.markActivated('2026-06-04T08:00:00.000Z');
    const file = s.toFile();
    expect(file).toEqual({
      version: 1,
      isActive: true,
      lastActivatedAt: '2026-06-04T08:00:00.000Z',
    });
    expect('pendingColdStartCatchUps' in file).toBe(false);
  });
});
