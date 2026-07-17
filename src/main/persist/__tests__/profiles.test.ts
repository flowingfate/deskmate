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

let failNextWrite = false;

let state: MemFs = { files: new Map(), dirs: new Set(['/']) };

function resetMemFs(): void {
  state = { files: new Map(), dirs: new Set(['/']) };
  failNextWrite = false;
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
    if (failNextWrite) {
      failNextWrite = false;
      throw new Error('disk full');
    }
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
  const registry = await import('../../profileRegistry');
  const profile = await import('../profileStore');
  registry.ProfileRegistry.resetForTesting();
  return { ProfileRegistry: registry.ProfileRegistry, ProfileStore: profile.ProfileStore };
}

beforeEach(() => {
  resetMemFs();
});

describe('Profiles bootstrap', () => {
  it('initializes a guest profile when index file is missing', async () => {
    const { ProfileRegistry } = await freshModules()
    const reg = ProfileRegistry;
    await reg.bootstrap();

    expect(reg.items).toHaveLength(1);
    expect(reg.items[0].kind).toBe('guest');
    expect(reg.defaultProfileId).toBe(reg.items[0].id);
  });

  it('merges concurrent bootstrap calls into one initialized index', async () => {
    const { ProfileRegistry } = await freshModules();
    const [first, second] = await Promise.all([
      ProfileRegistry.bootstrap(),
      ProfileRegistry.bootstrap(),
    ]);

    expect(first.warnings).toEqual([]);
    expect(second.warnings).toEqual([]);
    expect(ProfileRegistry.items).toHaveLength(1);
  });

  it('falls back to items[0] when activeProfileId is stale', async () => {
    const { ProfileRegistry } = await freshModules()
    await ProfileRegistry.bootstrap();
    const id = ProfileRegistry.items[0].id;

    const { writeJson } = await import('../lib/atomic');
    await writeJson(`${ROOT}/profiles/profiles.json`, {
      version: 1,
      activeProfileId: 'p_NONEXISTENT',
      items: [ProfileRegistry.items[0]],
    });

    const fresh = await freshModules();
    await fresh.ProfileRegistry.bootstrap();
    expect(fresh.ProfileRegistry.defaultProfileId).toBe(id);
  });
});

describe('Profiles CRUD', () => {
  it('creates additional profiles without changing the startup default', async () => {
    const { ProfileRegistry } = await freshModules()
    const reg = ProfileRegistry;
    await reg.bootstrap();
    const firstId = reg.defaultProfileId;

    const second = await reg.create({ displayName: 'Second' });
    expect(reg.items).toHaveLength(2);
    expect(second.id).not.toBe(firstId);
    expect(reg.defaultProfileId).toBe(firstId);
  });

  it('serializes concurrent creation so every profile survives reload', async () => {
    const { ProfileRegistry } = await freshModules();
    await ProfileRegistry.bootstrap();

    const [first, second] = await Promise.all([
      ProfileRegistry.create({ displayName: 'First' }),
      ProfileRegistry.create({ displayName: 'Second' }),
    ]);
    const expectedIds = new Set([
      ProfileRegistry.defaultProfileId,
      first.id,
      second.id,
    ]);

    const fresh = await freshModules();
    await fresh.ProfileRegistry.bootstrap();
    expect(new Set(fresh.ProfileRegistry.items.map((entry) => entry.id))).toEqual(expectedIds);
  });

  it('keeps the committed index unchanged when writing a new profile fails', async () => {
    const { ProfileRegistry } = await freshModules();
    await ProfileRegistry.bootstrap();
    const before = ProfileRegistry.items.map((entry) => entry.id);

    failNextWrite = true;
    await expect(ProfileRegistry.create({ displayName: 'Unpersisted' })).rejects.toThrow('disk full');

    expect(ProfileRegistry.items.map((entry) => entry.id)).toEqual(before);
  });

  it('refuses to delete the last profile', async () => {
    const { ProfileRegistry } = await freshModules()
    const reg = ProfileRegistry;
    await reg.bootstrap();
    await expect(reg.remove(reg.defaultProfileId)).rejects.toThrow(/last profile/);
  });

  it('re-points the startup default when removing its profile', async () => {
    const { ProfileRegistry } = await freshModules()
    const reg = ProfileRegistry;
    await reg.bootstrap();
    const firstId = reg.defaultProfileId;
    const second = await reg.create({});

    await reg.remove(firstId);

    expect(reg.items).toHaveLength(1);
    expect(reg.defaultProfileId).toBe(second.id);
  });

  it('removes the complete Profile directory after removing its index entry', async () => {
    const { ProfileRegistry } = await freshModules();
    await ProfileRegistry.bootstrap();
    const id = ProfileRegistry.defaultProfileId;
    const store = ProfileRegistry.require(id).store;
    await store.auth.write(makeAuth());
    await ProfileRegistry.create({ displayName: 'Remaining' });

    expect(state.files.has(`${ROOT}/profiles/${id}/auth.json`)).toBe(true);
    await Promise.all([ProfileRegistry.remove(id), ProfileRegistry.remove(id)]);

    expect([...state.files.keys()].some((file) => file.startsWith(`${ROOT}/profiles/${id}/`))).toBe(false);
    expect(ProfileRegistry.getEntry(id)).toBeUndefined();
  });
});

describe('Profile auth attach/detach', () => {
  it('attachAuth flips entry kind to signed_in', async () => {
    const { ProfileRegistry } = await freshModules()
    const reg = ProfileRegistry;
    await reg.bootstrap();
    const id = reg.defaultProfileId;

    const store = reg.require(reg.defaultProfileId).store
    await store.auth.write(makeAuth());

    await reg.attachAuth(id, 'ghc', 'alice');
    const entry = reg.getEntry(id);
    expect(entry?.kind).toBe('signed_in');
    if (entry?.kind === 'signed_in') {
      expect(entry.authProvider).toBe('ghc');
      expect(entry.authAlias).toBe('alice');
    }
  });

  it('detachAuth flips back to guest and clear() removes file', async () => {
    const { ProfileRegistry } = await freshModules()
    const reg = ProfileRegistry;
    await reg.bootstrap();
    const id = reg.defaultProfileId;
    const store = reg.require(reg.defaultProfileId).store
    await store.auth.write(makeAuth());
    await reg.attachAuth(id, 'ghc', 'alice');

    await store.auth.clear();
    await reg.detachAuth(id);
    expect(reg.getEntry(id)?.kind).toBe('guest');
  });

  it('does not expose mutable index entry references', async () => {
    const { ProfileRegistry } = await freshModules();
    await ProfileRegistry.bootstrap();
    const id = ProfileRegistry.defaultProfileId;
    const entry = ProfileRegistry.getEntry(id);
    if (!entry) throw new Error('Expected profile index entry.');

    entry.displayName = 'Mutated outside ProfileRegistry';
    expect(ProfileRegistry.getEntry(id)?.displayName).toBe('Guest');
  });
});

describe('Profile persist/load round-trip', () => {
  it('writes settings.json and reloads it', async () => {
    const { ProfileRegistry, ProfileStore } = await freshModules()
    const reg = ProfileRegistry;
    await reg.bootstrap();
    const id = reg.defaultProfileId;
    const store = reg.require(reg.defaultProfileId).store
    await store.patchSettings({ confirmation: { inlineEditRegenerate: { skipConfirmation: true } } });

    const fresh = await freshModules();
    await fresh.ProfileRegistry.bootstrap();
    const reloaded = (await fresh.ProfileRegistry.getOrLoad(id)).store;
    expect(reloaded.settings.confirmation).toEqual({ inlineEditRegenerate: { skipConfirmation: true } });
  });
});

describe('Profiles bootstrap idempotency + explicit lookup', () => {
  it('bootstrap() repeated call is no-op', async () => {
    const { ProfileRegistry } = await freshModules()
    const reg = ProfileRegistry;
    const first = await reg.bootstrap();
    expect(first.warnings).toEqual([]);
    const id = reg.defaultProfileId;
    // 重入 —— activeProfileId 不变，items 不重复增长
    const second = await reg.bootstrap();
    expect(second.warnings).toEqual([]);
    expect(reg.defaultProfileId).toBe(id);
    expect(reg.items).toHaveLength(1);
  });

  it('require() rejects unloaded IDs and resolves the explicit default after bootstrap', async () => {
    const { ProfileRegistry } = await freshModules()
    const reg = ProfileRegistry;
    expect(() => reg.require('p_NOT_LOADED')).toThrow(/not loaded/);

    await reg.bootstrap();

    const profile = reg.require(reg.defaultProfileId);
    expect(profile.id).toBe(reg.defaultProfileId);
  });

  it('created runtime is explicitly addressable without changing the default', async () => {
    const { ProfileRegistry } = await freshModules()
    const reg = ProfileRegistry;
    await reg.bootstrap();
    const firstId = reg.defaultProfileId;
    const second = await reg.create({ displayName: 'Second' });

    expect(reg.require(second.id)).toBe(second);
    expect(reg.defaultProfileId).toBe(firstId);
  });
});

describe('Profile patchSettings', () => {
  it('only writes fields present in partial', async () => {
    const { ProfileRegistry } = await freshModules()
    const reg = ProfileRegistry;
    await reg.bootstrap();
    const store = reg.require(reg.defaultProfileId).store
    store.settings.confirmation = { inlineEditRegenerate: { skipConfirmation: true } };
    await store.settings.persist();

    // 空 partial：partialAssign 仅写传入字段，不应清掉已存在的 confirmation
    await store.patchSettings({});
    expect(store.settings.confirmation?.inlineEditRegenerate?.skipConfirmation).toBe(true);

    // 传入 confirmation 时正常更新
    await store.patchSettings({ confirmation: { inlineEditRegenerate: { skipConfirmation: false } } });
    expect(store.settings.confirmation?.inlineEditRegenerate?.skipConfirmation).toBe(false);
  });
});

describe('Profile duplicateAgent', () => {
  it('clones front-matter + systemPrompt with new id', async () => {
    const { ProfileRegistry } = await freshModules()
    const reg = ProfileRegistry;
    await reg.bootstrap();
    const store = reg.require(reg.defaultProfileId).store

    const src = await store.createAgent({
      name: 'Otto',
      version: '2.0.0',
      
      model: 'github-copilot::claude-sonnet-4.6',
      systemPrompt: 'You are Otto.',
    });
    await src.patchFront({ skills: { 'skill-a': 'live' } });

    await src.knowledge.remove();
    const dst = await store.duplicateAgent(src.id, 'Otto Clone');
    expect(await dst.knowledge.exists()).toBe(true);
    expect(dst.id).not.toBe(src.id);
    expect(dst.config.name).toBe('Otto Clone');
    expect(dst.config.version).toBe('1.0.0');
    expect(dst.config.model).toBe(src.config.model);
    expect(dst.config.skills).toEqual({ 'skill-a': 'live' });
    expect(dst.systemPrompt).toBe('You are Otto.');

    // 出现在 agents.json items
    const list = store.listAgents();
    expect(list.find((r) => r.id === dst.id)).toBeDefined();
  });

  it('repairs missing knowledge directory when a legacy profile starts', async () => {
    const { ProfileRegistry, ProfileStore } = await freshModules()
    const reg = ProfileRegistry;
    await reg.bootstrap();
    const store = reg.require(reg.defaultProfileId).store
    const agent = await store.createAgent({ name: 'Legacy', version: '1.0.0' });
    await agent.knowledge.remove();

    ProfileRegistry.resetForTesting();
    const reloaded = await (await ProfileRegistry.getOrLoad(store.id)).store;
    expect(await agent.knowledge.exists()).toBe(true);
    const repaired = await reloaded.getAgent(agent.id);
    expect(repaired).toBeDefined();
    if (!repaired) return;
    expect(await repaired.knowledge.exists()).toBe(true);
  });

  it('rejects empty newName and unknown srcId', async () => {
    const { ProfileRegistry } = await freshModules()
    const reg = ProfileRegistry;
    await reg.bootstrap();
    const store = reg.require(reg.defaultProfileId).store
    await expect(store.duplicateAgent('a_GHOST', 'x')).rejects.toThrow(/unknown agent id/);

    const src = await store.createAgent({
      name: 'X',
      version: '1.0.0',
      
    });
    await expect(store.duplicateAgent(src.id, '   ')).rejects.toThrow(/newName/);
  });
});
