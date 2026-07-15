import { app, ipcMain } from 'electron';
import { registerSchedulerIPC, schedulerManager } from '../../lib/scheduler';
import { log } from '@main/log';
import { getAppDataPath } from "@main/persist/lib/path";
import { listenInMain as listenHumanLoop } from '@shared/ipc/human-loop';

import type { Context } from './shared';

import handleAppIPC from './app';
import handlePiIPC from './pi';
import { registerPersistIpc, Profiles } from '../../persist';
import handleSubAgentIPC from './sub-agent';
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
import { RuntimeManager } from '../../lib/runtime/RuntimeManager';
import { registerRuntimeIpcHandlers } from '@main/lib/runtime/ipc';
import { createTerminalRuntimeBridge } from '@main/lib/runtime/terminalBridge';
import { setTerminalRuntimeBridge } from '@main/lib/terminal/runtimeBridge';

export function setUpIPC(ctx: Context) {
  // 日志通道必须最早注册：preload 一旦 ready，renderer 立刻会写 log，
  // handler 缺席会丢失 startup 阶段的所有 renderer 日志。
  registerLogIPC();
  registerLogViewerIPC();

  app.on('before-quit', ctx.onBeforeQuit);

  handleAppIPC(ctx);
  listenHumanLoop(ipcMain);
  handlePiIPC(ctx);
  registerPersistIpc(ipcMain);
  handleSubAgentIPC(ctx);
  handleMcpIPC(ctx);
  handleSkillIPC(ctx);
  handleAgentChatIPC(ctx);
  handleFsIPC(ctx);
  handleAttachmentIPC();
  handleInternalUrlsIPC();
  handleWorkspaceIPC(ctx);
  handleLlmIPC(ctx);
  handleWindowIPC(ctx);
  handleChatSessionIPC(ctx);
  handleResearchIPC();
  handleDoctorIPC(ctx);
  handleFeatureFlagsIPC();
  const runtimeManager = RuntimeManager.getInstance();
  // 反转 terminal → runtime 依赖：把 runtime 能力注入下层 terminal 桥。
  setTerminalRuntimeBridge(createTerminalRuntimeBridge(runtimeManager));
  registerRuntimeIpcHandlers(runtimeManager);

  setUpToolsIPC(ctx);
  handleUpdateIPC(ctx);

  // Scheduler IPC handlers are always registered. Profile bootstrap completes
  // before the scheduler starts so cron and one-shot tasks work for every profile.
  registerSchedulerIPC();

  // Scheduler startup is decoupled from sign-in: trigger after profile bootstrap;
  // cron and one-shot tasks also run for guest profiles.
  void (async () => {
    try {
      await Profiles.get().bootstrap();
      const profile = await Profiles.get().active();
      log.info({ msg: 'scheduler.lifecycle.startup.before-init', mod: 'ipc:setup', profileId: profile.id, schedulerState: schedulerManager.getRuntimeDiagnostics() });
      await schedulerManager.initialize(profile);
      log.info({ msg: 'scheduler.lifecycle.startup.after-init', mod: 'ipc:setup', profileId: profile.id, schedulerState: schedulerManager.getRuntimeDiagnostics() });
    } catch (err) {
      log.warn({ msg: '[Startup] SchedulerManager initialization failed', mod: 'ipc:setup', err });
    }
  })();
}
