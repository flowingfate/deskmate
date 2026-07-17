/**
 * pi 路径下的 IPC handler（Step 7-9）。
 *
 * 三组职责，单 namespace `pi`：
 * - listAccounts / startLogin / cancelLogin / submitPrompt / setApiKey / logout
 *   provider 认证。startLogin 是阻塞 Promise，IPC 立刻 return sessionId，
 *   登录在后台 .then().catch() 推进，进度走 mainToRender 事件流（CLAUDE.md
 *   "IPC handler 不要 await 非关键路径"）。
 * - listModelsForProvider / getModelInfo
 *   model registry —— 双双走 pi 的 `listModels(provider)` / `getModelInfo(parsed)`
 *   统一入口。Handler 只做 ResolvedModel → IPC DTO 的字段重命名，所有
 *   provider（含 github-copilot）的 capability 派生在 pi/model.ts 内做完。
 *
 * sessionMap 索引正在进行的 startLogin。renderer 通过 sessionId 把
 * onPrompt / onSelect 的输入路由回 main 进程的 Resolver。
 *
 * 登录退出条件：
 * - 成功 → loginComplete{success:true}，清 sessionMap 项
 * - 失败 / 取消 / 超时 → loginComplete{success:false, error}
 * - 5 分钟内未完成 → abort + 报 timeout
 */

import { ipcMain } from 'electron';

import type { Context } from './shared';
import { getModelInfo, getPiAuthManager, listModels, type ResolvedModel } from '@main/pi';
import { parseAgentModel } from '@shared/utils/agentModelId';
import { renderToMain, mainToRender, type PiModelListItem, type PiModelInfo } from '@shared/ipc/pi';
import { requireProfileForSender } from './profileContext';

const LOGIN_TIMEOUT_MS = 5 * 60_000;

interface LoginSession {
  sessionId: string;
  provider: string;
  profileId: string;
  abortController: AbortController;
  timeoutHandle: NodeJS.Timeout;
  /** onPrompt / onSelect 的 resolver；同一 sessionId 一次只有一个挂起 */
  pendingResolver?: { resolve: (value: string | undefined) => void };
  webContents: Electron.WebContents;
}

const sessions = new Map<string, LoginSession>();

function nextSessionId(): string {
  return `login_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function failSession(s: LoginSession, error: string): void {
  if (s.pendingResolver) {
    s.pendingResolver.resolve(undefined);
    s.pendingResolver = undefined;
  }
  s.abortController.abort();
  clearTimeout(s.timeoutHandle);
  sessions.delete(s.sessionId);
  if (!s.webContents.isDestroyed()) {
    mainToRender.bindWebContents(s.webContents).loginComplete({
      sessionId: s.sessionId,
      success: false,
      provider: s.provider,
      error,
    });
  }
}

export default function (ctx: Context) {
  const handle = renderToMain.bindMain(ipcMain);

  // ─── auth ──────────────────────────────────────────────────────────────

  handle.listAccounts(async (event) => {
    try {
      const data = await getPiAuthManager(requireProfileForSender(event).id).listProviders();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  handle.startLogin(async (event, provider) => {
    try {
      const profileId = requireProfileForSender(event).id;

      const sessionId = nextSessionId();
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => {
        const s = sessions.get(sessionId);
        if (s) failSession(s, 'Login timed out after 5 minutes');
      }, LOGIN_TIMEOUT_MS);

      const session: LoginSession = {
        profileId,
        sessionId,
        provider,
        abortController,
        timeoutHandle,
        webContents: event.sender,
      };
      sessions.set(sessionId, session);

      const send = mainToRender.bindWebContents(event.sender);
      const safeSend = <K extends keyof typeof send>(ch: K, payload: Parameters<(typeof send)[K]>[0]): void => {
        if (event.sender.isDestroyed()) return;
        (send[ch] as (p: typeof payload) => void)(payload);
      };

      const promptOrSelect = <T>(): Promise<T> =>
        new Promise<T>((resolve) => {
          // 类型 cast：onPrompt 返回 string，onSelect 返回 string|undefined，
          // 这里统一存 (string|undefined) 的 resolver，调用方 cast 回各自类型。
          session.pendingResolver = { resolve: resolve as (v: string | undefined) => void };
        });

      // fire-and-forget：handler 立即返回 sessionId，登录在后台推进。
      getPiAuthManager(profileId)
        .startLogin(provider, {
          signal: abortController.signal,
          onAuth: (url, instructions) => safeSend('auth', { sessionId, url, instructions }),
          onDeviceCode: (info) => safeSend('deviceCode', { sessionId, ...info }),
          onProgress: (message) => safeSend('progress', { sessionId, message }),
          onPrompt: async ({ message, placeholder, allowEmpty }) => {
            safeSend('prompt', { sessionId, message, placeholder, allowEmpty });
            const v = await promptOrSelect<string | undefined>();
            return v ?? '';
          },
          onSelect: async ({ message, options }) => {
            safeSend('select', { sessionId, message, options });
            return promptOrSelect<string | undefined>();
          },
        })
        .then(() => {
          clearTimeout(timeoutHandle);
          sessions.delete(sessionId);
          if (!event.sender.isDestroyed()) {
            safeSend('loginComplete', { sessionId, success: true, provider });
          }
        })
        .catch((err) => {
          const s = sessions.get(sessionId);
          if (s) failSession(s, err instanceof Error ? err.message : String(err));
        });

      return { success: true, data: { sessionId } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  handle.cancelLogin(async (event, sessionId) => {
    const profileId = requireProfileForSender(event).id;
    const session = sessions.get(sessionId);
    if (session && session.profileId === profileId) failSession(session, 'Cancelled by user');
    return { success: true };
  });

  handle.submitPrompt(async (event, sessionId, value) => {
    const profileId = requireProfileForSender(event).id;
    const session = sessions.get(sessionId);
    if (!session || session.profileId !== profileId || !session.pendingResolver) {
      return { success: false, error: 'No pending prompt' };
    }
    session.pendingResolver.resolve(value);
    session.pendingResolver = undefined;
    return { success: true };
  });

  handle.setApiKey(async (event, provider, apiKey, baseUrl) => {
    try {
      await getPiAuthManager(requireProfileForSender(event).id).setApiKey(provider, apiKey, baseUrl);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  handle.logout(async (event, provider) => {
    try {
      await getPiAuthManager(requireProfileForSender(event).id).logout(provider);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  // ─── model registry ────────────────────────────────────────────────────
  //
  // 全部走 pi.listModels / pi.getModelInfo —— pi 是所有 provider 的唯一
  // model 入口（统一来自 pi-ai 内置 model 表，含 github-copilot）。本
  // handler 只做 ResolvedModel → PiModelListItem / PiModelInfo 的字段
  // 重命名映射。

  handle.listModelsForProvider(async (_event, provider) => {
    try {
      const resolved = await listModels(provider);
      const items: PiModelListItem[] = resolved.map((r) => toListItem(r));
      return { success: true, data: items };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  handle.getModelInfo(async (_event, modelKey) => {
    try {
      const parsed = parseAgentModel(modelKey);
      if (!parsed) return { success: true, data: null };
      const resolved = await getModelInfo(parsed);
      if (!resolved) return { success: true, data: null };
      return { success: true, data: toModelInfo(resolved) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

function toListItem(r: ResolvedModel): PiModelListItem {
  return {
    id: r.model.id,
    name: r.model.name,
    reasoning: r.capabilities.reasoning,
    toolCalls: r.capabilities.tools,
    vision: r.capabilities.images,
  };
}

function toModelInfo(r: ResolvedModel): PiModelInfo {
  return {
    id: r.model.id,
    name: r.model.name,
    contextWindow: r.capabilities.contextWindow,
    maxTokens: r.capabilities.maxTokens,
    supportsTools: r.capabilities.tools,
    supportsImages: r.capabilities.images,
    reasoning: r.capabilities.reasoning,
    // ResolvedModel.reasoningLevels 已经统一为 pi-ai 标准枚举（含 GHC 的
    // reasoning_effort 经 thinkingLevelMap 投影），非 reasoning model 为空数组。
    thinkingLevels: r.capabilities.reasoningLevels,
  };
}
