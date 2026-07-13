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

// 内嵌 in-memory fs（与 profiles.test.ts 同模板）。
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
  async rm(p: string) {
    for (const f of [...state.files.keys()]) if (f === p || f.startsWith(p + '/')) state.files.delete(f);
    for (const d of [...state.dirs])         if (d === p || d.startsWith(p + '/')) state.dirs.delete(d);
  },
  async readdir(p: string, _opts: { withFileTypes: true }) {
    if (!state.dirs.has(p)) throw enoent(p);
    const prefix = p === '/' ? '/' : p + '/';
    const seen = new Set<string>();
    const out: Array<{ name: string; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }> = [];
    for (const f of state.files.keys()) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      if (rest.includes('/')) continue;
      if (seen.has(rest)) continue;
      seen.add(rest);
      out.push({ name: rest, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false });
    }
    for (const d of state.dirs) {
      if (d === p || !d.startsWith(prefix)) continue;
      const rest = d.slice(prefix.length);
      if (rest.includes('/')) continue;
      if (seen.has(rest)) continue;
      seen.add(rest);
      out.push({ name: rest, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false });
    }
    return out;
  },
};
const memFsSync = {
  readFileSync(p: string) { const v = state.files.get(p); if (v === undefined) throw enoent(p); return v; },
};

vi.mock('node:fs/promises', () => ({ ...memFsPromises, default: memFsPromises }));
vi.mock('node:fs', () => ({
  readFileSync: memFsSync.readFileSync,
  default: { readFileSync: memFsSync.readFileSync },
}));

const ROOT = '/test-root';
const PID = 'p_TEST';

async function freshModules() {
  vi.resetModules();
  const root = await import('../lib/root');
  root.setRootForTesting(ROOT);
  return {
    Mcp:        (await import('../mcp')).Mcp,
    Skills:     (await import('../skills')).Skills,
    SubAgents:  (await import('../subAgents')).SubAgents,
    Models:     (await import('../models')).Models,
    AgentKnowledge: (await import('../knowledge')).AgentKnowledge,
  };
}

beforeEach(() => { resetMemFs(); });

describe('Mcp', () => {
  it('upsert + remove + reload', async () => {
    const { Mcp } = await freshModules();
    const mcp = new Mcp(PID);
    await mcp.upsert({ name: 'fs', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: false });
    await mcp.upsert({ name: 'web', transport: 'stdio', command: 'curl', args: [], env: {}, url: '', in_use: false });
    await mcp.upsert({ name: 'fs', transport: 'stdio', command: 'node2', args: [], env: {}, url: '', in_use: false });  // update
    expect(mcp.items).toHaveLength(2);
    expect(mcp.get('fs')?.command).toBe('node2');

    await mcp.remove('web');
    expect(mcp.items).toHaveLength(1);

    const fresh = await freshModules();
    const reloaded = new fresh.Mcp(PID);
    await reloaded.load();
    expect(reloaded.items).toEqual(mcp.items);
  });
});

describe('Skills', () => {
  it('writeMarkdown + readMarkdown round-trip', async () => {
    const { Skills } = await freshModules();
    const skills = new Skills(PID);
    await skills.writeMarkdown('web-search', '# Web Search\nhello\n');
    expect(await skills.readMarkdown('web-search')).toBe('# Web Search\nhello\n');
    expect(await skills.readMarkdown('missing')).toBeUndefined();
  });

  it('reconcile adds disk-only skills and prunes index-only entries', async () => {
    const { Skills } = await freshModules();
    const skills = new Skills(PID);
    // 写两个磁盘 SKILL.md
    await skills.writeMarkdown('alpha', 'a');
    await skills.writeMarkdown('beta', 'b');
    // 注册一个磁盘上没有的
    await skills.upsert({ name: 'ghost', description: '', version: '0.0.0' });

    const result = await skills.reconcile();
    expect(result.added.sort()).toEqual(['alpha', 'beta']);
    expect(result.removed).toEqual(['ghost']);
    expect(skills.items.map((s) => s.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('remove deletes skill directory', async () => {
    const { Skills } = await freshModules();
    const skills = new Skills(PID);
    await skills.writeMarkdown('alpha', 'a');
    await skills.upsert({ name: 'alpha', description: '', version: '1.0' });
    await skills.remove('alpha');
    expect(skills.items).toHaveLength(0);
    expect(await skills.readMarkdown('alpha')).toBeUndefined();
  });
});

describe('SubAgents', () => {
  it('upsert + writeMarkdown + reload', async () => {
    const { SubAgents } = await freshModules();
    const subs = new SubAgents(PID);
    await subs.upsert({ id: 'researcher', name: 'researcher', version: '1.0.0' });
    await subs.writeMarkdown('researcher', '---\nname: researcher\n---\nbody\n');

    const fresh = await freshModules();
    const reloaded = new fresh.SubAgents(PID);
    await reloaded.load();
    expect(reloaded.items).toHaveLength(1);
    expect(await reloaded.readMarkdown('researcher')).toBe('---\nname: researcher\n---\nbody\n');
  });

  it('remove deletes the sub-agent directory', async () => {
    const { SubAgents } = await freshModules();
    const subs = new SubAgents(PID);
    await subs.upsert({ id: 'r', name: 'r', version: '1.0.0' });
    await subs.writeMarkdown('r', 'x');
    await subs.remove('r');
    expect(subs.items).toHaveLength(0);
    expect(await subs.readMarkdown('r')).toBeUndefined();
  });
});

describe('Models', () => {
  it('set + get + reload scans models dir', async () => {
    const { Models } = await freshModules();
    const models = new Models(PID);
    await models.set('github-copilot', {
      models: [{
        id: 'm1', name: 'M1', attachment: false, reasoning: false, temperature: true,
        tool_call: true, knowledge: '', release_date: '', last_updated: '',
        modalities: { input: ['text'], output: ['text'] }, open_weights: false,
        limit: { context: 8000, output: 4000 },
      }],
      updatedAt: '2026-06-01',
      count: 1,
    });
    await models.set('openai', { models: [], updatedAt: '2026-06-01', count: 0 });

    const fresh = await freshModules();
    const reloaded = new fresh.Models(PID);
    await reloaded.load();
    expect(reloaded.providers.size).toBe(2);
    expect(reloaded.get('github-copilot')).toMatchObject({ models: [{ id: 'm1' }] });
  });

  it('remove drops both memory and disk', async () => {
    const { Models } = await freshModules();
    const models = new Models(PID);
    await models.set('p', { models: [], updatedAt: '2026-06-01', count: 0 });
    await models.remove('p');
    expect(models.get('p')).toBeUndefined();
    const fresh = await freshModules();
    const reloaded = new fresh.Models(PID);
    await reloaded.load();
    expect(reloaded.get('p')).toBeUndefined();
  });
});

describe('AgentKnowledge', () => {
  it('ensure creates dir, exists reports true, remove drops it', async () => {
    const { AgentKnowledge } = await freshModules();
    const k = new AgentKnowledge(PID, 'a_X');
    expect(await k.exists()).toBe(false);
    await k.ensure();
    expect(await k.exists()).toBe(true);
    expect(k.path()).toBe(`${ROOT}/profiles/${PID}/agents/a_X/knowledge`);
    await k.remove();
    expect(await k.exists()).toBe(false);
  });
});
