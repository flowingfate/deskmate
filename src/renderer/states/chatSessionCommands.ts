/**
 * ChatSession 跨组件命令（替代旧的 `chatSession:delete` / `chatSession:fork` /
 * `chatSession:rename` / `chatSession:toggleStar` / `chatSession:download` 自定义 window 事件）。
 *
 * 这些命令**自身无状态**——只是把菜单/会话列表的动作转译成对既有 atom（删除确认框
 * DeleteConfirmAtom / 重命名框 RenameChatSessionAtom / toast）与 IPC 的联合操作。
 * 因此用 `mutate`（atom 库的无状态多-atom 组合原语，见 atom/ai.prompt.md 进阶用法 4）
 * 而非再造一个空 state 的 action atom。
 *
 * 命令用 discriminated union 表达，`chatSessionCommands.use()` 拿到单一 dispatcher。
 * fork 后的路由跳转走 `router.navigate`（data router 命令式入口）。
 */

import { mutate, type UseAtom } from '@/atom';
import { router } from '@/entries/main.routes';
import { persistApi } from '@/ipc/persist';
import { agentChatApi } from '@/ipc/agentChat';
import { chatSessionApi } from '@/ipc/chatSession';
import { workspaceApi } from '@/ipc/workspace';
import { agentSessionCacheManager } from '@/lib/chat/agentSessionCacheManager';
import { getSessionEntry } from '@/states/sessionIndex.atom';
import { DeleteConfirmAtom } from '@/components/overlay/DeleteOverlay';
import { RenameChatSessionAtom } from '@/components/overlay/RenameChatSessionOverlay';
import { toastAtom } from '@/components/ui/toast.atom';
import { log } from '@/log';

const logger = log.child({ mod: 'chatSessionCommands' });

export type ChatSessionCommand =
  | { type: 'delete'; sessionId: string }
  | { type: 'rename'; agentId: string; sessionId: string; title: string }
  | { type: 'toggleStar'; agentId: string; sessionId: string; starred: boolean }
  | { type: 'fork'; sessionId: string }
  | { type: 'download'; agentId: string; sessionId: string; title: string };

export const chatSessionCommands = mutate((use) => (cmd: ChatSessionCommand): void | Promise<void> => {
  switch (cmd.type) {
    case 'delete': {
      // 携带「是否当前会话」用于删除后的收尾（沿用 DeleteConfirmAtom.showChatSession 语义）。
      const currentSessionId = agentSessionCacheManager.getCurrentChatSessionId();
      const isCurrentSession = currentSessionId === cmd.sessionId;
      const currentAgentId = agentSessionCacheManager.getCurrentAgentId();
      const entry = getSessionEntry(currentAgentId, cmd.sessionId);
      const sessionTitle = entry?.title || 'Unnamed Session';
      use(DeleteConfirmAtom)[1].showChatSession(cmd.sessionId, sessionTitle, isCurrentSession);
      return;
    }

    case 'rename': {
      use(RenameChatSessionAtom)[1].show(cmd.agentId, cmd.sessionId, cmd.title);
      return;
    }

    case 'toggleStar':
      return toggleStar(use, cmd.agentId, cmd.sessionId, cmd.starred);

    case 'fork':
      return fork(use, cmd.sessionId);

    case 'download':
      return download(use, cmd.agentId, cmd.sessionId, cmd.title);
  }
});

async function toggleStar(use: UseAtom, agentId: string, sessionId: string, starred: boolean): Promise<void> {
  const toast = use(toastAtom)[1];
  try {
    const result = await persistApi.setSessionStarred(agentId, sessionId, starred);
    if (result?.success) {
      toast.showSuccess(starred ? 'Session starred' : 'Session unstarred');
    } else {
      toast.showError(result?.error || 'Failed to update chat session star state');
    }
  } catch {
    toast.showError('Failed to update chat session star state');
  }
}

async function fork(use: UseAtom, sessionId: string): Promise<void> { const agentId = agentSessionCacheManager.getCurrentAgentId();
const toast = use(toastAtom)[1];
if (!agentId) {
  toast.showError('No current agent chat available');
  return;
}
try {
  const result = await agentChatApi.forkChatSession(agentId, sessionId);
  if (!result.success) {
    toast.showError(`Failed to fork session: ${result.error}`);
    return;
  }
  if (result.chatSessionId) {
    router.navigate(`/agent/${agentId}/${result.chatSessionId}`, { replace: false });
  }
  logger.debug({
    msg: '✅ Fork ChatSession completed:',
    agentId,
    sourceChatSessionId: sessionId,
    newChatSessionId: result.chatSessionId,
  });
  toast.showSuccess('Session forked successfully, switched to new session');
} catch (error) {
  toast.showError(
    `Failed to fork session: ${error instanceof Error ? error.message : 'Unknown error'}`,
  );
} }

async function download(use: UseAtom, agentId: string, sessionId: string, title: string): Promise<void> { const toast = use(toastAtom)[1];
try {
  const result = await chatSessionApi.downloadChatSession(agentId, sessionId, title);
  if (result.success) {
    toast.showToast(`Chat session saved as "${result.fileName}"`, 'success', undefined, {
      persistent: true,
      actions: [
        {
          label: 'Open Folder',
          onClick: () => {
            workspaceApi.showInFolder(result.filePath);
          },
        },
      ],
    });
  } else {
    toast.showError(result.error || 'Failed to download chat session');
  }
} catch {
  toast.showError('Failed to download chat session');
} }
