import { beforeEach, describe, expect, it, vi } from 'vitest';

// Step 9：mock `ProfileDb` —— mock-fs 测试不真打开 SQLite（better-sqlite3 走 native fs，绕过 vi.mock）。
// 本文件覆盖 AGENT.md / agents.json 路径，不直接断言 regular_sessions / job_runs 行；DB 路径 no-op 即可。
const fakeStmt = { run: () => ({ changes: 0 }), get: () => undefined, all: () => [] };
const fakeDb = {
  db: { prepare: () => fakeStmt, pragma: () => 'wal', exec: () => undefined, transaction: (fn: (rows: unknown[]) => void) => (rows: unknown[]) => fn(rows), close: () => undefined },
  checkIntegrity: () => true,
  schemaVersion: () => 1,
};
vi.mock('../lib/db/db', () => ({
  ProfileDb: { open: () => fakeDb, close: () => undefined, closeAll: () => undefined, resetForTesting: () => undefined },
  profileDbPath: (id: string) => `/mock-fs/${id}/index.db`,
  unlinkProfileDb: () => undefined,
}));

// 内嵌 in-memory fs（PR-C 版本：rename 支持目录递归）。
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
    // 文件直接搬
    if (state.files.has(from)) {
      const v = state.files.get(from)!;
      state.files.delete(from);
      ensureParents(dirname(to));
      state.files.set(to, v);
      return;
    }
    // 目录：递归改 prefix
    if (state.dirs.has(from)) {
      const prefix = from + '/';
      // 移动所有子文件
      for (const f of [...state.files.keys()]) {
        if (f === from || f.startsWith(prefix)) {
          const v = state.files.get(f)!;
          state.files.delete(f);
          const next = f === from ? to : to + f.slice(from.length);
          ensureParents(dirname(next));
          state.files.set(next, v);
        }
      }
      // 移动所有子目录
      for (const d of [...state.dirs]) {
        if (d === from || d.startsWith(prefix)) {
          state.dirs.delete(d);
          const next = d === from ? to : to + d.slice(from.length);
          ensureParents(next);
        }
      }
      ensureParents(to);
      return;
    }
    throw enoent(from);
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
  readFileSync(p: string) { const v = state.files.get(p); if (v === undefined) throw enoent(p); return v; },
};
vi.mock('node:fs/promises', () => ({ ...memFsPromises, default: memFsPromises }));
vi.mock('node:fs', () => ({
  readFileSync: memFsSync.readFileSync,
  default: { readFileSync: memFsSync.readFileSync },
}));

const ROOT = '/test-root';

async function freshModules() {
  vi.resetModules();
  const root = await import('../lib/root');
  root.setRootForTesting(ROOT);
  const profiles = await import('../profiles');
  profiles.Profiles.resetForTesting();
  return {
    Profiles: profiles.Profiles,
    Agent:    (await import('../agent')).Agent,
  };
}

beforeEach(() => { resetMemFs(); });

describe('Agent.persist + load round-trip', () => {
  it('writes AGENT.md and reads it back identically', async () => {
    const { Profiles } = await freshModules();
    const reg = Profiles.get();
    await reg.bootstrap();
    const profile = await reg.active();

    const agent = await profile.createAgent({
      name: 'Otto',
      version: '1.0.0',
      model: 'claude-sonnet-4.6',
      
      emoji: '🤖',
      systemPrompt: 'You are helpful.\n',
    });
    expect(agent.id).toMatch(/^a_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(await agent.knowledge.exists()).toBe(true);

    const fresh = await freshModules();
    const reg2 = fresh.Profiles.get();
    await reg2.bootstrap();
    const profile2 = await reg2.active();
    const reloaded = await profile2.getAgent(agent.id);
    expect(reloaded).toBeDefined();
    expect(reloaded?.config.name).toBe('Otto');
    expect(reloaded?.config.version).toBe('1.0.0');
    expect(reloaded?.systemPrompt).toBe('You are helpful.\n');
  });

  it('createAgent appends to agents.json items', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const a = await profile.createAgent({
      name: 'A', version: '1',
    });
    const b = await profile.createAgent({
      name: 'B', version: '1',
    });
    const list = profile.listAgents();
    expect(list.map((r) => r.id)).toEqual([a.id, b.id]);
  });
});

describe('Agent rename via patchFront', () => {
  it('renaming does not change id; AGENT.md round-trip survives reload', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const agent = await profile.createAgent({
      name: 'OldName', version: '1',
    });

    await agent.patchFront({ name: 'NewName' });
    expect(agent.config.name).toBe('NewName');

    const reloaded = await (await Profiles.get().active()).getAgent(agent.id);
    expect(reloaded?.id).toBe(agent.id);
    expect(reloaded?.config.name).toBe('NewName');
  });

  /**
   * 回归测试：patchFront 之后 agents.json items 对应行必须立刻刷新（不能 stale）。
   * 重构前 bug：patchFront 只改 AGENT.md，record 要等下一次 createAgent/archive 等才会被刷。
   * Step 2 修：patchFront 内自动调 AgentRegistry.syncRecord（注入的 registry）。
   */
  it('patchFront immediately syncs agents.json record (no stale)', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const agent = await profile.createAgent({
      name: 'OldName', version: '1.0.0',
      model: 'old-model',
    });

    await agent.patchFront({ name: 'NewName', model: 'new-model', version: '2.0.0' });

    // listAgents 立刻反映新值，不必再触发任何额外的 createAgent / archive
    const list = profile.listAgents();
    const rec = list.find((r) => r.id === agent.id);
    expect(rec?.name).toBe('NewName');
    expect(rec?.model).toBe('new-model');
    expect(rec?.version).toBe('2.0.0');
  });

  /**
   * 回归测试（2026-06-08）：Agent.load 必须从 agents.json 回填 createdAt/updatedAt，
   * 否则 reload 后第一次 patchFront 会在 toRecord() 抛 "createdAt/updatedAt not initialized"。
   *
   * Bug 复现路径（修复前）：
   *   - app 重启 → Profile.load preload registry → renderer 触发 patchFront IPC
   *   - main: Profile.getAgent → Agent.load（createdAt/updatedAt 默认 ''）→ patchFront
   *   - patchFront 第 296 行 `await this.persist()` 写 AGENT.md ✅
   *   - patchFront 第 297 行 `syncRecord(this.toRecord())` 在 toRecord() throw ❌
   *   - 副作用：agents.json items 永远 stale；renderer 拿到 success:false 后把
   *     pendingModel 清掉 → UI "切了模型没反应"。
   *
   * 14 行 createAgent 流程的内存实例不走 load，不会触发；必须显式从盘 reload。
   */
  it('reload + patchFront updates AGENT.md and agents.json without throwing', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const agent = await profile.createAgent({
      name: 'M', version: '1',
      model: 'old::m',
    });
    const agentId = agent.id;

    // 模拟"app 重启" —— 用 freshModules 重新 bootstrap，强制走 Agent.load
    const fresh = await freshModules();
    await fresh.Profiles.get().bootstrap();
    const profile2 = await fresh.Profiles.get().active();
    const reloaded = await profile2.getAgent(agentId);
    expect(reloaded).toBeDefined();
    // createdAt/updatedAt 必须从 agents.json record 回填，不能是空串
    expect(reloaded!.createdAt).not.toBe('');
    expect(reloaded!.updatedAt).not.toBe('');

    // 这是 bug 触发点：之前会 throw "Agent.toRecord: createdAt/updatedAt not initialized"
    await expect(reloaded!.patchFront({ model: 'new::m' })).resolves.toBeUndefined();

    // agents.json items 必须立刻反映新 model（syncRecord 走通）
    const list = profile2.listAgents();
    expect(list.find((r) => r.id === agentId)?.model).toBe('new::m');
  });

  it('toRecord() carries model field (hot list-level cache)', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const agent = await profile.createAgent({
      name: 'M', version: '1',
      model: 'gh::sonnet',
    });
    const rec = agent.toRecord();
    expect(rec.model).toBe('gh::sonnet');
    // listAgents 取出的 record 也含 model
    const list = profile.listAgents();
    expect(list.find((r) => r.id === agent.id)?.model).toBe('gh::sonnet');
  });

  it('toDetail() returns cold cluster only; no record fields except agentId', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const agent = await profile.createAgent({
      name: 'D', version: '1',
      model: 'gh::sonnet',
      systemPrompt: 'sp',
    });
    await agent.patchFront({
      thinkingLevel: 'high',
      skills: { s1: 'live' },
      tools: ['read', 'write'],
      mcpServers: [{ name: 'mcp1', tools: ['t1'] }],
    });
    const d = agent.toDetail();
    expect(d).toEqual({
      agentId: agent.id,
      thinkingLevel: 'high',
      systemPrompt: 'sp',
      tools: ['read', 'write'],
      mcpServers: [{ name: 'mcp1', tools: ['t1'] }],
      skills: { s1: 'live' },
    });
    // 不带 record 字段（避免回归：列表展示 stale 时不该用 detail 兜底）
    expect((d as unknown as Record<string, unknown>).name).toBeUndefined();
    expect((d as unknown as Record<string, unknown>).model).toBeUndefined();
  });

  /**
   * 回归：thinkingLevel 是三态字段，null 显式清除（写回 provider 默认），与
   * undefined "不修改" 严格区分。agentOps.updateAgent 用此把用户点 "Auto"
   * 的语义透传到持久化层。
   */
  it('patchFront({ thinkingLevel: null }) clears the field; AGENT.md round-trip drops it', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const agent = await profile.createAgent({
      name: 'TL', version: '1',
      model: 'gh::sonnet', systemPrompt: 'sp',
    });
    await agent.patchFront({ thinkingLevel: 'high' });
    expect(agent.config.thinkingLevel).toBe('high');

    await agent.patchFront({ thinkingLevel: null });
    expect(agent.config.thinkingLevel).toBeUndefined();

    // round-trip：reload 后字段彻底缺席（toFrontMatter 的 !== undefined 守卫保证
    // 不会写出 `thinkingLevel: null`）
    const fresh = await freshModules();
    await fresh.Profiles.get().bootstrap();
    const reloaded = await (await fresh.Profiles.get().active()).getAgent(agent.id);
    expect(reloaded?.config.thinkingLevel).toBeUndefined();

    // undefined 时 patchFront 不修改既有值
    await reloaded!.patchFront({ thinkingLevel: 'medium' });
    await reloaded!.patchFront({ name: 'Renamed' });
    expect(reloaded!.config.thinkingLevel).toBe('medium');
  });

  /**
   * tools 是 deskmate 原生本地工具白名单。语义(故意不对称):
   *   - undefined / [] ⇒ 默认全开本地工具
   *   - 非空数组 ⇒ 仅列表内
   *
   * 这里只验证持久化形态:patchFront 写入 → AGENT.md 落盘 → reload 后 round-trip
   * 一致(不会被序列化器悄悄丢字段,也不会回读时归一掉显式空数组)。
   * "默认全开"的运行语义由 `pi/__tests__/toolCatalog.test.ts` 覆盖。
   */
  it('patchFront({ tools }) 落盘 + reload round-trip;空数组与具体列表都保留', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const agent = await profile.createAgent({
      name: 'T', version: '1',
      model: 'gh::sonnet', systemPrompt: 'sp',
    });

    // 1. 写一个非空白名单 → reload 后字段保留
    await agent.patchFront({ tools: ['read', 'write'] });
    expect(agent.config.tools).toEqual(['read', 'write']);

    const fresh1 = await freshModules();
    await fresh1.Profiles.get().bootstrap();
    const reloaded1 = await (await fresh1.Profiles.get().active()).getAgent(agent.id);
    expect(reloaded1?.config.tools).toEqual(['read', 'write']);
    expect(reloaded1?.toDetail().tools).toEqual(['read', 'write']);

    // 2. 改为显式空数组 ⇒ 仍是空数组(而不是被序列化器吞成 undefined)
    //    —— "[] = 全开" 的语义解释由 ToolCatalog 负责,持久化层只负责忠实落盘。
    await reloaded1!.patchFront({ tools: [] });
    expect(reloaded1!.config.tools).toEqual([]);

    const fresh2 = await freshModules();
    await fresh2.Profiles.get().bootstrap();
    const reloaded2 = await (await fresh2.Profiles.get().active()).getAgent(agent.id);
    expect(reloaded2?.config.tools).toEqual([]);
  });

  /**
   * 回归：thinkingLevel 与 model 是 per-model 强关联的（pi-ai thinkingLevelMap
   * 决定每个 model 支持的等级子集 + token budget 语义）。切 model 后旧 level 在
   * 新 model 下未必合法 / 未必等价 —— `Agent.patchFront` 必须自动把 thinkingLevel
   * 清掉，否则 UI 显示 "Auto" 而 pi-ai 在 runtime clampThinkingLevel 静默兜底，
   * 三条入口（ModelSelector / AgentBasicTab / update_agent tool）的行为都会漂移。
   *
   * 显式优先级：同一 patch 里如果调用方显式给了 thinkingLevel（含 null），以显式
   * 意图为准；invariant 兜底不能覆盖显式语义。
   */
  it('patchFront({ model }) clears thinkingLevel; same-model noop preserves; explicit thinkingLevel wins', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const agent = await profile.createAgent({
      name: 'M', version: '1',
      model: 'openai::o3', systemPrompt: 'sp',
    });
    await agent.patchFront({ thinkingLevel: 'high' });
    expect(agent.config.thinkingLevel).toBe('high');

    // 1. model 真切换 → thinkingLevel 自动清
    await agent.patchFront({ model: 'anthropic::claude-sonnet' });
    expect(agent.config.model).toBe('anthropic::claude-sonnet');
    expect(agent.config.thinkingLevel).toBeUndefined();

    // 2. 同 patch 同时给 model + 新 thinkingLevel → 显式覆盖，不会被清空
    await agent.patchFront({ model: 'openai::o4-mini', thinkingLevel: 'medium' });
    expect(agent.config.model).toBe('openai::o4-mini');
    expect(agent.config.thinkingLevel).toBe('medium');

    // 3. 同 model 等值传（noise patch）→ 不视为变化，不清 thinkingLevel
    await agent.patchFront({ model: 'openai::o4-mini' });
    expect(agent.config.thinkingLevel).toBe('medium');

    // 4. 只改其它字段，model 未传 → thinkingLevel 完全不动
    await agent.patchFront({ name: 'M2' });
    expect(agent.config.thinkingLevel).toBe('medium');

    // 5. patch 同时给 model + 显式 null thinkingLevel → null 仍生效（清除）
    await agent.patchFront({ model: 'anthropic::claude-opus', thinkingLevel: null });
    expect(agent.config.thinkingLevel).toBeUndefined();
  });

  it('Profile.getAgentDetail(id) returns null for unknown id; ok for known', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const agent = await profile.createAgent({
      name: 'G', version: '1',
      systemPrompt: 'be cool',
    });
    expect(await profile.getAgentDetail('a_nope')).toBeNull();
    const d = await profile.getAgentDetail(agent.id);
    expect(d?.systemPrompt).toBe('be cool');
    expect(d?.agentId).toBe(agent.id);
  });
});

describe('Profile.archiveAgent + restoreAgent', () => {
  it('archives agent dir under archive/agents/{id}_{ts}/ and removes from index + primary', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const agent = await profile.createAgent({
      name: 'Doomed', version: '1',
    });
    await profile.setPrimaryAgent(agent.id);

    await profile.archiveAgent(agent.id);

    expect(profile.getPrimaryAgentId()).toBeUndefined();
    expect(profile.listAgents().map((r) => r.id)).not.toContain(agent.id);

    const archived = await profile.archive.listArchivedAgents();
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe(agent.id);
    expect(archived[0].name).toBe('Doomed');
  });

  it('restoreAgent moves agent back and reappears in listAgents', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const agent = await profile.createAgent({
      name: 'Phoenix', version: '1',
    });
    await profile.archiveAgent(agent.id);
    const [archived] = await profile.archive.listArchivedAgents();
    await profile.restoreAgent(archived.archivedId);

    expect(profile.listAgents().map((r) => r.id)).toContain(agent.id);
    // 重新通过磁盘加载，确保 AGENT.md 跟着搬回来了
    const fresh = await freshModules();
    await fresh.Profiles.get().bootstrap();
    const reloaded = await (await fresh.Profiles.get().active()).getAgent(agent.id);
    expect(reloaded?.config.name).toBe('Phoenix');
  });
});

describe('Profile.reconcileAgents', () => {
  it('drops missing dirs from agents.json items and clears primary if pointing to ghost', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const a = await profile.createAgent({ name: 'A', version: '1' });
    const ghost = await profile.createAgent({ name: 'Ghost', version: '1' });
    await profile.setPrimaryAgent(ghost.id);

    // 手动把 ghost 的目录干掉，让 reconcile 察觉漂移
    await (await import('node:fs/promises')).rm(
      `${ROOT}/profiles/${profile.id}/agents/${ghost.id}`,
      { recursive: true, force: true },
    );

    const result = await profile.reconcileAgents();
    expect(result.droppedFromIndex).toEqual([ghost.id]);
    expect(result.primaryCleared).toBe(true);
    expect(profile.listAgents().map((r) => r.id)).toEqual([a.id]);
    expect(profile.getPrimaryAgentId()).toBeUndefined();
  });
});

describe('Profile.resolveDelegates', () => {
  it('normalizes configured IDs and keeps self, missing, and archived targets unavailable', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();
    const parent = await profile.createAgent({ name: 'Parent', version: '1' });
    const available = await profile.createAgent({ name: 'Available', version: '1' });
    const archived = await profile.createAgent({ name: 'Archived', version: '1' });

    await parent.patchFront({
      delegates: [' ', ` ${available.id} `, parent.id, 'a_missing', archived.id, available.id],
    });
    await profile.archiveAgent(archived.id);

    const availableRecords = profile.listAgents().filter((record) => record.id === available.id);
    expect(await profile.resolveDelegates(parent.id)).toEqual({
      available: availableRecords,
      unavailableIds: [parent.id, 'a_missing', archived.id],
    });
  });
});

describe('Profile.getSnapshot (Step 3 lazy AGENT.md)', () => {
  it('does not touch AGENT.md files when assembling snapshot for N agents', async () => {
    const { Profiles } = await freshModules();
    await Profiles.get().bootstrap();
    const profile = await Profiles.get().active();

    // Seed 3 agents（每个都会写 AGENT.md，但写时记录的 readFile 在 setup 阶段，
    // 我们 spy 是在 setup 之后才装的）
    await profile.createAgent({ name: 'A', version: '1', model: 'm' });
    await profile.createAgent({ name: 'B', version: '1', model: 'm' });
    await profile.createAgent({ name: 'C', version: '1', model: 'm' });

    // 接着 freshModules 模拟 cold start：Profile cache 清空 + 重新 bootstrap +
    // 立刻 spy readFile，然后调 getSnapshot —— 期望 0 次 AGENT.md 读。
    const fresh = await freshModules();
    const reg = fresh.Profiles.get();
    await reg.bootstrap();
    const p2 = await reg.active();

    const fsp = await import('node:fs/promises');
    const readSpy = vi.spyOn(fsp, 'readFile');

    const snap = await p2.getSnapshot();
    expect(snap.agents).toHaveLength(3);

    const agentMdReads = readSpy.mock.calls.filter((args) => String(args[0]).endsWith('AGENT.md'));
    expect(agentMdReads).toEqual([]);

    readSpy.mockRestore();
  });
});
