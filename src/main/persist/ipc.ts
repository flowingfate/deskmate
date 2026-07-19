/**
 * Persist 模块的 IPC handler。注册 `persist:*` 通道并把 renderer 调用映射到
 * `ProfileRegistry` / `Agent` / `Session` 上。类型签名见
 * [`src/shared/ipc/persist.ts`](../../shared/ipc/persist.ts)。
 */

import { shell, type IpcMain } from 'electron';

import { renderToMain, type PersistResult, type PersistSnapshot } from '../../shared/ipc/persist';
import { ProfileRegistry } from '@main/profileRegistry';
import { emit } from './lib/emit';
import { getAppRoot } from './lib/root';
import { PERSIST_PATH } from '../../shared/persist/path';
import { computeStorageOverview, resolveRevealTarget } from './storageOverview';
import type { AgentRecord, ArchivedAgentEntry } from '../../shared/persist/types';
import type { ProfileStore } from '@main/persist';
import { requireProfileForSender } from '@main/startup/ipc/profileContext';

function err(error: unknown): { success: false; error: string } {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

export async function querySession(store: ProfileStore, agentId: string, sessionId: string) {
  const agent = await store.getAgent(agentId);
  if (!agent) return { success: false, error: `Agent not found: ${agentId}` } as const;
  const session = await agent.getSession(sessionId);
  if (!session) return { success: false, error: `Session not found: ${sessionId}` } as const;
  return { success: true, store, agent, session } as const;
}

export async function queryJobRun(store: ProfileStore, agentId: string, jobId: string, runId: string) {
  const agent = await store.getAgent(agentId);
  if (!agent) return { success: false, error: `Agent not found: ${agentId}` } as const;
  const job = await agent.getJob(jobId);
  if (!job) return { success: false, error: `Job not found: ${jobId}` } as const;
  const run = await job.getRun(runId);
  if (!run) return { success: false, error: `Run not found: ${runId}` } as const;
  return { success: true, store, agent, job, run } as const;
}

export function registerPersistIpc(ipc: IpcMain): void {
  const handle = renderToMain.bindMain(ipc);
  // 同一窗口 Profile 的 atom fan-out 合并为一个 snapshot；不同窗口绝不能共享它。
  const inflight = new Map<string, Promise<PersistResult<PersistSnapshot>>>();
  handle.getSnapshot(async (event) => {
    const store = requireProfileForSender(event).store
    const existing = inflight.get(store.id);
    if (existing) return existing;
    const pending = (async (): Promise<PersistResult<PersistSnapshot>> => {
      try {
        return { success: true, data: await store.getSnapshot() };
      } catch (e) { return err(e); }
    })();
    inflight.set(store.id, pending);
    try {
      return await pending;
    } finally {
      if (inflight.get(store.id) === pending) inflight.delete(store.id);
    }
  });


  handle.listAllSessions(async (event, agentId) => {
    try {
      const store = requireProfileForSender(event).store
      const agent = await store.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      return { success: true, data: await agent.listSessionsFlat({ kind: 'regular' }) };
    } catch (e) { return err(e); }
  });

  handle.listAllScheduleRuns(async (event, agentId) => {
    try {
      const store = requireProfileForSender(event).store
      const agent = await store.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      return { success: true, data: await agent.listAllScheduleRuns() };
    } catch (e) { return err(e); }
  });

  handle.getSession(async (event, agentId, sessionId) => {
    try {
      const store = requireProfileForSender(event).store
      const agent = await store.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      const session = await agent.getSession(sessionId);
      if (!session) return { success: true, data: null };
      return {
        success: true,
        data: session.toDataFile(),
      };
    } catch (e) { return err(e); }
  });

  handle.getSessionFilesDir(async (event, agentId, sessionId) => {
    try {
      const store = requireProfileForSender(event).store
      const agent = await store.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      // 跨形态查 session：renderer 在 job-run 路由下也会调本 IPC（WorkspaceExplorer
      // 的 session-files 区段对两种 session 都展示）。findSessionAcrossKinds 命中
      // 顺序 sessionIdx → jobRunIdx,与 LocalProtocolHandler 一致。
      const session = await agent.findSessionAcrossKinds(sessionId);
      if (!session) return { success: true, data: null };
      return { success: true, data: session.filesDir() };
    } catch (e) { return err(e); }
  });

  // ─────────── Agent CRUD ───────────

  handle.createAgent(async (event, input) => {
    try {
      const store = requireProfileForSender(event).store
      const agent = await store.createAgent({
        name: input.name,
        description: input.description,
        version: input.version ?? '1.0.0',
        model: input.model,
        emoji: input.emoji,
        avatar: input.avatar,
        systemPrompt: input.systemPrompt,
      });
      if (input.front && Object.keys(input.front).length > 0) {
        await agent.patchFront(input.front);
      }
      return { success: true, data: { id: agent.id } };
    } catch (e) { return err(e); }
  });

  handle.patchAgentFront(async (event, agentId, patch, systemPrompt) => {
    try {
      const store = requireProfileForSender(event).store
      const agent = await store.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      // systemPrompt 在 patchFront 前赋值，让单次写盘同时覆盖 body 与 front-matter。
      if (systemPrompt !== undefined) agent.systemPrompt = systemPrompt;
      await agent.patchFront(patch);
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.archiveAgent(async (event, agentId) => {
    try {
      const store = requireProfileForSender(event).store
      await store.archiveAgent(agentId);
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.unarchiveAgent(async (event, agentId) => {
    try {
      const store = requireProfileForSender(event).store
      // 取同 id 中 archivedAt 最大的归档项恢复。
      const archived = await store.archive.listArchivedAgents();
      const candidates = archived.filter((a) => a.id === agentId);
      if (candidates.length === 0) return { success: false, error: 'archived agent not found' };
      candidates.sort((a, b) => (a.archivedAt < b.archivedAt ? 1 : a.archivedAt > b.archivedAt ? -1 : 0));
      await store.restoreAgent(candidates[0].archivedId);
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.duplicateAgent(async (event, sourceAgentId, newName) => {
    try {
      if (typeof newName !== 'string' || !newName.trim()) {
        return { success: false, error: 'invalid agent name' };
      }
      const store = requireProfileForSender(event).store
      const dup = await store.duplicateAgent(sourceAgentId, newName.trim());
      return { success: true, data: { id: dup.id } };
    } catch (e) { return err(e); }
  });

  handle.setPrimaryAgent(async (event, agentId) => {
    try {
      const store = requireProfileForSender(event).store
      await store.setPrimaryAgent(agentId);
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.listArchivedAgents(async (event) => {
    try {
      const store = requireProfileForSender(event).store
      const items = await store.archive.listArchivedAgents();
      const out: ArchivedAgentEntry[] = [];
      for (const item of items) {
        const md = await store.archive.readMarkdown(item.archivedId);
        // 历史 _record.json 未写 model 字段（重构前归档）；优先取 record，回退到 AGENT.md。
        const model = item.model ?? md?.frontMatter.model ?? '';
        const base = {
          id: item.id,
          name: item.name,
          version: item.version,
          description: item.description ?? md?.frontMatter.description,
          emoji: item.emoji,
          avatar: item.avatar,
          model,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
        const record: AgentRecord = base;
        out.push({ archivedId: item.archivedId, archivedAt: item.archivedAt, record, markdown: md ?? null });
      }
      return { success: true, data: out };
    } catch (e) { return err(e); }
  });

  handle.getAgentDetail(async (event, agentId) => {
    try {
      const store = requireProfileForSender(event).store
      return { success: true, data: await store.getAgentDetail(agentId) };
    } catch (e) { return err(e); }
  });

  // ─────────── Session 写路径 ───────────

  handle.renameSession(async (event, agentId, sessionId, newTitle) => {
    try {
      const query = await querySession(requireProfileForSender(event).store, agentId, sessionId);
      if (!query.success) return query;
      await query.session.setTitle(newTitle);
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.setSessionStarred(async (event, agentId, sessionId, starred) => {
    try {
      const query = await querySession(requireProfileForSender(event).store, agentId, sessionId);
      if (!query.success) return query;
      const now = new Date().toISOString();
      // session.setStar 写 data.json#star → onChange 触发 `sessionIdx.upsert` 同步 starred_at +
      // emit `session:index:updated`。下一行补一次 `starred:updated`，让跨 agent 订阅 starred 列表
      // 的 renderer atom（starred.atom）即时刷新（onChange 路径只发 session:index:updated）。
      await query.session.setStar(starred ? { starredAt: now } : undefined);
      emit(query.store.id, 'starred:updated', {
        items: query.store.sessionIdx.listStarred(),
      });
      return { success: true };
    } catch (e) { return err(e); }
  });
  handle.deleteSession(async (event, agentId, sessionId) => {
    try {
      const store = requireProfileForSender(event).store
      const agent = await store.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      // 只有"被删 session 之前确实 star 过"才广播 starred:updated；否则跳过整列广播。
      // `sessionIdx.remove` 自己只 emit `session:index:updated`(op='remove')，无 starred 含义。
      const wasStarred = store.sessionIdx.findById(sessionId)?.starredAt != null;
      if (!await agent.deleteSession(sessionId)) {
        return { success: false, error: `session not found: ${sessionId}` };
      }
      if (wasStarred) {
        emit(store.id, 'starred:updated', { items: store.sessionIdx.listStarred() });
      }
      return { success: true };
    } catch (e) { return err(e); }
  });
  handle.deleteScheduleRun(async (event, agentId, jobId, runId) => {
    try {
      const store = requireProfileForSender(event).store
      const agent = await store.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      const job = await agent.getJob(jobId);
      if (!job) return { success: false, error: `schedule job not found: ${jobId}` };
      if (!await job.deleteRun(runId)) {
        return { success: false, error: `schedule run not found: ${runId}` };
      }
      return { success: true };
    } catch (e) { return err(e); }
  });
  handle.forkJobRunToSession(async (event, agentId, jobId, runId) => {
    try {
      const query = await queryJobRun(requireProfileForSender(event).store, agentId, jobId, runId);
      if (!query.success) return query;
      const session = await query.run.forkToSession(query.agent.sessionIdx);
      return { success: true, data: { sessionId: session.id } };
    } catch (e) { return err(e); }
  });

  handle.getSessionMessages(async (event, agentId, sessionId) => {
    try {
      const query = await querySession(requireProfileForSender(event).store, agentId, sessionId);
      if (!query.success) return { success: true, data: null };
      const messages = await query.session.loadMessagesAll();
      return { success: true, data: { data: query.session.toDataFile(), messages } };
    } catch (e) { return err(e); }
  });

  handle.getUnreadSummary(async (event, agentId) => {
    try {
      const store = requireProfileForSender(event).store
      const agent = await store.getAgent(agentId);
      if (!agent) {
        return {
          success: true,
          data: { agentId, userUnreadCount: 0, scheduledUnreadCount: 0, updatedAt: new Date().toISOString() },
        };
      }
      const summary = await agent.getUnreadSummary();
      return { success: true, data: summary };
    } catch (e) { return err(e); }
  });

  // ─────────── Settings ───────────

  handle.updateConfirmationSettings(async (event, settings) => {
    try {
      const store = requireProfileForSender(event).store
      await store.patchSettings({ confirmation: settings });
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.updateWebSearchSettings(async (event, settings) => {
    try {
      const store = requireProfileForSender(event).store
      await store.patchSettings({ webSearch: settings });
      return { success: true };
    } catch (e) { return err(e); }
  });

  // ─────────── 本地数据透明（/settings/persist） ───────────

  handle.getStorageOverview(async (event) => {
    try {
      const registry = ProfileRegistry;
      const store = requireProfileForSender(event).store
      const data = await computeStorageOverview(store, registry);
      return { success: true, data };
    } catch (e) { return err(e); }
  });

  handle.revealStoragePath(async (event, absPath) => {
    try {
      const store = requireProfileForSender(event).store
      const root = getAppRoot();
      const profileRoot = PERSIST_PATH.profileDir(root, store.id);
      const resolved = await resolveRevealTarget(profileRoot, root, absPath);
      if (!resolved) return { success: false, error: 'Path is outside the profile directory or does not exist' };
      if (resolved.isFile) {
        shell.showItemInFolder(resolved.target);
      } else {
        const openErr = await shell.openPath(resolved.target);
        if (openErr) return { success: false, error: openErr };
      }
      return { success: true };
    } catch (e) { return err(e); }
  });
}
