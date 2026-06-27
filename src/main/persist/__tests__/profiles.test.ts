import { vi } from 'vitest';

// Step 9：mock `ProfileDb` —— mock-fs 测试不真打开 SQLite。bootstrap / active 路径不直接断言
// regular_sessions / job_runs 行；DB 路径 no-op 即可（真 SQL 行为见 sqlite-index.test.ts）。
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
import type { LegacyAuthFile } from '../../../shared/persist/types';

function makeAuth(): LegacyAuthFile {
  return {
    version: 'v3',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    authProvider: 'ghc',
    ghcAuth: {
      alias: 'alice',
      user: { id: '1', login: 'alice', email: 'a@x', name: 'A', avatarUrl: '', copilotPlan: 'individual' },
      gitHubTokens: { timestamp: '', api_url: '', access_token: 'tok', token_type: 'bearer', scope: '' },
      copilotTokens: { timestamp: '', api_url: '', expires_at: 0, token: 'tok' },
      capabilities: [],
    },
  };
}

// ---------------------------------------------------------------------------
// 内嵌的内存 fs：只覆盖 src/main/persist/lib/atomic.ts 用到的方法。
// 把 helpers 放在测试文件里，避免 vitest 把单独的 helpers.ts 当 test 跑。
// ---------------------------------------------------------------------------

interface MemFs {
  files: Map<string, string>;
  dirs: Set<string>;
}

let state: MemFs = { files: new Map(), dirs: new Set(['/']) };

function resetMemFs(): void {
  state = { files: new Map(), dirs: new Set(['/']) };
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i);
}

function ensureParents(p: string): void {
  const parts = p.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc += '/' + part;
    state.dirs.add(acc);
  }
}

function enoent(p: string): NodeJS.ErrnoException {
  const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
  e.code = 'ENOENT';
  return e;
}

const memFsPromises = {
  async mkdir(p: string, opts?: { recursive?: boolean }) {
    if (opts?.recursive) ensureParents(p);
    else state.dirs.add(p);
  },
  async access(p: string) {
    if (!state.files.has(p) && !state.dirs.has(p)) throw enoent(p);
  },
  async readFile(p: string) {
    const v = state.files.get(p);
    if (v === undefined) throw enoent(p);
    return v;
  },
  async writeFile(p: string, content: string) {
    ensureParents(dirname(p));
    state.files.set(p, content);
  },
  async rename(from: string, to: string) {
    const v = state.files.get(from);
    if (v === undefined) throw enoent(from);
    state.files.delete(from);
    ensureParents(dirname(to));
    state.files.set(to, v);
  },
  async unlink(p: string) {
    if (!state.files.has(p)) throw enoent(p);
    state.files.delete(p);
  },
  async rm(p: string) {
    for (const f of [...state.files.keys()]) if (f === p || f.startsWith(p + '/')) state.files.delete(f);
    for (const d of [...state.dirs])         if (d === p || d.startsWith(p + '/')) state.dirs.delete(d);
  },
  async readdir(p: string, _opts: { withFileTypes: true }) {
    if (!state.dirs.has(p)) throw enoent(p);
    const prefix = p === '/' ? '/' : p + '/';
    const seen = new Set<string>();
    const out: Array<{ name: string; isFile(): boolean; isDirectory(): boolean }> = [];
    for (const f of state.files.keys()) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      if (rest.includes('/')) continue;
      if (seen.has(rest)) continue;
      seen.add(rest);
      out.push({ name: rest, isFile: () => true, isDirectory: () => false });
    }
    for (const d of state.dirs) {
      if (d === p || !d.startsWith(prefix)) continue;
      const rest = d.slice(prefix.length);
      if (rest.includes('/')) continue;
      if (seen.has(rest)) continue;
      seen.add(rest);
      out.push({ name: rest, isFile: () => false, isDirectory: () => true });
    }
    return out;
  },
};

const memFsSync = {
  readFileSync(p: string): string {
    const v = state.files.get(p);
    if (v === undefined) throw enoent(p);
    return v;
  },
};

vi.mock('node:fs/promises', () => ({ ...memFsPromises, default: memFsPromises }));
vi.mock('node:fs', () => ({
  readFileSync: memFsSync.readFileSync,
  default: { readFileSync: memFsSync.readFileSync },
}));

// ---------------------------------------------------------------------------
// 测试本体
// ---------------------------------------------------------------------------

const ROOT = '/test-root';

async function freshModules() {
  vi.resetModules();
  const root = await import('../lib/root');
  root.setRootForTesting(ROOT);
  const profiles = await import('../profiles');
  const profile = await import('../profile');
  profiles.Profiles.resetForTesting();
  return { Profiles: profiles.Profiles, Profile: profile.Profile };
}

beforeEach(() => {
  resetMemFs();
});

describe('Profiles bootstrap', () => {
  it('initializes a guest profile when index file is missing', async () => {
    const { Profiles } = await freshModules();
    const reg = Profiles.get();
    await reg.bootstrap();

    expect(reg.items).toHaveLength(1);
    expect(reg.items[0].kind).toBe('guest');
    expect(reg.activeProfileId).toBe(reg.items[0].id);
  });

  it('falls back to items[0] when activeProfileId is stale', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const id = Profiles.get().items[0].id;

    const { writeJson } = await import('../lib/atomic');
    await writeJson(`${ROOT}/profiles/profiles.json`, {
      version: 1,
      activeProfileId: 'p_NONEXISTENT',
      items: [Profiles.get().items[0]],
    });

    const fresh = await freshModules();
    await fresh.Profiles.get().bootstrap();
    expect(fresh.Profiles.get().activeProfileId).toBe(id);
  });
});

describe('Profiles CRUD', () => {
  it('creates additional profiles and switches active', async () => {
    const { Profiles } = await freshModules();
    const reg = Profiles.get();
    await reg.bootstrap();
    const firstId = reg.activeProfileId;

    const second = await reg.create({ displayName: 'Second' });
    expect(reg.items).toHaveLength(2);
    expect(second.id).not.toBe(firstId);

    await reg.switch(second.id);
    expect(reg.activeProfileId).toBe(second.id);
  });

  it('refuses to delete the last profile', async () => {
    const { Profiles } = await freshModules();
    const reg = Profiles.get();
    await reg.bootstrap();
    await expect(reg.remove(reg.activeProfileId)).rejects.toThrow(/last profile/);
  });

  it('deletes a non-last profile and re-points active', async () => {
    const { Profiles } = await freshModules();
    const reg = Profiles.get();
    await reg.bootstrap();
    const firstId = reg.activeProfileId;
    const second = await reg.create({});
    await reg.switch(second.id);
    await reg.remove(second.id);
    expect(reg.items).toHaveLength(1);
    expect(reg.activeProfileId).toBe(firstId);
  });
});

describe('Profile auth attach/detach', () => {
  it('attachAuth flips entry kind to signed_in', async () => {
    const { Profiles } = await freshModules();
    const reg = Profiles.get();
    await reg.bootstrap();
    const id = reg.activeProfileId;

    const profile = await reg.active();
    await profile.auth.write(makeAuth());

    await reg.attachAuth(id, 'ghc', 'alice');
    const entry = reg.getEntry(id);
    expect(entry?.kind).toBe('signed_in');
    if (entry?.kind === 'signed_in') {
      expect(entry.authProvider).toBe('ghc');
      expect(entry.authAlias).toBe('alice');
    }
  });

  it('detachAuth flips back to guest and clear() removes file', async () => {
    const { Profiles } = await freshModules();
    const reg = Profiles.get();
    await reg.bootstrap();
    const id = reg.activeProfileId;
    const profile = await reg.active();
    await profile.auth.write(makeAuth());
    await reg.attachAuth(id, 'ghc', 'alice');

    await profile.auth.clear();
    await reg.detachAuth(id);
    expect(profile.auth.exists()).toBe(false);
    expect(reg.getEntry(id)?.kind).toBe('guest');
  });
});

describe('Profile persist/load round-trip', () => {
  it('writes settings.json and reloads it', async () => {
    const { Profiles, Profile } = await freshModules();
    const reg = Profiles.get();
    await reg.bootstrap();
    const id = reg.activeProfileId;
    const profile = await reg.active();
    await profile.patchSettings({ confirmation: { inlineEditRegenerate: { skipConfirmation: true } } });

    const fresh = await freshModules();
    await fresh.Profiles.get().bootstrap();
    const reloaded = await fresh.Profile.getOrLoad(id);
    expect(reloaded.settings.confirmation).toEqual({ inlineEditRegenerate: { skipConfirmation: true } });
  });
});

describe('Profiles bootstrap idempotency + activeSync', () => {
  it('bootstrap() repeated call is no-op', async () => {
    const { Profiles } = await freshModules();
    const reg = Profiles.get();
    const first = await reg.bootstrap();
    expect(first.warnings).toEqual([]);
    const id = reg.activeProfileId;
    // 重入 —— activeProfileId 不变，items 不重复增长
    const second = await reg.bootstrap();
    expect(second.warnings).toEqual([]);
    expect(reg.activeProfileId).toBe(id);
    expect(reg.items).toHaveLength(1);
  });

  it('activeSync() throws before bootstrap and returns the profile after', async () => {
    const { Profiles } = await freshModules();
    const reg = Profiles.get();
    expect(() => reg.activeSync()).toThrow(/bootstrap/);
    await reg.bootstrap();
    const sync = reg.activeSync();
    const async_ = await reg.active();
    expect(sync.id).toBe(async_.id);
  });

  it('activeSync() follows switch() to a different profile', async () => {
    const { Profiles } = await freshModules();
    const reg = Profiles.get();
    await reg.bootstrap();
    const second = await reg.create({ displayName: 'Second' });
    await reg.switch(second.id);
    expect(reg.activeSync().id).toBe(second.id);
  });
});

describe('Profile patchSettings', () => {
  it('only writes fields present in partial', async () => {
    const { Profiles } = await freshModules();
    const reg = Profiles.get();
    await reg.bootstrap();
    const profile = await reg.active();
    profile.settings.confirmation = { inlineEditRegenerate: { skipConfirmation: true } };
    await profile.settings.persist();

    // 空 partial：partialAssign 仅写传入字段，不应清掉已存在的 confirmation
    await profile.patchSettings({});
    expect(profile.settings.confirmation?.inlineEditRegenerate?.skipConfirmation).toBe(true);

    // 传入 confirmation 时正常更新
    await profile.patchSettings({ confirmation: { inlineEditRegenerate: { skipConfirmation: false } } });
    expect(profile.settings.confirmation?.inlineEditRegenerate?.skipConfirmation).toBe(false);
  });
});

describe('Profile duplicateAgent', () => {
  it('clones front-matter + systemPrompt with new id', async () => {
    const { Profiles } = await freshModules();
    const reg = Profiles.get();
    await reg.bootstrap();
    const profile = await reg.active();

    const src = await profile.createAgent({
      name: 'Otto',
      version: '2.0.0',
      
      model: 'github-copilot::claude-sonnet-4.6',
      systemPrompt: 'You are Otto.',
    });
    await src.patchFront({ skills: ['skill-a'], subAgents: ['sub-a'] });

    const dst = await profile.duplicateAgent(src.id, 'Otto Clone');
    expect(dst.id).not.toBe(src.id);
    expect(dst.config.name).toBe('Otto Clone');
    expect(dst.config.version).toBe('1.0.0');
    expect(dst.config.model).toBe(src.config.model);
    expect(dst.config.skills).toEqual(['skill-a']);
    expect(dst.config.subAgents).toEqual(['sub-a']);
    expect(dst.systemPrompt).toBe('You are Otto.');

    // 出现在 agents.json items
    const list = profile.listAgents();
    expect(list.find((r) => r.id === dst.id)).toBeDefined();
  });

  it('rejects empty newName and unknown srcId', async () => {
    const { Profiles } = await freshModules();
    const reg = Profiles.get();
    await reg.bootstrap();
    const profile = await reg.active();
    await expect(profile.duplicateAgent('a_GHOST', 'x')).rejects.toThrow(/unknown agent id/);

    const src = await profile.createAgent({
      name: 'X',
      version: '1.0.0',
      
    });
    await expect(profile.duplicateAgent(src.id, '   ')).rejects.toThrow(/newName/);
  });
});
