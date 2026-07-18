import { ipcMain } from 'electron';
import { registerSchedulerIPC } from '../../lib/scheduler';
import { listenInMain as listenHumanLoop } from '@shared/ipc/human-loop';

import handleAppIPC from './app';
import handlePiIPC from './pi';
import { registerPersistIpc } from '../../persist';
import handleMcpIPC from './mcp';
import handleSkillIPC from './skill';
import handleAgentChatIPC from './agent-chat';
import handleFsIPC from './fs';
import handleWorkspaceIPC from './workspace';
import handleLlmIPC from './llm';
import handleWindowIPC from './window';
import handleChatSessionIPC from './chat-session';
import { registerLogIPC } from './log';
import { registerLogViewerIPC } from '../../log/viewer-window';
import handleDoctorIPC from './doctor';
import handleFeatureFlagsIPC from './featureFlags';
import setUpToolsIPC from './tools';
import handleUpdateIPC from './update';
import handleAttachmentIPC from './attachment';
import handleInternalUrlsIPC from './internal-urls';
import handleResearchIPC from './research';
import { registerSubagentRunIpc } from './subagent-run';
import { RuntimeManager } from '../../lib/runtime/RuntimeManager';
import { registerRuntimeIpcHandlers } from '@main/lib/runtime/ipc';
import { createTerminalRuntimeBridge } from '@main/lib/runtime/terminalBridge';
import { setTerminalRuntimeBridge } from '@main/lib/terminal/runtimeBridge';

export function setUpAllIPCHandlers() {
  // 日志通道必须最早注册：preload 一旦 ready，renderer 立刻会写 log，
  // handler 缺席会丢失 startup 阶段的所有 renderer 日志。
  registerLogIPC();
  registerLogViewerIPC();


  handleAppIPC();
  listenHumanLoop(ipcMain);
  handlePiIPC();
  registerPersistIpc(ipcMain);
  handleMcpIPC();
  handleSkillIPC();
  handleAgentChatIPC();
  handleFsIPC();
  handleAttachmentIPC();
  handleInternalUrlsIPC();
  handleWorkspaceIPC();
  handleLlmIPC();
  handleWindowIPC();
  handleChatSessionIPC();
  handleResearchIPC();
  handleDoctorIPC();
  handleFeatureFlagsIPC();
  registerSubagentRunIpc(ipcMain);
  const runtimeManager = RuntimeManager.getInstance();
  // 反转 terminal → runtime 依赖：把 runtime 能力注入下层 terminal 桥。
  setTerminalRuntimeBridge(createTerminalRuntimeBridge(runtimeManager));
  registerRuntimeIpcHandlers(runtimeManager);

  setUpToolsIPC();
  handleUpdateIPC();

  // Scheduler IPC handlers are always registered. ProfileRegistry.bootstrap()
  // starts each Profile scheduler after the handler surface is available.
  registerSchedulerIPC();
}
