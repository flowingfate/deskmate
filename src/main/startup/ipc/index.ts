import { app, ipcMain } from 'electron';
import { registerSchedulerIPC } from '../../lib/scheduler/SchedulerIPC';
import { schedulerManager } from '../../lib/scheduler/SchedulerManager';
import { log } from '@main/log';
import { safeConsole } from '../../lib/utilities/safeConsole';
import { isFeatureEnabled } from "../../lib/featureFlags";
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
import handleToolbarIPC from './toolbar';
import handleChatSessionIPC from './chat-session';
import { registerLogIPC } from './log';
import { registerLogViewerIPC } from '../../log/viewer-window';
import handleDoctorIPC from './doctor';
import handleFeatureFlagsIPC from './featureFlags';
import setUpToolsIPC from './tools';
import handleMainWindowIPC from './main-window';
import handleQuickStartImageCacheIPC from './quick-start-image-cache';
import handleUpdateIPC from './update';
import handleAttachmentIPC from './attachment';
import handleInternalUrlsIPC from './internal-urls';
import { RuntimeManager } from '../../lib/runtime/RuntimeManager';

export function setUpIPC(ctx: Context) {
  // 日志通道必须最早注册：preload 一旦 ready，renderer 立刻会写 log，
  // handler 缺席会丢失 startup 阶段的所有 renderer 日志。
  registerLogIPC();
  registerLogViewerIPC();

  // 🔥 Fix: add cleanup handling before app exit
  app.on('before-quit', (event) => {
    try {
      // Ensure SelectionHook is properly cleaned up before app exit
      ctx.cleanupSelectionHook();
    } catch (error) {
      // Ignore cleanup errors to avoid preventing app exit
      safeConsole.warn('[APP-EXIT] Error during SelectionHook cleanup:', error);
    }
  });

  app.on('will-quit', (event) => {
    try {
      // Last chance to clean up SelectionHook
      ctx.cleanupSelectionHook();
    } catch (error) {
      // Ignore cleanup errors, ensure app can exit normally
      safeConsole.warn('[APP-EXIT] Final cleanup error (ignored):', error);
    }
  });
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
  handleToolbarIPC(ctx);
  handleChatSessionIPC(ctx);
  handleDoctorIPC(ctx);
  handleFeatureFlagsIPC();
  // This will register runtime ipc hanles
  RuntimeManager.getInstance();

  setUpToolsIPC(ctx);
  handleMainWindowIPC(ctx);
  handleUpdateIPC(ctx);
  handleQuickStartImageCacheIPC();

  // Scheduler Management - IPC handlers are always registered;
  // UI visibility is controlled by feature flag on the renderer side.
  registerSchedulerIPC();

  // scheduler 启动与登录解耦：profile bootstrap 完成即触发，未登录态下 cron /
  // one-shot 任务也能跑。bootstrap 幂等，重复 await 安全。
  if (isFeatureEnabled('deskmateFeatureScheduler')) {
    void (async () => {
      try {
        await Profiles.get().bootstrap();
        const profile = await Profiles.get().active();
        log.info({ msg: 'scheduler.lifecycle.startup.before-init', mod: 'ipc:setup', profileId: profile.id, schedulerState: schedulerManager.getRuntimeDiagnostics() });
        await schedulerManager.initialize(profile.id);
        log.info({ msg: 'scheduler.lifecycle.startup.after-init', mod: 'ipc:setup', profileId: profile.id, schedulerState: schedulerManager.getRuntimeDiagnostics() });
      } catch (err) {
        log.warn({ msg: '[Startup] SchedulerManager initialization failed', mod: 'ipc:setup', err });
      }
    })();
  }

}
