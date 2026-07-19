import { app, Menu, protocol } from 'electron';
import { log, closeLogs } from '@main/log';
import { crashCaptureManager } from './lib/crash/CrashCaptureManager';
import { featureFlagManager } from './lib/featureFlags';

import { appCacheManager } from './lib/appCache';
import { ProfileRegistry } from './profileRegistry'
import { updater } from './lib/autoUpdate';
import { startEvalMode } from './startup/evalMode';
import { handleMediaProtocol } from './lib/media/mediaProtocol';

import { setUpAllIPCHandlers } from './startup/ipc';
import { setupMenu } from './startup/menu';
import { createMainWindow } from './startup/main-win';
import { IS_DEV, IS_EVAL } from './startup/context';
import { listenPowerEvents } from './startup/power';


const logger = log.child({ mod: 'main.ts' });

// 🔥 Must be called before app.ready - register custom privileged schemes.
// - screenshot: 截图功能字节直供
// - media: renderer <img>/<video> 直供 session sandbox / knowledge 字节(见 lib/media/mediaProtocol.ts)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'screenshot',
    privileges: {
      secure: true,
      standard: true,
      bypassCSP: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    }
  },
  {
    scheme: 'media',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    }
  },
]);


function bootstrap() {
  async function bootstrapProfiles(): Promise<void> {
    const registry = ProfileRegistry;
    const { warnings } = await registry.bootstrap();
    for (const warning of warnings) {
      logger.warn({ msg: 'Profile runtime bootstrap warning', warning });
    }
    logger.info({
      msg: 'scheduler.lifecycle.startup.complete',
      schedulerStates: registry.getSchedulerDiagnostics(),
    });
  }

  async function showAndFocusMainWindow(): Promise<void> {
    crashCaptureManager.recordBreadcrumb('lifecycle', 'app-activate');
    let window = ProfileRegistry.require(ProfileRegistry.defaultProfileId).getMainWindow();
    if (!window) window = await createMainWindow();
    if (!window.isVisible()) {
      window.show();
    } else if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  }

  console.time('[Startup] ElectronApp bootstrap');
  const profileBootstrap = bootstrapProfiles();

  // Ensure environment variables are fully passed through
  process.env.PATH = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';

  // Add additional paths if needed
  if (process.platform === 'darwin') {
    const additionalPaths = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/opt/homebrew/sbin',
      '/usr/local/sbin',
      '/usr/sbin',
      '/sbin'
    ];
    process.env.PATH = additionalPaths.join(':') + ':' + (process.env.PATH || '');
  }

  // Respect NODE_ENV from environment, fallback to --dev flag for backwards compatibility
  crashCaptureManager.initialize({ isDev: IS_DEV });
  crashCaptureManager.recordBreadcrumb('lifecycle', 'electron-app-constructor', { isDev: IS_DEV });

  // 🚀 Initialize Feature Flag manager before any feature-gated setup runs.
  try {
    featureFlagManager.initialize();
  } catch (error) {
    console.warn('[Startup] FeatureFlagManager initialization failed:', error);
  }

  app.on('ready', async () => {
    console.time('[Startup] onReady');
    try {
      // ── Eval mode: headless HTTP harness ──
      // Check first, before any GUI-only initialization (crash recovery,
      // power monitor, scheduler logging) to avoid unnecessary work and
      // ensure eval mode has its own clean error path.
      if (IS_EVAL) {
        await startEvalMode();
        return; // Skip all UI initialization
      }

      // media:// 字节直供 protocol —— MUST 在 app ready 后注册(protocol.handle 前置条件)。
      handleMediaProtocol();
      listenPowerEvents();

      crashCaptureManager.recordBreadcrumb('lifecycle', 'app-ready');
      const crashStatus = crashCaptureManager.getStatus();
      logger.info({ msg: 'scheduler.lifecycle.startup-recovery-context', mod: 'main:onReady', previousSessionId: crashStatus.recoveredCrash?.previousSessionId ?? null, currentSessionId: crashStatus.currentSessionId, recoveredCrashDetected: crashStatus.hasRecoveredCrash, alias: ProfileRegistry.defaultProfileId || null });
      appCacheManager.initialize().catch((e) => {
        console.warn('[Startup] AppCacheManager pre-warm failed:', e);
      });

      // preload 的同步 owner handshake 只能读取已完成 bootstrap 的窗口 metadata。
      await profileBootstrap;

      // Wait for initial main-window creation before installing app-level UI.
      console.time('[Startup] createMainWindow');
      await createMainWindow();
      console.timeEnd('[Startup] createMainWindow');

      // Register menu and shortcuts (catch errors to prevent blocking subsequent flow)
      try {
        if (process.platform !== 'win32') {
          setupMenu();
        } else {
          Menu.setApplicationMenu(null);
        }
      } catch (e) {
        console.error('[Startup] Menu/Shortcuts initialization failed:', e);
        logger.error({ msg: '[Startup] Menu/Shortcuts initialization failed', mod: 'main', err: e });
      }

      // 🚀 Optimization: deferred update manager initialization, non-blocking startup
      setImmediate(updater.setup);
      console.timeEnd('[Startup] onReady');
    } catch (error) {
      console.timeEnd('[Startup] onReady');
      console.error('[Startup] Critical error in onReady:', error);
      logger.error({ msg: '[Startup] Critical error in onReady', mod: 'main', err: error });
    }
  });

  app.on('window-all-closed', () => {
    console.log('[APP-EXIT] All windows closed');
    if (process.platform !== 'darwin') app.quit();
    // On macOS, do not call app.quit(), keep app running in Dock
  });

  app.on('activate', showAndFocusMainWindow);
  app.on('second-instance', () => {
    // Focus recovery is intentionally lightweight: if a future regression or
    // an OS-level reopen launches a second process, users should be brought
    // back to the existing window instead of losing context.
    console.log('[Startup] Second instance detected, focusing existing window');
    const focusExistingWindow = () => showAndFocusMainWindow().catch((error) => {
      console.warn('[Startup] Failed to focus existing window for second instance:', error);
    });
    if (app.isReady()) focusExistingWindow();
    else app.once('ready', focusExistingWindow);
  });

  app.on('before-quit', () => {
    logger.info({ msg: 'scheduler.lifecycle.before-quit', schedulerStates: ProfileRegistry.getSchedulerDiagnostics(), appUptimeSeconds: Math.round(process.uptime()) });
  });

  app.on('will-quit', () => {
    logger.info({ msg: 'scheduler.lifecycle.will-quit', schedulerStates: ProfileRegistry.getSchedulerDiagnostics(), appUptimeSeconds: Math.round(process.uptime()) });
  });

  app.on('before-quit', async (event: Electron.Event) => {
    const exitStart = Date.now();
    const exitId = `exit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    event.preventDefault();

    function raceWithTimeout(task: Promise<void>, timeoutMs: number) {
      const { resolve, promise } = Promise.withResolvers<void>();
      setTimeout(resolve, timeoutMs);
      return Promise.race([task, promise]);
    }

    try {
      console.log('App before quit event triggered');
      crashCaptureManager.recordBreadcrumb('lifecycle', 'before-quit');

      // Add final exit log before cleanup
      logger.info({ msg: `[${exitId}] Application exiting - starting cleanup sequence...` });
      console.log('Added final exit log');

      console.log('Cleaning up UpdateManager');
      updater.stop();

      // Phase 3.5: Flush persist (pending messages.jsonl) + close SQLite connections.
      // 必须在 Phase 4 (log close) 前面：persist 路径仍要写日志；放在 logger 关闭后 emit 会丢。
      // 内部已 Promise.allSettled，单个 Profile 失败不阻塞退出；外层再裹 5s 超时兜底。
      console.log('Phase 3.5: Flushing persist + closing SQLite');
      try {
        await raceWithTimeout(ProfileRegistry.shutdownAll(), 5000);
        console.log('Persist shutdown completed');
      } catch (persistError) {
        console.warn('Persist shutdown failed:', persistError);
      }

      // closeLogs 真正等 worker 把缓冲落到 sqlite（logger.flush 只 fsync 到 worker pipe）。
      // 内部已带 5s 超时；外层再裹 10s 兜底，避免极端情况下卡住退出。
      console.log('Starting logger close...');
      await raceWithTimeout(closeLogs(5000), 10000);
      console.log('Logger close completed, proceeding with quit');

      const exitDuration = Date.now() - exitStart;
      console.log(`Cleanup sequence completed in ${exitDuration}ms, now exiting`);
      crashCaptureManager.markCleanExit(0);

      // Now allow the app to quit
      app.exit(0);
    } catch (error) {
      const exitDuration = Date.now() - exitStart;
      console.error(`Error during app exit (${exitDuration}ms):`, error);
      console.log('Force quitting due to cleanup errors');
      crashCaptureManager.markCleanExit(1);
      app.exit(1);
    }
  });

  setUpAllIPCHandlers();

  logger.info({ msg: 'ElectronApp initialized', isDev: IS_DEV });
  logger.debug({ msg: 'PATH environment variable', path: process.env.PATH });
  console.timeEnd('[Startup] ElectronApp bootstrap');
}

// Create and start the application
// 仅用于副作用：实例化即启动；无人 import 这个变量，所以不导出。
// 不能 export default — main 是 electron entry，被 bootstrap 用 require() 加载，
// 任何 export 会污染整个 bundle（rolldown 会把所有 reachable 的命名 export 都冒泡上来）。
if (IS_EVAL || app.requestSingleInstanceLock()) {
  bootstrap();
} else {
  console.warn('[Startup] Another instance is already running, quitting this process');
  app.quit();
}
