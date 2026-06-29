/**
 * Persist 模块的 IPC handler。注册 `persist:*` 通道并把 renderer 调用映射到
 * `Profiles` / `Agent` / `Session` 上。类型签名见
 * [`src/shared/ipc/persist.ts`](../../shared/ipc/persist.ts)。
 */

import type { IpcMain } from 'electron';

import { renderToMain, type PersistResult, type PersistSnapshot } from '../../shared/ipc/persist';
import { Profiles } from './profiles';
import { emit } from './lib/emit';
import type { AgentRecord, ArchivedAgentEntry } from '../../shared/persist/types';

function err(error: unknown): { success: false; error: string } {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

export function registerPersistIpc(ipc: IpcMain): void {
  const handle = renderToMain.bindMain(ipc);

  // getSnapshot 同 tick 并发合并：renderer 端 atom 模块加载与 profile 切换会触发
  // 多窗口 / 多 atom 并发调用；本地内存里 Profile/Agent class 都已缓存，重新 build
  // snapshot 只是 CPU 拼装，但 N 次并发仍会重复拼装 + IPC 序列化。inflight 合并
  // 把同一 tick 内未结束的调用收成一份共享 Promise，结束即释放，下一次仍然 fresh。
  let inflight: Promise<PersistResult<PersistSnapshot>> | null = null;
  handle.getSnapshot(async () => {
    if (inflight) return inflight;
    const pending = (async (): Promise<PersistResult<PersistSnapshot>> => {
      try {
        const profile = await Profiles.get().active();
        return { success: true, data: await profile.getSnapshot() };
      } catch (e) { return err(e); }
    })();
    inflight = pending;
    try {
      return await pending;
    } finally {
      if (inflight === pending) inflight = null;
    }
  });

  handle.switchProfile(async (_e, profileId) => {
    try {
      await Profiles.get().switch(profileId);
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.listAllSessions(async (_e, agentId) => {
    try {
      const profile = await Profiles.get().active();
      const agent = await profile.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      return { success: true, data: await agent.listSessionsFlat({ kind: 'regular' }) };
    } catch (e) { return err(e); }
  });

  handle.listAllScheduleRuns(async (_e, agentId) => {
    try {
      const profile = await Profiles.get().active();
      const agent = await profile.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      return { success: true, data: await agent.listAllScheduleRuns() };
    } catch (e) { return err(e); }
  });

  handle.getSession(async (_e, agentId, sessionId) => {
    try {
      const profile = await Profiles.get().active();
      const agent = await profile.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      const session = await agent.getSession(sessionId);
      if (!session) return { success: true, data: null };
      return {
        success: true,
        data: session.toDataFile(),
      };
    } catch (e) { return err(e); }
  });

  handle.getSessionFilesDir(async (_e, agentId, sessionId) => {
    try {
      const profile = await Profiles.get().active();
      const agent = await profile.getAgent(agentId);
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

  handle.createAgent(async (_e, input) => {
    try {
      const profile = await Profiles.get().active();
      const agent = await profile.createAgent({
        name: input.name,
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

  handle.patchAgentFront(async (_e, agentId, patch, systemPrompt) => {
    try {
      const profile = await Profiles.get().active();
      const agent = await profile.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      // systemPrompt 在 patchFront 前赋值，让单次写盘同时覆盖 body 与 front-matter。
      if (systemPrompt !== undefined) agent.systemPrompt = systemPrompt;
      await agent.patchFront(patch);
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.archiveAgent(async (_e, agentId) => {
    try {
      const profile = await Profiles.get().active();
      await profile.archiveAgent(agentId);
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.unarchiveAgent(async (_e, agentId) => {
    try {
      const profile = await Profiles.get().active();
      // 取同 id 中 archivedAt 最大的归档项恢复。
      const archived = await profile.archive.listArchivedAgents();
      const candidates = archived.filter((a) => a.id === agentId);
      if (candidates.length === 0) return { success: false, error: 'archived agent not found' };
      candidates.sort((a, b) => (a.archivedAt < b.archivedAt ? 1 : a.archivedAt > b.archivedAt ? -1 : 0));
      await profile.restoreAgent(candidates[0].archivedId);
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.duplicateAgent(async (_e, sourceAgentId, newName) => {
    try {
      if (typeof newName !== 'string' || !newName.trim()) {
        return { success: false, error: 'invalid agent name' };
      }
      const profile = await Profiles.get().active();
      const dup = await profile.duplicateAgent(sourceAgentId, newName.trim());
      return { success: true, data: { id: dup.id } };
    } catch (e) { return err(e); }
  });

  handle.setPrimaryAgent(async (_e, agentId) => {
    try {
      const profile = await Profiles.get().active();
      await profile.setPrimaryAgent(agentId);
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.listArchivedAgents(async () => {
    try {
      const profile = await Profiles.get().active();
      const items = await profile.archive.listArchivedAgents();
      const out: ArchivedAgentEntry[] = [];
      for (const item of items) {
        const md = await profile.archive.readMarkdown(item.archivedId);
        // 历史 _record.json 未写 model 字段（重构前归档）；优先取 record，回退到 AGENT.md。
        const model = item.model ?? md?.frontMatter.model ?? '';
        const base = {
          id: item.id,
          name: item.name,
          version: item.version,
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

  handle.getAgentDetail(async (_e, agentId) => {
    try {
      const profile = await Profiles.get().active();
      return { success: true, data: await profile.getAgentDetail(agentId) };
    } catch (e) { return err(e); }
  });

  // ─────────── Session 写路径 ───────────

  handle.renameSession(async (_e, agentId, sessionId, newTitle) => {
    try {
      const profile = await Profiles.get().active();
      const agent = await profile.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      const session = await agent.getSession(sessionId);
      if (!session) return { success: false, error: `session not found: ${sessionId}` };
      await session.setTitle(newTitle);
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.setSessionStarred(async (_e, agentId, sessionId, starred) => {
    try {
      const profile = await Profiles.get().active();
      const agent = await profile.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      const session = await agent.getSession(sessionId);
      if (!session) return { success: false, error: `session not found: ${sessionId}` };
      const now = new Date().toISOString();
      // session.setStar 写 data.json#star → onChange 触发 `sessionIdx.upsert` 同步 starred_at +
      // emit `session:index:updated`。下一行补一次 `starred:updated`，让跨 agent 订阅 starred 列表
      // 的 renderer atom（starred.atom）即时刷新（onChange 路径只发 session:index:updated）。
      await session.setStar(starred ? { starredAt: now } : undefined);
      emit('starred:updated', { profileId: profile.id, items: profile.sessionIdx.listStarred() });
      return { success: true };
    } catch (e) { return err(e); }
  });
  handle.deleteSession(async (_e, agentId, sessionId) => {
    try {
      const profile = await Profiles.get().active();
      const agent = await profile.getAgent(agentId);
      if (!agent) return { success: false, error: `agent not found: ${agentId}` };
      // 只有"被删 session 之前确实 star 过"才广播 starred:updated；否则跳过整列广播。
      // `sessionIdx.remove` 自己只 emit `session:index:updated`(op='remove')，无 starred 含义。
      const wasStarred = profile.sessionIdx.findById(sessionId)?.starredAt != null;
      await agent.deleteSession(sessionId);
      if (wasStarred) {
        emit('starred:updated', { profileId: profile.id, items: profile.sessionIdx.listStarred() });
      }
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.getSessionMessages(async (_e, agentId, sessionId) => {
    try {
      const profile = await Profiles.get().active();
      const agent = await profile.getAgent(agentId);
      if (!agent) return { success: true, data: null };
      const session = await agent.getSession(sessionId);
      if (!session) return { success: true, data: null };
      const messages = await session.loadMessagesAll();
      return { success: true, data: { data: session.toDataFile(), messages } };
    } catch (e) { return err(e); }
  });

  handle.getUnreadSummary(async (_e, agentId) => {
    try {
      const profile = await Profiles.get().active();
      const agent = await profile.getAgent(agentId);
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

  handle.updateConfirmationSettings(async (_e, settings) => {
    try {
      const profile = await Profiles.get().active();
      await profile.patchSettings({ confirmation: settings });
      return { success: true };
    } catch (e) { return err(e); }
  });

  handle.updateWebSearchSettings(async (_e, settings) => {
    try {
      const profile = await Profiles.get().active();
      await profile.patchSettings({ webSearch: settings });
      return { success: true };
    } catch (e) { return err(e); }
  });
}
