/**
 * Session + Schedule + Starred + Bootstrap 集成测试（Step 9 起改用真 tmp 盘）。
 *
 * 为什么不用 mock fs？
 *  - Step 9 起 `Profile` 构造打开 `profiles/{p}/index.db`（better-sqlite3 native fs），无法被
 *    `vi.mock('node:fs')` 拦截；mock fs 路径会让 native binding 与 mock 失同步。
 *  - 改用每测试一个独立 `os.tmpdir()/persist-step9-it-...` 根目录，afterEach 整目录 rm。
 *  - DB SQL 行为已由 `sqlite-index.test.ts` 单测覆盖；本文件聚焦"高层 store 链 (Profile → Agent →
 *    Session / ScheduleJob) 与 DB 集成是否对接正确"。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssistantMessage, ChatHistoryItem } from '@shared/persist/types';

// 测试里只关心 messages.jsonl 的 round-trip，不关心 schema；
// 用最少字段构造然后 cast 到 ChatHistoryItem。
function msg(role: 'user' | 'assistant', content: string): ChatHistoryItem {
  return { role, content } as unknown as ChatHistoryItem;
}

let tmpRoot = '';

async function freshModules() {
  vi.resetModules();
  const root = await import('../lib/root');
  root.setRootForTesting(tmpRoot);
  const registry = await import('../../profileRegistry');
  registry.ProfileRegistry.resetForTesting();
  const dbMod = await import('../lib/db/db');
  dbMod.ProfileDb.resetForTesting();
  return {
    ProfileRegistry: registry.ProfileRegistry,
    ScheduleJob: (await import('../schedule')).ScheduleJob,
    ProfileDb: dbMod.ProfileDb,
  };
}

async function makeAgent() {
  const fresh = await freshModules();
  await fresh.ProfileRegistry.bootstrap();
  const store = fresh.ProfileRegistry.require(fresh.ProfileRegistry.defaultProfileId).store
  const agent = await store.createAgent({
    name: 'T', version: '1',
  });
  return { store, agent, fresh };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-step9-it-'));
});

afterEach(async () => {
  // 先关掉所有 DB 连接，再删 tmp（Windows 句柄占用会导致 rm 失败；macOS 兼容）。
  const dbMod = await import('../lib/db/db');
  dbMod.ProfileDb.closeAll();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('Session create + append + reload', () => {
  it('createSession 写 regular_sessions 行；appendMessage / flush 落盘 jsonl；重载可见', async () => {
    const { agent } = await makeAgent();
    const s = await agent.createSession({ title: 'hello' });
    s.appendMessage(msg('user', 'hi'));
    s.appendMessage(msg('assistant', 'hey'));
    await s.flushMessages();

    // SQL index 含本条
    const flat = await agent.listSessionsFlat();
    expect(flat.map((e) => e.id)).toContain(s.id);

    // 重载 — 整个 fresh modules（DB 也重打开），messages 能 stream 出来
    const fresh = await freshModules();
    await fresh.ProfileRegistry.bootstrap();
    const store2 = fresh.ProfileRegistry.require(fresh.ProfileRegistry.defaultProfileId).store
    const reloaded = await (await store2.getAgent(agent.id))?.getSession(s.id);
    expect(reloaded?.config.title).toBe('hello');
    const items: unknown[] = [];
    if (reloaded) for await (const m of reloaded.streamMessages()) items.push(m);
    expect(items).toEqual([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hey' }]);
  });

  it('deleteSession 移除 DB 行 + 物理目录', async () => {
    const { agent } = await makeAgent();
    const s = await agent.createSession({});
    await agent.deleteSession(s.id);
    expect((await agent.listSessionsFlat()).map((e) => e.id)).not.toContain(s.id);

    const fresh = await freshModules();
    await fresh.ProfileRegistry.bootstrap();
    const store2 = fresh.ProfileRegistry.require(fresh.ProfileRegistry.defaultProfileId).store
    const reloaded = await (await store2.getAgent(agent.id))?.getSession(s.id);
    expect(reloaded).toBeUndefined();
  });

  it('tailMessages / sliceMessages 在 disk + pending buffer 上分页', async () => {
    const { agent } = await makeAgent();
    const s = await agent.createSession({});
    for (let i = 0; i < 6; i++) s.appendMessage(msg('user', `m${i}`));
    await s.flushMessages();
    s.appendMessage(msg('user', 'm6'));
    s.appendMessage(msg('user', 'm7'));

    const tail = await s.tailMessages(3);
    expect(tail.total).toBe(8);
    expect(tail.items.map((m) => (m as unknown as { content: string }).content)).toEqual(['m5', 'm6', 'm7']);
    expect(tail.nextOffset).toBe(5);
    expect(tail.hasMore).toBe(true);

    const head = await s.sliceMessages(0, 2);
    expect(head.items.map((m) => (m as unknown as { content: string }).content)).toEqual(['m0', 'm1']);
    expect(head.hasMore).toBe(true);

    const overflow = await s.sliceMessages(20, 5);
    expect(overflow.items).toEqual([]);
    expect(overflow.hasMore).toBe(false);
  });
});

describe('SessionIdx.rebuildFromDisk', () => {
  it('rebuild 从 data.json 完整重建（覆盖盘存在的所有 regular session）', async () => {
    const { store, agent } = await makeAgent();
    const s = await agent.createSession({ title: 't' });

    // 验证盘上 data.json 存在
    const dataFile = path.join(tmpRoot, 'profiles', store.id, 'agents', agent.id, 'sessions', s.month, s.id, 'data.json');
    expect(fs.existsSync(dataFile)).toBe(true);

    const result = await store.sessionIdx.rebuildFromDisk();
    expect(result.inserted).toBeGreaterThanOrEqual(1);
    const flat = await agent.listSessionsFlat();
    expect(flat.map((e) => e.id)).toContain(s.id);
  });

  it('Profile.load 在 wasCreated=true 时自动 rebuild（unlink index.db 后启动可见盘上 sessions）', async () => {
    // 准备：建一个 agent + 两个 session，落到盘
    const { store, agent } = await makeAgent();
    const s1 = await agent.createSession({ title: 'a' });
    const s2 = await agent.createSession({ title: 'b' });
    expect((await agent.listSessionsFlat()).length).toBe(2);

    // 模拟"从无 index.db 的布局升级 / 拷贝其它机器 profile 目录"
    //   1) 先关现连接，把 index.db 物理删掉（保留 data.json）
    //   2) freshModules + bootstrap → Profile.load 应检测到 wasCreated=true → rebuild
    const dbMod = await import('../lib/db/db');
    dbMod.ProfileDb.close(store.id);
    dbMod.unlinkProfileDb(store.id);
    expect(fs.existsSync(path.join(tmpRoot, 'profiles', store.id, 'index.db'))).toBe(false);

    const fresh = await freshModules();
    await fresh.ProfileRegistry.bootstrap();
    const store2 = fresh.ProfileRegistry.require(fresh.ProfileRegistry.defaultProfileId).store
    const agent2 = await store2.getAgent(agent.id);
    expect(agent2).toBeDefined();
    const ids = (await agent2!.listSessionsFlat()).map((e) => e.id).sort();
    expect(ids).toEqual([s1.id, s2.id].sort());
  });
});

describe('SessionIdx starred 列', () => {
  it('setStar 写 data.json 经 onChange 同步 regular_sessions.starred_at；listStarred 直查 SQL', async () => {
    const { store, agent } = await makeAgent();
    const s1 = await agent.createSession({ title: 'starred' });
    const _s2 = await agent.createSession({ title: 'plain' });

    await s1.setStar({ starredAt: '2026-06-01T00:00:00Z' });
    const starredAfterAdd = store.sessionIdx.listStarred();
    expect(starredAfterAdd).toHaveLength(1);
    expect(starredAfterAdd[0].sessionId).toBe(s1.id);

    // rebuildFromDisk 应保留 data.json#star 写入的列值
    await store.sessionIdx.rebuildFromDisk();
    const starredAfterRebuild = store.sessionIdx.listStarred();
    expect(starredAfterRebuild.map((e) => e.sessionId)).toEqual([s1.id]);
  });

  it('setStar(undefined) 清空 starred_at，listStarred 不再含该 session', async () => {
    const { store, agent } = await makeAgent();
    const s = await agent.createSession({ title: 'tmp' });
    await s.setStar({ starredAt: '2026-06-02T00:00:00Z' });
    expect(store.sessionIdx.listStarred()).toHaveLength(1);
    await s.setStar(undefined);
    expect(store.sessionIdx.listStarred()).toHaveLength(0);
  });

  it('setStar 不刷 updatedAt（star 是 metadata，不该把会话排到最新）', async () => {
    const { agent } = await makeAgent();
    const s = await agent.createSession({ title: 'tmp' });
    const beforeUpdatedAt = s.config.updatedAt;
    // 等 2ms 让墙钟前进，排除"恰好同毫秒"巧合
    await new Promise((r) => setTimeout(r, 2));
    await s.setStar({ starredAt: '2026-06-01T00:00:00Z' });
    expect(s.config.updatedAt).toBe(beforeUpdatedAt);
    await s.setStar(undefined);
    expect(s.config.updatedAt).toBe(beforeUpdatedAt);
  });
});

describe('Bootstrap end-to-end', () => {
  it('bootstrap 装载共享注册表 + reconciles agents 无 warning', async () => {
    const { ProfileRegistry } = await freshModules()
    const { warnings } = await ProfileRegistry.bootstrap();
    expect(warnings).toEqual([]);
    const store = ProfileRegistry.require(ProfileRegistry.defaultProfileId).store
    expect(store.mcp.items).toEqual([]);
    expect(store.skills.items).toEqual([]);
    expect(store.sessionIdx.listStarred()).toEqual([]);
  });

  it('bootstrap reconcile removes phantom agent records', async () => {
    const { ProfileRegistry } = await freshModules()
    await ProfileRegistry.bootstrap();
    const store = ProfileRegistry.require(ProfileRegistry.defaultProfileId).store
    // 注入 phantom：往 agents.json 写一个对应目录不存在的 record
    const { PERSIST_PATH } = await import('@shared/persist/path');
    const { writeJson } = await import('../lib/atomic');
    await writeJson(PERSIST_PATH.agentsIndexFile(tmpRoot, store.id), {
      version: 1,
      items: [{ id: 'a_GHOST', name: 'Ghost', version: '1', createdAt: '', updatedAt: '' }],
    });
    const fresh = await freshModules();
    await fresh.ProfileRegistry.bootstrap();
    expect((fresh.ProfileRegistry.require(fresh.ProfileRegistry.defaultProfileId).store).listAgents()).toEqual([]);
  });
});

describe('ScheduleJob run lifecycle', () => {
  it('createJob → startRun → append/flush → finishRun，job_runs 行同步落表', async () => {
    const { agent } = await makeAgent();
    const job = await agent.createJob({
      name: 'daily', message: 'do stuff', enabled: true,
      scheduleType: 'once', runAt: '2026-06-02T09:00:00Z',
    });
    expect((await agent.listJobs()).map((e) => e.id)).toEqual([job.id]);

    const run = await job.startRun({ startedAt: '2026-06-02T09:00:00Z' });
    expect(run.jobId).toBe(job.id);
    run.appendMessage(msg('user', 'go'));
    await run.flushMessages();
    await job.finishRun(run.id, { status: 'completed', completedAt: '2026-06-02T09:01:00Z' });

    expect(job.config.runState.status).toBe('completed');

    // job_runs DB 行存在 + 状态正确
    const row = agent.jobRunIdx.findById(run.id);
    expect(row?.runStatus).toBe('completed');
    expect(row?.finishedAt).toBe('2026-06-02T09:01:00Z');

    // 重载 — 整 fresh modules + bootstrap + 验证状态机重建
    const fresh = await freshModules();
    await fresh.ProfileRegistry.bootstrap();
    const store2 = fresh.ProfileRegistry.require(fresh.ProfileRegistry.defaultProfileId).store
    const reloadedJob = await (await store2.getAgent(agent.id))?.getJob(job.id);
    expect(reloadedJob?.config.runState.status).toBe('completed');
    const reloadedRun = await reloadedJob?.getRun(run.id);
    expect(reloadedRun?.config.state.kind).toBe('schedule_run');
    if (reloadedRun?.config.state.kind === 'schedule_run') {
      expect(reloadedRun.config.state.scheduleRun.status).toBe('completed');
    }
  });

  it('deleteRun removes a completed run from source storage and the index', async () => {
    const { store, agent } = await makeAgent();
    const job = await agent.createJob({
      name: 'daily', message: 'do stuff', enabled: true,
      scheduleType: 'once', runAt: '2026-06-02T09:00:00Z',
    });
    const run = await job.startRun({ startedAt: '2026-06-02T09:00:00Z' });
    await job.finishRun(run.id, { status: 'completed', completedAt: '2026-06-02T09:01:00Z' });

    expect(await job.deleteRun(run.id)).toBe(true);
    expect(agent.jobRunIdx.findById(run.id)).toBeUndefined();
    expect(await job.listRunsOnDisk()).toEqual([]);
    expect(fs.existsSync(path.join(
      tmpRoot, 'profiles', store.id, 'agents', agent.id, 'schedules', job.id, 'runs', '202606', run.id,
    ))).toBe(false);
  });

  it('deleteRun rejects a running run', async () => {
    const { agent } = await makeAgent();
    const job = await agent.createJob({
      name: 'daily', message: 'do stuff', enabled: true,
      scheduleType: 'once', runAt: '2026-06-02T09:00:00Z',
    });
    const run = await job.startRun({ startedAt: '2026-06-02T09:00:00Z' });

    await expect(job.deleteRun(run.id)).rejects.toThrow('Cannot delete a running schedule run.');
    expect(agent.jobRunIdx.findById(run.id)?.runStatus).toBe('running');
  });


  it('deleteJob cascade：jobs.json 行 + job_runs 行 + 物理目录全清', async () => {
    const { agent } = await makeAgent();
    const job = await agent.createJob({
      name: 'x', message: 'm', enabled: true,
      scheduleType: 'cron', cron: '0 * * * *',
    });
    const run = await job.startRun({ startedAt: '2026-06-01T00:00:00Z' });
    await agent.deleteJob(job.id);

    expect((await agent.listJobs()).map((e) => e.id)).not.toContain(job.id);
    expect(agent.jobRunIdx.findById(run.id)).toBeUndefined();

    const fresh = await freshModules();
    await fresh.ProfileRegistry.bootstrap();
    const store2 = fresh.ProfileRegistry.require(fresh.ProfileRegistry.defaultProfileId).store
    const reloaded = await (await store2.getAgent(agent.id))?.getJob(job.id);
    expect(reloaded).toBeUndefined();
  });
});

describe('JobRun.forkToSession', () => {
  it('copies terminal run history, context and sandbox into a new regular session', async () => {
    const { agent } = await makeAgent();
    const job = await agent.createJob({
      name: 'nightly', message: 'create report', enabled: true,
      scheduleType: 'once', runAt: '2026-06-02T09:00:00Z',
    });
    const run = await job.startRun({ startedAt: '2026-06-02T09:00:00Z' });
    const summary: AssistantMessage = {
      role: 'assistant',
      id: 'm_summary',
      time: 1,
      think: '',
      content: 'compressed history',
      tool_calls: [],
    };
    run.config.contextState = {
      compressions: [{
        earlyPreservedCount: 1,
        summary,
        compressedBeforeIndex: 2,
        appliedAt: '2026-06-02T09:00:30Z',
      }],
      lastTokenUsage: { tokenCount: 12, totalMessages: 2, contextMessages: 2, compressionRatio: 1 },
    };
    run.appendMessage(msg('user', 'create report'));
    run.appendMessage(msg('assistant', 'report created'));
    await run.flushMessages();
    await run.setTitle('Nightly report');
    const sourceFile = path.join(run.filesDir(), 'uploads', 'report.txt');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, 'report body');
    await job.finishRun(run.id, { status: 'completed', completedAt: '2026-06-02T09:01:00Z' });

    const continued = await run.forkToSession(agent.sessionIdx);

    expect(continued.id).not.toBe(run.id);
    expect(continued.toDataFile().kind).toBe('regular');
    expect(continued.title).toBe('Nightly report (continued)');
    expect(continued.config.readStatus).toBe('unread');
    expect(continued.contextState).toEqual(run.contextState);
    expect(continued.contextState).not.toBe(run.contextState);
    expect(continued.contextState.compressions).not.toBe(run.contextState.compressions);
    expect(await continued.loadMessagesAll()).toEqual(await run.loadMessagesAll());
    expect(fs.readFileSync(path.join(continued.filesDir(), 'uploads', 'report.txt'), 'utf8')).toBe('report body');
    expect(agent.jobRunIdx.findById(run.id)?.runStatus).toBe('completed');
    expect(agent.sessionIdx.findById(continued.id)?.agentId).toBe(agent.id);

    const fresh = await freshModules();
    await fresh.ProfileRegistry.bootstrap();
    const reloadedAgent = await (fresh.ProfileRegistry.require(fresh.ProfileRegistry.defaultProfileId).store).getAgent(agent.id);
    const reloaded = await reloadedAgent?.getSession(continued.id);
    expect(reloaded).toBeDefined();
    if (!reloaded) throw new Error('Converted session did not survive reload');
    expect(await reloaded.loadMessagesAll()).toEqual(await continued.loadMessagesAll());
    expect(fs.readFileSync(path.join(reloaded.filesDir(), 'uploads', 'report.txt'), 'utf8')).toBe('report body');
  });

  it('rejects a running run without creating a regular session', async () => {
    const { agent } = await makeAgent();
    const job = await agent.createJob({
      name: 'nightly', message: 'create report', enabled: true,
      scheduleType: 'once', runAt: '2026-06-02T09:00:00Z',
    });
    const run = await job.startRun({ startedAt: '2026-06-02T09:00:00Z' });

    await expect(run.forkToSession(agent.sessionIdx)).rejects.toThrow(
      'Cannot continue a running schedule run.',
    );
    expect(agent.jobRunIdx.findById(run.id)?.runStatus).toBe('running');
    expect((await agent.listSessionsFlat()).map((session) => session.id)).not.toContain(run.id);
  });
});

describe('Step5/Step9 schedule API', () => {
  it('ScheduleJob.applyUpdate 修改基本字段并刷 updatedAt', async () => {
    const { agent } = await makeAgent();
    const job = await agent.createJob({
      name: 'old', message: 'm', enabled: true,
      scheduleType: 'cron', cron: '0 * * * *',
    });
    const beforeUpdatedAt = job.config.updatedAt;
    const { promise: delay2ms, resolve: resolveDelay } = Promise.withResolvers<void>();
    setTimeout(resolveDelay, 2);
    await delay2ms;
    job.applyUpdate({ name: 'new-name', enabled: false, message: 'm2' });
    expect(job.config.name).toBe('new-name');
    expect(job.config.enabled).toBe(false);
    expect(job.config.message).toBe('m2');
    expect(job.config.updatedAt).not.toBe(beforeUpdatedAt);
  });

  it('ScheduleJob.applyUpdate 切换 cron ↔ once 需要带齐字段', async () => {
    const { agent } = await makeAgent();
    const job = await agent.createJob({
      name: 'x', message: 'm', enabled: true,
      scheduleType: 'cron', cron: '0 * * * *',
    });
    job.applyUpdate({ schedule: { kind: 'once', runAt: '2026-12-31T00:00:00Z' } });
    expect(job.config.schedule).toEqual({ kind: 'once', runAt: '2026-12-31T00:00:00Z' });
    expect(() => job.applyUpdate({ schedule: { kind: 'cron', cron: '' } })).toThrow(/cron required/);
    expect(() => job.applyUpdate({ schedule: { kind: 'once', runAt: '' } })).toThrow(/runAt required/);
  });

  it('ScheduleJob.listRunsOnDisk 返回 JobRunRow[]，按 startedAt 倒序，状态字段 runStatus / runError', async () => {
    const { agent } = await makeAgent();
    const job = await agent.createJob({
      name: 'multi', message: 'm', enabled: true,
      scheduleType: 'cron', cron: '0 * * * *',
    });
    const r1 = await job.startRun({ startedAt: '2026-06-01T08:00:00Z' });
    await job.finishRun(r1.id, { status: 'completed', completedAt: '2026-06-01T08:01:00Z' });
    const r2 = await job.startRun({ startedAt: '2026-06-02T09:00:00Z' });
    await job.finishRun(r2.id, { status: 'failed', completedAt: '2026-06-02T09:02:00Z', error: 'boom' });
    const r3 = await job.startRun({ startedAt: '2026-06-03T10:00:00Z' }); // 不 finish，留 running

    const runs = await job.listRunsOnDisk();
    expect(runs.map((r) => r.id)).toEqual([r3.id, r2.id, r1.id]);
    expect(runs[0].runStatus).toBe('running');
    expect(runs[1]).toMatchObject({ id: r2.id, runStatus: 'failed', runError: 'boom' });
    expect(runs[2]).toMatchObject({ id: r1.id, runStatus: 'completed' });
  });

  it('ScheduleJob.listRunsOnDisk 即使内存 cache 已 evict 也能完整列出', async () => {
    const { agent } = await makeAgent();
    const job = await agent.createJob({
      name: 'x', message: 'm', enabled: true,
      scheduleType: 'cron', cron: '0 * * * *',
    });
    const r1 = await job.startRun({ startedAt: '2026-06-01T00:00:00Z' });
    await job.finishRun(r1.id, { status: 'completed', completedAt: '2026-06-01T00:01:00Z' });
    // finishRun 已 evict r1 from runs Map；DB 行仍可见
    const runs = await job.listRunsOnDisk();
    expect(runs.map((r) => r.id)).toEqual([r1.id]);
    expect(runs[0].runStatus).toBe('completed');
  });

  it('Profile.listJobsFlat 跨 agent 聚合', async () => {
    const { store, agent } = await makeAgent();
    const agentB = await store.createAgent({
      name: 'B', version: '1',
    });
    const jobA = await agent.createJob({
      name: 'job-a', message: 'm', enabled: true,
      scheduleType: 'once', runAt: '2026-06-02T00:00:00Z',
    });
    const jobB = await agentB.createJob({
      name: 'job-b', message: 'm', enabled: true,
      scheduleType: 'cron', cron: '0 * * * *',
    });

    const all = await store.listJobsFlat();
    expect(all.map((x) => x.job.id).sort()).toEqual([jobA.id, jobB.id].sort());
    const onlyA = await store.listJobsFlat({ agentId: agent.id });
    expect(onlyA.map((x) => x.job.id)).toEqual([jobA.id]);
    expect(onlyA[0].agent.id).toBe(agent.id);
  });

  it('Profile.findJob 单 jobId 反查 owning agent', async () => {
    const { store, agent } = await makeAgent();
    const job = await agent.createJob({
      name: 'x', message: 'm', enabled: true,
      scheduleType: 'cron', cron: '0 * * * *',
    });
    const hit = await store.findJob(job.id);
    expect(hit?.job.id).toBe(job.id);
    expect(hit?.agent.id).toBe(agent.id);
    const miss = await store.findJob('j_nonexistent');
    expect(miss).toBeUndefined();
  });
});

describe('Agent.getUnreadSummary（Step 9 SQL 直查）', () => {
  it('regular 全量 + schedule_run 窗口内统计', async () => {
    const { agent } = await makeAgent();
    const s1 = await agent.createSession({ title: 'unread1' });
    const s2 = await agent.createSession({ title: 'unread2' });
    await s2.setReadStatus('read');
    const _s3 = await agent.createSession({ title: 'unread3' });
    expect(s1.config.readStatus).toBe('unread');

    const job = await agent.createJob({
      name: 'cron', message: 'm', enabled: true,
      scheduleType: 'cron', cron: '0 * * * *',
    });
    const now = Date.parse('2026-06-10T00:00:00Z');
    // 窗口内 run（未读）
    const recent = await job.startRun({ startedAt: '2026-06-09T00:00:00Z' });
    await job.finishRun(recent.id, { status: 'completed', completedAt: '2026-06-09T00:01:00Z' });
    // 窗口外（10 天前；默认 5d 窗口）
    const stale = await job.startRun({ startedAt: '2026-05-30T00:00:00Z' });
    await job.finishRun(stale.id, { status: 'completed', completedAt: '2026-05-30T00:01:00Z' });

    const summary = await agent.getUnreadSummary({ nowMs: now });
    expect(summary.userUnreadCount).toBe(2);   // s1 + _s3 (s2 已 read)
    expect(summary.scheduledUnreadCount).toBe(1);
  });
});

describe('Agent.listAllScheduleRuns 返回 JobRunRow[]', () => {
  it('按 startedAt 倒序聚合所有 job 的 run', async () => {
    const { agent } = await makeAgent();
    const jobA = await agent.createJob({
      name: 'A', message: 'm', enabled: true,
      scheduleType: 'cron', cron: '0 * * * *',
    });
    const jobB = await agent.createJob({
      name: 'B', message: 'm', enabled: true,
      scheduleType: 'cron', cron: '0 * * * *',
    });
    const rA = await jobA.startRun({ startedAt: '2026-06-01T00:00:00Z' });
    const rB = await jobB.startRun({ startedAt: '2026-06-02T00:00:00Z' });

    const rows = await agent.listAllScheduleRuns();
    expect(rows.map((r) => r.id)).toEqual([rB.id, rA.id]);
    expect(rows[0].jobId).toBe(jobB.id);
    expect(rows[1].jobId).toBe(jobA.id);
  });
});
