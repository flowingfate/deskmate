import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import { renderToMain, mainToRender } from '@shared/ipc/agentChat';

import type { Context } from './shared';
import { mainWindow } from '@main/startup/wins';
import { StreamingChunk } from '@shared/types/streamingTypes';
import Stream from '@shared/stream-iterator';

import type { RegularSession } from '@main/pi';
import type { Message } from '@shared/persist/types'
import type { ChatSessionFile } from '@shared/persist/types'
import { ChatStatus } from '@shared/types/agentChatTypes';
import { rehydrate } from '@main/persist/messageWire';
import { log } from '@main/log';
import { Tracer, type TraceContext } from '@shared/log/trace';
import { requireProfileForSender } from './profileContext';
export default function (ctx: Context) {
  const handle = renderToMain.bindMain(ipcMain);

  /**
   * helper function
   */
  async function responseStream(
    wc: Electron.WebContents,
    chunkStream: Stream<StreamingChunk>,
  ): Promise<void> {
    const sender = mainToRender.bindWebContents(wc);
    for await (const chunk of chunkStream) {
      sender.streamingChunk(chunk);
    }
  }

  /**
   * helper function
   */
  async function runOrchestrator(
    event: Electron.IpcMainInvokeEvent,
    agentId: string,
    chatSessionId: string,
    msgTrace: TraceContext | undefined,
    fn: (
      session: RegularSession,
      stream: Stream<StreamingChunk>,
      eventSender: Electron.WebContents,
      tracer: Tracer,
    ) => Promise<void>,
  ): Promise<{ success: true; data: Message[] } | { success: false; error: string }> {
    const profile = requireProfileForSender(event);
    const profileId = profile.id;

    // chat.ipc 是主链路顶层 span：renderer 传过来的 TraceContext 用 `deserialize` 还原
    // 上游 sid 作为 parent，再 `derive` 出 chat.ipc 自己的 sid。这样 chat.turn 在 session
    // 内 `derive()` 出来时 parent 就是 chat.ipc，psid 自然挂上。
    //
    // 缺省（retry/edit 等没接力 trace 的入口）走 `Tracer.start().derive()`，等价于
    // "main 端新起一棵 trace"，chat.ipc 仍是顶层但 tid 与 renderer 无关。
    const tracer = (msgTrace ? Tracer.deserialize(msgTrace) : Tracer.start())
      .derive()
      .bind({ mod: 'chat.ipc', chatSessionId, agentId: agentId, profileId });
    log.info(tracer.fields({ msg: 'stream start' }));

    const agent = profile.getOrCreateAgent(agentId);
    const session = await agent.getOrCreateSession(chatSessionId);
    const chunkStream = new Stream<StreamingChunk>();
    responseStream(event.sender, chunkStream);
    try {
      await fn(session, chunkStream, event.sender, tracer);
      log.info(tracer.fields({ msg: 'stream done' }, 'self'));
      return { success: true, data: [] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const statusCode = (e as { statusCode?: number })?.statusCode;
      log.warn(tracer.fields({ msg: 'stream failed', statusCode, err: e }, 'self'));
      return { success: false, error: statusCode ? `[HTTP ${statusCode}] ${message}` : message };
    }
  }

  // 取消新编排器路径下指定 session 的进行中 turn。
  // 找不到对应 RegularSession 不视为错误（可能 turn 已结束或从未在此进程创建过）。
  async function stopNewOrchestratorSession(
    event: Electron.IpcMainInvokeEvent,
    agentId: string,
    chatSessionId: string,
  ): Promise<void> {
    const profile = requireProfileForSender(event);
    const session = profile.getAgent(agentId)?.sessions.get(chatSessionId);
    if (session) await session.stopStream();
  }

  handle.streamMessage(async (event, agentId, chatSessionId, message, msgTrace) => {
    if (!agentId || !chatSessionId) {
      return { success: false, error: 'agentId and chatSessionId are required' };
    }
    return runOrchestrator(event, agentId, chatSessionId, msgTrace, (session, stream, sender, t) =>
      session.startStream(message, stream, sender, t),
    );
  });

  handle.retryChat(async (event, agentId, chatSessionId, msgTrace) => {
    if (!agentId || !chatSessionId) {
      return { success: false, error: 'agentId and chatSessionId are required' };
    }
    return runOrchestrator(event, agentId, chatSessionId, msgTrace, (session, stream, sender, t) =>
      session.retryStream(stream, sender, t),
    );
  });

  handle.editUserMessage(async (event, agentId, chatSessionId, messageId, updatedMessage, msgTrace) => {
    if (!agentId || !chatSessionId) {
      return { success: false, error: 'agentId and chatSessionId are required' };
    }
    if (updatedMessage.role !== 'user') {
      return { success: false, error: 'editUserMessage requires a user-role message' };
    }
    return runOrchestrator(event, agentId, chatSessionId, msgTrace, (session, stream, sender, t) =>
      session.editUserMessage(messageId, updatedMessage, stream, sender, t),
    );
  });

  handle.canEditUserMessage(async (event, agentId, chatSessionId, messageId) => {
    try {
      if (!agentId || !chatSessionId) {
        return { success: false, error: 'agentId and chatSessionId are required' };
      }
      const profile = requireProfileForSender(event);
      const agent = profile.getOrCreateAgent(agentId);
      const session = await agent.getOrCreateSession(chatSessionId);
      return { success: true, data: await session.canEditUserMessage(messageId) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // 🔥 New: cancel specified ChatSession operation
  handle.cancelChatSession(async (event, agentId, chatSessionId, msgTrace) => { // cancel 是个独立的主链路 span：从 renderer 接力 trace 时挂在 in-flight chat.send
    // 之下；缺省（无接力）main 端新起 tracer，但仍写完整 span，保证"用户点了取消"这
    // 个事件在 log 体系里始终可见，不依赖前端是否传 trace。
    const tracer = (msgTrace ? Tracer.deserialize(msgTrace) : Tracer.start())
      .derive()
      .bind({ mod: 'chat.ipc', chatSessionId, agentId });
    log.info(tracer.fields({ msg: 'cancel start' }));
    try {
      await stopNewOrchestratorSession(event, agentId, chatSessionId);
      log.info(tracer.fields({ msg: 'cancel done' }, 'self'));
      return { success: true };
    } catch (error) {
      log.warn(tracer.fields({ msg: 'cancel failed', err: error }, 'self'));
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // 删除指定 session 的运行时实例（core/Session 内存态）。文件本身的删除由渲染端
  // 调用 deleteChatSession（profileCacheManager 路径）完成。
  handle.removeAgentInstance(async (event, agentId, chatSessionId) => {
    try {
      const profile = requireProfileForSender(event);
      profile.getAgent(agentId)?.removeSession(chatSessionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Fork ChatSession：persist Agent.copySession 内部统一生成 ULID + cp 目录（含 files/）+ index 同步。
  // 不再做 switchToChatSession，渲染端导航到新 session 后自然触发 ensureCache。
  handle.forkChatSession(async (event, agentId, sourceChatSessionId) => {
    try {
      if (!agentId || !sourceChatSessionId) {
        return { success: false, error: 'agentId and sourceChatSessionId are required' };
      }
      const store = requireProfileForSender(event).store;
      const persistAgent = await store.getAgent(agentId);
      if (!persistAgent) return { success: false, error: `agent not found: ${agentId}` };
      const forked = await persistAgent.copySession(sourceChatSessionId);
      if (!forked) return { success: false, error: 'Failed to copy ChatSession' };

      return { success: true, chatSessionId: forked.id };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Import a single ChatSession JSON file into the current agent.
  handle.importChatSession(async (event, agentId) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        return { success: false, error: 'No main window available' };
      }

      // 1. Show file selection dialog, select chat session JSON file
      const result = await dialog.showOpenDialog(win, {
        title: 'Select Chat Session JSON',
        properties: ['openFile'],
        filters: [
          { name: 'Chat Session JSON', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      // Handle dialog result (compatible with both old and new API)
      let jsonPath: string | undefined;

      if (Array.isArray(result)) {
        // Old API format (just file paths array)
        if (result.length === 0) {
          return { success: false, error: 'File selection canceled' };
        }
        jsonPath = result[0];
      } else {
        // New API format (object with canceled and filePaths)
        const dialogResult = result as { canceled: boolean; filePaths: string[] };
        if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
          return { success: false, error: 'File selection canceled' };
        }
        jsonPath = dialogResult.filePaths[0];
      }

      if (!jsonPath) {
        return { success: false, error: 'No file selected' };
      }

      // 2. 读 JSON + 简单校验
      const fileContent = await fs.promises.readFile(jsonPath, 'utf-8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(fileContent);
      } catch {
        return { success: false, error: 'Invalid JSON file' };
      }
      if (!parsed || typeof parsed !== 'object') {
        return { success: false, error: 'Invalid chat session JSON structure' };
      }
      const file = parsed as Partial<ChatSessionFile>;
      if (
        typeof file.title !== 'string' ||
        !Array.isArray(file.messages)
      ) {
        return { success: false, error: 'Invalid chat session JSON structure' };
      }

      // 3. 走 persist:新建 session(生成新 id) + 灌 messages + 持久化 title/contextState。
      // file.messages 是 PersistedJsonLine[];rehydrate 折回 Domain Message[] 后,
      // rewriteMessages 一次性按 dehydrate 的同形态重写 jsonl(orphan tool_res 默认丢弃)。
      const store = requireProfileForSender(event).store;
      const persistAgent = await store.getAgent(agentId);
      if (!persistAgent) return { success: false, error: `agent not found: ${agentId}` };

      const newSession = await persistAgent.createSession({
        title: file.title,
        contextState: file.contextState,
      });
      const { messages: domainMsgs, orphanResponses } = rehydrate(file.messages);
      if (orphanResponses.length > 0) {
        log.warn?.({
          msg: '[ipc/agent-chat] importChatSession dropped orphan tool responses',
          mod: 'importChatSession',
          agentId,
          sessionId: newSession.id,
          orphanCount: orphanResponses.length,
        });
      }
      await newSession.rewriteMessages(domainMsgs);
      await newSession.persist();

      log.info?.({
        msg: '[ipc/agent-chat] Imported chat session from JSON file',
        mod: 'importChatSession',
        agentId,
        sourceSessionId: file.chatSession_id,
        importedSessionId: newSession.id,
        jsonPath,
      });

      return {
        success: true,
        importedSessions: 1,
        importedSessionId: newSession.id,
        importedWorkspaceFiles: 0,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // 拉 regular session 快照：路由切换或冷启动时按需加载历史消息。
  // chatStatus 优先取 pi.RegularSession 内存态，否则 IDLE。
  // 仅服务 regular 形态；schedule_run 走 `loadJobRunSnapshot`。
  handle.loadChatSessionSnapshot(async (event, agentId, chatSessionId) => {
    try {
      if (!agentId || !chatSessionId) {
        return { success: false, error: 'agentId and chatSessionId are required' };
      }
      const profile = requireProfileForSender(event);
      const persistAgent = await profile.store.getAgent(agentId);
      if (!persistAgent) return { success: false, error: `agent not found: ${agentId}` };
      const persistSession = await persistAgent.getSession(chatSessionId);
      let messages: Message[] = [];
      if (persistSession) {
        const { messages: domain } = await persistSession.loadDomainMessages();
        messages = domain;
      }
      const title = persistSession?.title ?? '';
      const liveSession = profile.getAgent(agentId)?.sessions.get(chatSessionId);
      const liveStatus = liveSession?.status;
      const chatStatus: ChatStatus = liveStatus ?? ChatStatus.IDLE;
      // live session 的 contextState 永远比落盘的更新（persist 只在 turn 边界发生）
      const contextTokenUsage =
        liveSession?.contextState.lastTokenUsage ?? persistSession?.contextState.lastTokenUsage;
      // 上次进程退出时 turn 没收尾 → 透 `interrupted` 给 renderer。turn=running 是
      // 落盘事实,即使 liveSession 已把 pendingResume 消费,只要 markTurnIdle 还
      // 没落盘(如刚 restore 还没触发任何 entry),持久化层仍然 running。**文案
      // 留给 renderer** —— 主进程不出 UI 字符串。
      const interrupted = persistSession?.config.turn?.status === 'running';
      return { success: true, data: { messages, chatStatus, title, contextTokenUsage, interrupted } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // 拉 job run 快照：路由 `/agent/:agentId/job/:jobId/:sessionId` 切到某次 run 时调用。
  // 与 `loadChatSessionSnapshot` 物理隔离 —— 走 `Agent.getJob().getRun()`，
  // 不复用 regular session 入口；JobRun 不进 pi.Agent.sessions，无 liveSession，
  // chatStatus 始终 IDLE（已完成 run 这就是事实；正在跑的 run 渲染端不订阅增量）。
  handle.loadJobRunSnapshot(async (event, agentId, jobId, runId) => {
    try {
      if (!agentId || !jobId || !runId) {
        return { success: false, error: 'agentId, jobId and runId are required' };
      }
      const store = requireProfileForSender(event).store;
      const persistAgent = await store.getAgent(agentId);
      if (!persistAgent) return { success: false, error: `agent not found: ${agentId}` };
      const job = await persistAgent.getJob(jobId);
      if (!job) return { success: false, error: `job not found: ${jobId}` };
      const run = await job.getRun(runId);
      let messages: Message[] = [];
      if (run) {
        const { messages: domain } = await run.loadDomainMessages();
        messages = domain;
      }
      const title = run?.title ?? '';
      const contextTokenUsage = run?.contextState.lastTokenUsage;
      return {
        success: true,
        data: { messages, chatStatus: ChatStatus.IDLE, title, contextTokenUsage },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // 标记 regular session 已读。渲染端路由切到该 session 时调用。
  handle.markSessionRead(async (event, agentId, chatSessionId) => {
    try {
      if (!agentId || !chatSessionId) {
        return { success: false, error: 'agentId and chatSessionId are required' };
      }
      const store = requireProfileForSender(event).store;
      const persistAgent = await store.getAgent(agentId);
      const persistSession = await persistAgent?.getSession(chatSessionId);
      await persistSession?.setReadStatus('read');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // 标记 job run 已读。与 `markSessionRead` 物理隔离。
  handle.markJobRunRead(async (event, agentId, jobId, runId) => {
    try {
      if (!agentId || !jobId || !runId) {
        return { success: false, error: 'agentId, jobId and runId are required' };
      }
      const store = requireProfileForSender(event).store;
      const persistAgent = await store.getAgent(agentId);
      const job = await persistAgent?.getJob(jobId);
      const run = await job?.getRun(runId);
      await run?.setReadStatus('read');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

}
