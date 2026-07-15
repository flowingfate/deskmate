import { app, BrowserWindow, Menu, shell, protocol, powerMonitor } from 'electron';
import { createWindow } from './startup/wins';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import JSZip from 'jszip';
import { mainToRender as navigateMainToRender } from '@shared/ipc/navigate';


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

import { UpdateManager } from './lib/autoUpdate/updateManager';

const DEV_SERVER_PORT = process.env.DEV_SERVER_PORT || '39017';
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'] || `http://localhost:${DEV_SERVER_PORT}`;

// Lightweight utility modules (no side effects, can keep static imports)
import { log, flushLogs, closeLogs } from '@main/log';
import { openLogViewerWindow } from '@main/log/viewer-window';
import { crashCaptureManager } from './lib/crash/CrashCaptureManager';
import { safeConsole, exitSafeLog } from './lib/utilities/safeConsole';
import { getDebugInfoEntries } from './lib/utilities/debugInfoEntries';
import { buildDebugInfoManifest } from './lib/utilities/debugInfoManifest';
import { createRedactor, isTextFile, redactFileContent } from './lib/utilities/redact';
import { featureFlagManager } from './lib/featureFlags';
import { PRELOAD_PATH } from './lib/buildPaths';

import { appCacheManager } from './lib/appCache';
import { restoreBounds, trackBounds } from './startup/windowState';
import { Profiles } from './persist/profiles';
import { setUpIPC } from './startup/ipc';
import { startEvalMode } from './startup/evalMode';
import { schedulerManager } from './lib/scheduler';
import { mcpClientManager } from "./lib/mcpRuntime"
import { registerMediaProtocol } from './lib/media/mediaProtocol';
import { getAppDataPath, getLogsDir, getProfileDirectoryPath } from "@main/persist/lib/path";

import { mainToRender as appMainToRender } from '@shared/ipc/app';
import { mainToRender as windowMainToRender } from '@shared/ipc/window';
import { APP_NAME, APP_VERSION } from '@shared/constants/branding';


console.timeEnd('[Startup] Module imports');

// 🚀 Optimization: async env loading, non-blocking startup
// Only load .env.local in development, use setImmediate to avoid blocking main thread
if (process.env.NODE_ENV === 'development') {
  setImmediate(async () => {
    const possibleEnvPaths = [
      path.join(__dirname, '../../.env.local'),
      path.join(process.cwd(), '.env.local'),
    ];

    for (const envPath of possibleEnvPaths) {
      try {
        await fs.promises.access(envPath, fs.constants.F_OK);
        process.loadEnvFile(envPath);
        safeConsole.log('[Startup] ✅ Loaded .env.local from:', envPath);
        break;
      } catch {}
    }
  });
}

const isEvalMode = process.argv.includes('--eval-mode');

const hasSingleInstanceLock = isEvalMode
  ? true  // Skip single-instance lock in eval mode — allow running alongside GUI
  : app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  // March 2026 regression note: a Playwright install path once tried to spawn
  // `process.execPath`, which is the packaged Electron app rather than a Node
  // runtime. Keeping a single-instance lock here ensures that similar process-
  // launch mistakes degrade into "focus existing window" instead of running
  // two full app instances side by side.
  safeConsole.warn('[Startup] Another instance is already running, quitting this process');
  app.quit();
}

class ElectronApp {
  private mainWindow: BrowserWindow | null = null;
  private isDev: boolean = false;
  private updateManager: UpdateManager | null = null;

  // 🚀 State tracking: app component initialization status
  private isAgentChatReady: boolean = false;
  private powerMonitorLoggingRegistered: boolean = false;
  private lastSuspendAt: number | null = null;

  private logSchedulerLifecycleState(event: string, extra?: Record<string, unknown>): void {

    Promise.resolve()
      .then(() => {
        log.info({ msg: `scheduler.lifecycle.${event}`, mod: 'main:schedulerLifecycle', schedulerState: schedulerManager.getRuntimeDiagnostics(), ...extra });
      })
      .catch((error) => {
        log.warn({ msg: `scheduler.lifecycle.${event}.failed`, mod: 'main:schedulerLifecycle', err: error, ...extra });
      });
  }

  constructor() {
    safeConsole.time('[Startup] ElectronApp constructor');

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
    this.isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
    crashCaptureManager.initialize({ isDev: this.isDev });
    crashCaptureManager.recordBreadcrumb('lifecycle', 'electron-app-constructor', {
      isDev: this.isDev,
    });

    // 🚀 Initialize Feature Flag manager before any feature-gated setup runs.
    try {
      featureFlagManager.initialize();
    } catch (error) {
      safeConsole.warn('[Startup] FeatureFlagManager initialization failed:', error);
    }

    this.setupEventHandlers();

    // 🚀 Optimization: deferred log initialization, non-blocking constructor
    setImmediate(() => {
      const logger = log;
      logger.info({ msg: 'ElectronApp initialized', mod: 'main', isDev: this.isDev });
      logger.debug({ msg: 'PATH environment variable', mod: 'main', path: process.env.PATH });
    });

    safeConsole.timeEnd('[Startup] ElectronApp constructor');
  }

  private setupEventHandlers(): void {
    // App event handlers
    app.on('ready', this.onReady.bind(this));
    app.on('window-all-closed', this.onWindowAllClosed.bind(this));
    app.on('activate', this.onActivate.bind(this));
    app.on('second-instance', () => {
      // Focus recovery is intentionally lightweight: if a future regression or
      // an OS-level reopen launches a second process, users should be brought
      // back to the existing window instead of losing context.
      safeConsole.log('[Startup] Second instance detected, focusing existing window');
      const focusExistingWindow = async () => {
        try {
          await this.onActivate();
        } catch (error) {
          safeConsole.warn('[Startup] Failed to focus existing window for second instance:', error);
        }
      };

      if (app.isReady()) {
        void focusExistingWindow();
      } else {
        app.once('ready', () => {
          void focusExistingWindow();
        });
      }
    });

    // 🔥 Fix: add cleanup handling before app exit
    app.on('before-quit', (event) => {
      try {
        this.logSchedulerLifecycleState('before-quit', {
          appUptimeSeconds: Math.round(process.uptime()),
        });
      } catch (error) {
        // Ignore logging errors to avoid preventing app exit
        safeConsole.warn('[APP-EXIT] before-quit lifecycle log error (ignored):', error);
      }
    });

    app.on('will-quit', (event) => {
      try {
        this.logSchedulerLifecycleState('will-quit', {
          appUptimeSeconds: Math.round(process.uptime()),
        });
      } catch (error) {
        // Ignore cleanup errors, ensure app can exit normally
        safeConsole.warn('[APP-EXIT] Final cleanup error (ignored):', error);
      }
    });
    app.on('before-quit', this.onBeforeQuit.bind(this));

    const host = this;
    class Injection {
      get isDev() { return host.isDev; }
      get isAgentChatReady() { return host.isAgentChatReady; }

      get updateManager() {
        if (host.updateManager) {
          return Promise.resolve(host.updateManager);
        }
        const manager = new UpdateManager();
        manager.startPeriodicCheck(360); // Check every 6 hours
        host.updateManager = manager;
        return Promise.resolve(manager);
      }

      onBeforeQuit = host.onBeforeQuit.bind(host);
      getPersistedWindowZoomLevel = host.getPersistedWindowZoomLevel.bind(host);
      applyWindowZoomLevel = host.applyWindowZoomLevel.bind(host);
      stepWindowZoomLevel = host.stepWindowZoomLevel.bind(host);
      resetWindowZoomLevel = host.resetWindowZoomLevel.bind(host);
      getMenuTemplate = host.getMenuTemplate.bind(host);
    }
    setUpIPC(new Injection());
  }



  /**
   * Check if app is fully ready, if so, notify renderer process
   */
  private checkAppReadiness() {
    if (this.isAgentChatReady) {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        safeConsole.log('[Startup] App fully ready (AgentChat), notifying renderer');
        appMainToRender.bindWebContents(this.mainWindow.webContents).ready(true);
      }
    }
  }

  private registerPowerMonitorLogging(): void {
    if (this.powerMonitorLoggingRegistered) {
      return;
    }

    this.powerMonitorLoggingRegistered = true;

    const logger = log;
    const logPowerEvent = (event: string, data?: Record<string, unknown>) => {
      logger.info({ msg: `[PowerMonitor] ${event}`, mod: 'main:powerMonitor', platform: process.platform, arch: process.arch, pid: process.pid, ...data });
    };

    powerMonitor.on('suspend', () => {
      this.lastSuspendAt = Date.now();
      this.logSchedulerLifecycleState('power-suspend', {
        suspendedAt: new Date(this.lastSuspendAt).toISOString(),
      });
      logPowerEvent('System suspend detected', {
        appUptimeSeconds: Math.round(process.uptime()),
      });

      if (process.platform === 'win32') {
        logger.warn({ msg: '[PowerMonitor] Windows suspend detected. Node/Electron timers and in-flight IPC may pause until resume; if startup is waiting on an unresolved promise, UI can appear stuck after wake.', mod: 'main:powerMonitor', arch: process.arch, appUptimeSeconds: Math.round(process.uptime()) });
      }
    });

    powerMonitor.on('resume', () => {
      const resumedAt = Date.now();
      const suspendedForMs = this.lastSuspendAt ? resumedAt - this.lastSuspendAt : undefined;
      const suspendedAt = this.lastSuspendAt;
      this.lastSuspendAt = null;

      this.logSchedulerLifecycleState('power-resume', {
        suspendedAt: suspendedAt ? new Date(suspendedAt).toISOString() : undefined,
        resumedAt: new Date(resumedAt).toISOString(),
        suspendedForMs,
      });

      logPowerEvent('System resume detected', {
        suspendedForMs,
        suspendedForSeconds: suspendedForMs !== undefined ? Math.round(suspendedForMs / 1000) : undefined,
        appUptimeSeconds: Math.round(process.uptime()),
      });

      if (process.platform === 'win32') {
        logger.warn({ msg: '[PowerMonitor] Windows resume detected. If startup or profile initialization was pending before suspend, review the preceding 1-2 minutes of logs for unresolved IPC/fetch operations and consider power policy / connected-standby interference.', mod: 'main:powerMonitor', arch: process.arch, suspendedForMs });
      }

      if (suspendedAt && suspendedForMs && suspendedForMs > 0) {
        Promise.resolve()
          .then(() => schedulerManager.handleSystemResume(suspendedAt, resumedAt))
          .catch((schedulerError) => {
            logger.warn({ msg: '[PowerMonitor] Scheduler resume catch-up failed', mod: 'main:powerMonitor', suspendedForMs, err: schedulerError });
          });
      }
    });

    powerMonitor.on('on-battery', () => {
      logPowerEvent('Power source changed: battery');
    });

    powerMonitor.on('on-ac', () => {
      logPowerEvent('Power source changed: AC');
    });

    powerMonitor.on('lock-screen', () => {
      this.logSchedulerLifecycleState('power-lock-screen');
      logPowerEvent('Screen locked');
    });

    powerMonitor.on('unlock-screen', () => {
      this.logSchedulerLifecycleState('power-unlock-screen');
      logPowerEvent('Screen unlocked');
    });

    logPowerEvent('Power monitor diagnostics registered');
  }

  private async onReady(): Promise<void> {
    safeConsole.time('[Startup] onReady');
    try {
      // ── Eval mode: headless HTTP harness ──
      // Check first, before any GUI-only initialization (crash recovery,
      // power monitor, scheduler logging) to avoid unnecessary work and
      // ensure eval mode has its own clean error path.
      if (isEvalMode) {
        await startEvalMode();
        return; // Skip all UI initialization
      }

      crashCaptureManager.recordBreadcrumb('lifecycle', 'app-ready');

      // media:// 字节直供 protocol —— MUST 在 app ready 后注册(protocol.handle 前置条件)。
      registerMediaProtocol();

      const crashStatus = crashCaptureManager.getStatus();
      log.info({ msg: 'scheduler.lifecycle.startup-recovery-context', mod: 'main:onReady', previousSessionId: crashStatus.recoveredCrash?.previousSessionId ?? null, currentSessionId: crashStatus.currentSessionId, recoveredCrashDetected: crashStatus.hasRecoveredCrash, alias: Profiles.get().activeProfileId || null });
      this.registerPowerMonitorLogging();

      // 🚀 Highest priority: warm up AppCacheManager (read app.json / migrate runtimeConfig.json)
      // Fire-and-forget, fully parallel with all subsequent tasks, ensure earlier than profile.json initialization
      appCacheManager.initialize().catch((e) => {
        safeConsole.warn('[Startup] AppCacheManager pre-warm failed:', e);
      });

      safeConsole.time('[Startup] createMainWindow');
      // 🚀 Optimization: start window creation task immediately
      const windowCreationTask = this.createMainWindow();

      // Wait for window creation to complete (subsequent logic depends on this.mainWindow)
      await windowCreationTask;
      safeConsole.timeEnd('[Startup] createMainWindow');

      // Register menu and shortcuts (catch errors to prevent blocking subsequent flow)
      try {
        if (process.platform !== 'win32') {
          this.setupMenu();
        } else {
          Menu.setApplicationMenu(null);
        }

      } catch (e) {
        safeConsole.error('[Startup] Menu/Shortcuts initialization failed:', e);
        log.error({ msg: '[Startup] Menu/Shortcuts initialization failed', mod: 'main', err: e });
      }

      // 🚀 Optimization: deferred update manager initialization, non-blocking startup
      setImmediate(() => {
        try {
          if (this.mainWindow) {
            this.updateManager = new UpdateManager();
            // Always enable periodic check
            this.updateManager.startPeriodicCheck(360); // Check every 6 hours
            safeConsole.log('[Startup] UpdateManager periodic check started', { intervalMinutes: 360 });
            log.info({ msg: '[Startup] UpdateManager periodic check started', mod: 'main', intervalMinutes: 360 });
          } else {
            safeConsole.warn('[Startup] mainWindow not available for UpdateManager initialization');
          }
        } catch (e) {
          safeConsole.error('[Startup] UpdateManager initialization failed:', e);
        }
      });

      safeConsole.timeEnd('[Startup] onReady');
    } catch (error) {
      safeConsole.timeEnd('[Startup] onReady');
      safeConsole.error('[Startup] Critical error in onReady:', error);
      log.error({ msg: '[Startup] Critical error in onReady', mod: 'main', err: error });
    }
  }

  private onWindowAllClosed(): void {
    safeConsole.log('[APP-EXIT] All windows closed');

    // macOS standard behavior: close window but do not quit app
    if (process.platform !== 'darwin') {
      // On non-macOS systems, quit app when all windows are closed
      app.quit();
    }
    // On macOS, do not call app.quit(), keep app running in Dock
  }

  private async onActivate(): Promise<void> {
    crashCaptureManager.recordBreadcrumb('lifecycle', 'app-activate');
    // macOS standard behavior: reopen window when Dock icon is clicked
    if (this.mainWindow === null || this.mainWindow.isDestroyed()) {
      // Main window destroyed, recreate
      await this.createMainWindow();
    } else if (!this.mainWindow.isVisible()) {
      // Main window exists but hidden, show and focus
      this.mainWindow.show();
      this.mainWindow.focus();
    } else if (this.mainWindow.isMinimized()) {
      // Main window minimized, restore and focus
      this.mainWindow.restore();
      this.mainWindow.focus();
    } else {
      // Main window visible, focus only
      this.mainWindow.focus();
    }
  }

  private async onBeforeQuit(event: Electron.Event): Promise<void> {
    exitSafeLog('App before quit event triggered');
    crashCaptureManager.recordBreadcrumb('lifecycle', 'before-quit');

    // Prevent immediate quit to allow cleanup
    event.preventDefault();

    const exitStart = Date.now();
    const exitId = `exit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    try {
      // Add final exit log before cleanup
      log.info({ msg: `[${exitId}] Application exiting - starting cleanup sequence...` });
      exitSafeLog('Added final exit log');

      // Phase 0.5: stop all scheduled tasks
      exitSafeLog('Phase 0.5: Stopping scheduled cron tasks');
      try {
        log.info({ msg: 'scheduler.lifecycle.shutdown-sequence', mod: 'main:onBeforeQuit', stage: 'before-dispose', reason: 'app-quit', schedulerState: schedulerManager.getRuntimeDiagnostics() });
        await schedulerManager.dispose('app-quit');
        log.info({ msg: 'scheduler.lifecycle.shutdown-sequence', mod: 'main:onBeforeQuit', stage: 'after-dispose', reason: 'app-quit', schedulerState: schedulerManager.getRuntimeDiagnostics() });
        exitSafeLog('SchedulerManager disposed successfully');
      } catch (schedulerError) {
        log.warn({ msg: 'scheduler.lifecycle.shutdown-sequence', mod: 'main:onBeforeQuit', stage: 'dispose-failed', reason: 'app-quit', err: schedulerError });
      }

      // Phase 1: Clean up MCP clients and child processes
      exitSafeLog('Phase 2: Cleaning up MCP clients and child processes');
      try {

        // Set timeout for MCP cleanup to prevent hanging
        await Promise.race([
          mcpClientManager.cleanup(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('MCP cleanup timeout')), 20000) // 20 second timeout
          )
        ]);

        exitSafeLog('MCP cleanup completed successfully');
      } catch (mcpError) {
        const errorMessage = mcpError instanceof Error ? mcpError.message : String(mcpError);
        safeConsole.warn(`MCP cleanup failed or timed out: ${errorMessage}`);

        // If MCP cleanup timed out, try force cleanup
        if (errorMessage.includes('timeout')) {
          exitSafeLog('Attempting force cleanup of remaining child processes');
          await this.forceCleanupChildProcesses(exitId);
        }
      }

      // Phase 3: Clean up update manager
      exitSafeLog('Phase 3: Cleaning up UpdateManager');
      if (this.updateManager) {
        this.updateManager.destroy();
        exitSafeLog('UpdateManager destroyed');
      }


      // Phase 3.5: Flush persist (pending messages.jsonl) + close SQLite connections.
      // 必须在 Phase 4 (log close) 前面：persist 路径仍要写日志；放在 logger 关闭后 emit 会丢。
      // 内部已 Promise.allSettled，单个 Profile 失败不阻塞退出；外层再裹 5s 超时兜底。
      exitSafeLog('Phase 3.5: Flushing persist + closing SQLite');
      try {
        await Promise.race([
          Profiles.get().shutdown(),
          new Promise<void>((resolve) =>
            setTimeout(() => {
              exitSafeLog('Persist shutdown timeout (5s)');
              resolve();
            }, 5000),
          ),
        ]);
        exitSafeLog('Persist shutdown completed');
      } catch (persistError) {
        safeConsole.warn('Persist shutdown failed:', persistError);
      }

      // Phase 4: Handle logger exit to flush all logs
      exitSafeLog('Phase 4: Flushing logs');
      exitSafeLog('Starting logger close...');
      // closeLogs 真正等 worker 把缓冲落到 sqlite（log.flush 只 fsync 到 worker pipe）。
      // 内部已带 5s 超时；外层再裹 10s 兜底，避免极端情况下卡住退出。
      await Promise.race([
        closeLogs(5000),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            exitSafeLog('Logger close outer timeout (10s)');
            resolve();
          }, 10000),
        ),
      ]);
      exitSafeLog('Logger close completed, proceeding with quit');

      // Phase 4: Final cleanup summary
      const exitDuration = Date.now() - exitStart;
      exitSafeLog(`Cleanup sequence completed in ${exitDuration}ms, now exiting`);
      crashCaptureManager.markCleanExit(0);

      // Now allow the app to quit
      app.exit(0);
    } catch (error) {
      const exitDuration = Date.now() - exitStart;
      safeConsole.error(`Error during app exit (${exitDuration}ms):`, error);

      // Force quit even if cleanup fails
      exitSafeLog('Force quitting due to cleanup errors');
      crashCaptureManager.markCleanExit(1);
      app.exit(1);
    }
  }

  /**
   * Force cleanup of remaining child processes when normal cleanup fails
   */
  private async forceCleanupChildProcesses(exitId: string): Promise<void> {
    try {
      exitSafeLog(`[${exitId}] Starting force cleanup of child processes`);

      // Only attempt this on macOS/Linux where we have better process management
      if (process.platform !== 'win32') {
        const appPid = process.pid;

        try {
          // Find and terminate any remaining child processes
          const psCommand = `ps -eo pid,ppid,comm | grep -E "(npm|uvx|python|pip|uv|node)" | grep -v grep`;
          const psResult = execSync(psCommand, { encoding: 'utf8', timeout: 5000 });

          if (psResult.trim()) {
            exitSafeLog(`[${exitId}] Found remaining processes:`, psResult);

            const lines = psResult.trim().split('\n');
            for (const line of lines) {
              const [pid, ppid, comm] = line.trim().split(/\s+/);

              // Kill direct children of our app
              if (ppid && parseInt(ppid) === appPid) {
                try {
                  process.kill(parseInt(pid), 'SIGKILL');
                  exitSafeLog(`[${exitId}] Force killed child process: ${comm} (PID: ${pid})`);
                } catch (killError) {
                  safeConsole.warn(`[${exitId}] Failed to kill process ${pid}:`, killError);
                }
              }
            }
          } else {
            exitSafeLog(`[${exitId}] No remaining child processes found`);
          }
        } catch (psError) {
          safeConsole.warn(`[${exitId}] Process search failed:`, psError);
        }
      } else {
        exitSafeLog(`[${exitId}] Force cleanup not implemented for Windows`);
      }
    } catch (error) {
      safeConsole.error(`[${exitId}] Force cleanup failed:`, error);
    }
  }

  private async createMainWindow(): Promise<void> {

    // Create the browser window
    this.mainWindow = createWindow({
      width: 1200,
      height: 800,
      // 展开上次记忆的几何（位置 + 尺寸）；无记忆或窗口已离屏时回退上面的默认值。
      ...restoreBounds(),
      minWidth: 1008,
      minHeight: 702,
      show: false, // Start hidden and show when ready
      titleBarStyle: process.platform === 'win32' ? 'hidden' : process.platform === 'darwin' ? 'hiddenInset' : 'default',
      trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined,
      titleBarOverlay: undefined,
      // frame: defaults to true, no need to set explicitly
      icon: app.isPackaged
        ? path.join(process.resourcesPath, 'brand-assets/win/app.ico')
        : path.join(__dirname, '../../brands/deskmate/assets/win/app.ico'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: PRELOAD_PATH.main,
        webSecurity: false,
        allowRunningInsecureContent: true,
        experimentalFeatures: false,
        sandbox: false,
        enableBlinkFeatures: '',
        disableBlinkFeatures: '',
        // Add sandbox-related security configuration
        spellcheck: false,
        webgl: false,
        plugins: false,
      },
    }, { role: 'main' });
    crashCaptureManager.attachToMainWindow(this.mainWindow);
    crashCaptureManager.recordBreadcrumb('window', 'main-window-created', {
      windowId: this.mainWindow.id,
    });

    // 挂载窗口几何记忆：move / resize 后防抖保存，下次启动恢复到同一屏幕与位置。
    trackBounds(this.mainWindow);

    // Native right-click context menu for editable fields (Cut/Copy/Paste/Select All)
    this.mainWindow.webContents.on('context-menu', (_event, params) => {
      const { isEditable, selectionText, editFlags } = params;
      // Only show native context menu for editable areas (input, textarea, contenteditable)
      // or when text is selected (for copy)
      if (!isEditable && !selectionText) return;

      const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

      if (isEditable) {
        menuTemplate.push(
          { label: 'Cut', role: 'cut', enabled: editFlags.canCut },
        );
      }
      if (selectionText || isEditable) {
        menuTemplate.push(
          { label: 'Copy', role: 'copy', enabled: editFlags.canCopy },
        );
      }
      if (isEditable) {
        menuTemplate.push(
          { label: 'Paste', role: 'paste', enabled: editFlags.canPaste },
          { type: 'separator' },
          { label: 'Select All', role: 'selectAll', enabled: editFlags.canSelectAll },
        );
      }

      if (menuTemplate.length > 0) {
        const contextMenu = Menu.buildFromTemplate(menuTemplate);
        contextMenu.popup({ window: this.mainWindow || undefined });
      }
    });

    const applyPersistedZoomLevel = async () => {
      try {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
          return;
        }

        const zoomLevel = await this.getPersistedWindowZoomLevel();
        this.applyWindowZoomLevel(zoomLevel);
      } catch (e) {
        safeConsole.error('[Zoom] Failed to restore zoom level:', e);
      }
    };

    const ensurePersistedZoomLevel = async () => {
      try {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
          return;
        }

        const persistedZoomLevel = await this.getPersistedWindowZoomLevel();
        const actualZoomLevel = this.mainWindow.webContents.getZoomLevel();
        if (actualZoomLevel !== persistedZoomLevel) {
          this.applyWindowZoomLevel(persistedZoomLevel);
        }
      } catch (e) {
        safeConsole.error('[Zoom] Failed to ensure zoom level:', e);
      }
    };

    const persistMainWindowMaximized = async (maximized: boolean) => {
      try {
        await appCacheManager.initialize();
        await appCacheManager.updateConfig({ mainWindowMaximized: maximized });
      } catch (e) {
        safeConsole.error('[WindowState] Failed to persist maximized state:', e);
      }
    };

    const reapplyPersistedZoomLevelAfterWindowStateChange = (state: 'maximized' | 'normal') => {
      if (this.mainWindow) {
        windowMainToRender.bindWebContents(this.mainWindow.webContents).stateChanged(state);
      }

      setTimeout(() => {
        void applyPersistedZoomLevel();
      }, 0);
    };

    // Listen for window state changes
    this.mainWindow.on('maximize', () => {
      void persistMainWindowMaximized(true);
      reapplyPersistedZoomLevelAfterWindowStateChange('maximized');
    });
    this.mainWindow.on('unmaximize', () => {
      void persistMainWindowMaximized(false);
      reapplyPersistedZoomLevelAfterWindowStateChange('normal');
    });

    // macOS fullscreen events — notify renderer so it can adjust traffic-light-aware layout
    this.mainWindow.on('enter-full-screen', () => {
      if (this.mainWindow) {
        windowMainToRender.bindWebContents(this.mainWindow.webContents).fullScreenChanged(true);
      }
    });
    this.mainWindow.on('leave-full-screen', () => {
      if (this.mainWindow) {
        windowMainToRender.bindWebContents(this.mainWindow.webContents).fullScreenChanged(false);
      }
    });

    this.mainWindow.webContents.on('did-finish-load', () => {
      void applyPersistedZoomLevel();
    });

    this.mainWindow.webContents.on('did-stop-loading', () => {
      void ensurePersistedZoomLevel();
    });

    // Restore persisted zoom level for the initial blank page before the first navigation.
    await applyPersistedZoomLevel();

    // Set up window event handlers first
    this.mainWindow.once('ready-to-show', async () => {
      safeConsole.timeEnd('[Startup] Total main.ts load');
      safeConsole.log('[Startup] 🎉 Window ready-to-show event fired!');
      crashCaptureManager.recordBreadcrumb('window', 'main-window-ready-to-show', {
        windowId: this.mainWindow?.id,
      });

      if (this.mainWindow) {
        try {
          await appCacheManager.initialize();
          const config = appCacheManager.getConfig();
          if (config.mainWindowMaximized) {
            this.mainWindow.maximize();
          }
        } catch (error) {
          safeConsole.error('[WindowState] Failed to restore maximized state:', error);
        }

        // 🚀 Optimization: show window immediately, move heavy initialization to background
        this.mainWindow.show();
        safeConsole.log('[Startup] 🎉 Window shown!');

        // 📸 Deferred registration of screenshot feature IPC handlers
        setImmediate(async () => {
          try {
            const { registerScreenshotIPC, registerScreenshotShortcut } = await import('./lib/screenshot');
            registerScreenshotIPC({});
            await registerScreenshotShortcut({});
          } catch (error) {
            safeConsole.error('[Startup] Failed to register screenshot IPC:', error);
          }
        });

        this.isAgentChatReady = true;
        this.checkAppReadiness();

        if (this.isDev) {
          setTimeout(() => {
            this.mainWindow?.webContents.openDevTools();
          }, 2000); // Delay 1 second before opening DevTools, ensure window is fully loaded

          // Add keyboard shortcuts for development
          this.mainWindow.webContents.on('before-input-event', (event, input) => {
            // F5 or Ctrl+R to reload
            if ((input.key === 'F5') || (input.control && input.key === 'r')) {
              this.mainWindow?.webContents.reload();
            }
          });
        }
      }
    });


    // ProfileCacheManager.setMainWindow 钩子已删 —— persist 走全局 mainWindow() getter 自动拿窗口。
    // AppCacheManager 同理：移除 setMainWindow 后，sendConfigToFrontend 内部用 wins.mainWindow() / anyVisibleWindow()。

    // macOS standard behavior: intercept close event, hide window instead of destroying
    if (process.platform === 'darwin') {
      this.mainWindow.on('close', (event) => {
        // Prevent window from closing
        event.preventDefault();
        // Hide window instead of destroying
        this.mainWindow?.hide();
      });
    }

    this.mainWindow.on('closed', () => {
      // macOS standard behavior: do not quit app when main window is closed
      if (process.platform === 'darwin') {
        // On macOS, only clean up window reference, keep app running
        this.mainWindow = null;
      } else {
        // On non-macOS systems, quit program when main window is closed
        try {
          this.mainWindow = null;

        } catch (error) {
        }
      }
    });

    // Handle external links
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });
    // Load the app
    try {
      if (this.isDev) {
        // electron-vite sets ELECTRON_RENDERER_URL
        // Retry logic: Chromium network service can crash transiently on startup (ERR_FAILED -2)
        const maxRetries = 5;
        const retryDelayMs = 1000;
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            await this.mainWindow.loadURL(DEV_SERVER_URL);
            lastError = null;
            break;
          } catch (err) {
            lastError = err;
            const msg = err instanceof Error ? err.message : String(err);
            log.warn({ msg: `[createWindow] loadURL attempt ${attempt}/${maxRetries} failed: ${msg}`, mod: 'main' });
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            }
          }
        }

        if (lastError) {
          throw lastError;
        }
      } else {
        // Production mode: load from built files
        const htmlPath = path.join(__dirname, '../renderer/index.html');

        if (!fs.existsSync(htmlPath)) {
          // Load a simple fallback page
          await this.mainWindow.loadURL('data:text/html,<html><body><h1>' + encodeURIComponent(APP_NAME) + '</h1><p>HTML file not found. Please run: npm run build</p></body></html>');
        } else {
          await this.mainWindow.loadFile(htmlPath);
        }
      }
    } catch (error) {
      // Load error page
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.mainWindow.loadURL('data:text/html,<html><body><h1>' + encodeURIComponent(APP_NAME) + ' - Error</h1><p>Failed to load: ' + errorMessage + '</p></body></html>');
    }
  }


  private normalizeWindowZoomLevel(level: number): number {
    const zoomStep = 0.5;
    const zoomMin = -3;
    const zoomMax = 3;
    const rounded = Math.round(level / zoomStep) * zoomStep;
    return Math.min(zoomMax, Math.max(zoomMin, rounded));
  }

  private async getPersistedWindowZoomLevel(): Promise<number> {
    await appCacheManager.initialize();
    const zoomLevel = appCacheManager.getConfig().zoomLevel;
    return typeof zoomLevel === 'number' ? this.normalizeWindowZoomLevel(zoomLevel) : 0;
  }

  private applyWindowZoomLevel(level: number): number {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return 0;
    }

    const next = this.normalizeWindowZoomLevel(level);
    this.mainWindow.webContents.setZoomLevel(next);
    windowMainToRender.bindWebContents(this.mainWindow.webContents).zoomChanged(next);
    return next;
  }

  private async persistWindowZoomLevel(level: number): Promise<void> {
    try {
      await appCacheManager.initialize();
      await appCacheManager.updateConfig({ zoomLevel: level });
    } catch (e) {
      safeConsole.error('[Zoom] Failed to persist zoom level:', e);
    }
  }

  private async stepWindowZoomLevel(delta: number): Promise<number> {
    const current = await this.getPersistedWindowZoomLevel();
    const next = this.normalizeWindowZoomLevel(current + delta);
    this.applyWindowZoomLevel(next);
    void this.persistWindowZoomLevel(next);
    return next;
  }

  private async resetWindowZoomLevel(): Promise<number> {
    const next = this.applyWindowZoomLevel(0);
    void this.persistWindowZoomLevel(next);
    return next;
  }

  private getDebugInfoTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  private async addPathToZip(zip: JSZip, sourcePath: string, zipPrefix: string, redact?: (s: string) => string): Promise<void> {
    if (!fs.existsSync(sourcePath)) {
      return;
    }

    const stats = await fs.promises.stat(sourcePath);
    if (stats.isDirectory()) {
      const entries = await fs.promises.readdir(sourcePath, { withFileTypes: true });
      if (entries.length === 0) {
        zip.folder(zipPrefix);
        return;
      }

      await Promise.all(entries.map(async (entry) => {
        const childSourcePath = path.join(sourcePath, entry.name);
        const childZipPath = `${zipPrefix}/${entry.name}`;
        if (entry.isDirectory()) {
          await this.addPathToZip(zip, childSourcePath, childZipPath, redact);
          return;
        }

        if (entry.isFile()) {
          if (redact && isTextFile(entry.name)) {
            const text = await fs.promises.readFile(childSourcePath, 'utf-8');
            zip.file(childZipPath, redactFileContent(text, childZipPath, redact));
          } else {
            const content = await fs.promises.readFile(childSourcePath);
            zip.file(childZipPath, content);
          }
        }
      }));
      return;
    }

    if (stats.isFile()) {
      if (redact && isTextFile(sourcePath)) {
        const text = await fs.promises.readFile(sourcePath, 'utf-8');
        zip.file(zipPrefix, redactFileContent(text, zipPrefix, redact));
      } else {
        const content = await fs.promises.readFile(sourcePath);
        zip.file(zipPrefix, content);
      }
    }
  }

  private async exportDebugInfo(): Promise<{ success: boolean; filePath?: string; fileName?: string; error?: string }> {
    try {
      // flushLogs 等 worker 把缓冲全部 INSERT 进 sqlite，否则导出包会漏最后一批日志。
      await flushLogs();

      const downloadsDir = app.getPath('downloads');
      const timestamp = this.getDebugInfoTimestamp();
      let fileName = `debug-${timestamp}.zip`;
      let filePath = path.join(downloadsDir, fileName);
      let suffix = 1;

      while (fs.existsSync(filePath)) {
        fileName = `debug-${timestamp}-${suffix}.zip`;
        filePath = path.join(downloadsDir, fileName);
        suffix += 1;
      }

      const zip = new JSZip();
      const redact = createRedactor({ profileId: Profiles.get().activeProfileId || null });
      const exportedAt = new Date().toISOString();
      const crashStatus = crashCaptureManager.getStatus();
      const crashBundleNames = fs.existsSync(crashStatus.crashRootDir)
        ? fs.readdirSync(crashStatus.crashRootDir).filter((entry) => {
            try {
              return fs.statSync(path.join(crashStatus.crashRootDir, entry)).isDirectory();
            } catch {
              return false;
            }
          })
        : [];

      const manifestJson = JSON.stringify(buildDebugInfoManifest({
        appName: app.getName(),
        appVersion: APP_VERSION,
        exportedAt,
        platform: process.platform,
        arch: process.arch,
        crashStatus,
        crashBundleNames,
      }), null, 2);
      zip.file('manifest.json', redact(manifestJson));

      for (const entry of getDebugInfoEntries(
        getAppDataPath(),
        app.getPath('crashDumps'),
        Profiles.get().activeProfileId || null,
      )) {
        await this.addPathToZip(zip, entry.sourcePath, entry.zipPath, redact);
      }

      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      await fs.promises.writeFile(filePath, buffer);

      return {
        success: true,
        filePath,
        fileName,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export debug info',
      };
    }
  }

  private notifyDebugInfoDownload(result: { success: boolean; filePath?: string; fileName?: string; error?: string }): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    appMainToRender.bindWebContents(this.mainWindow.webContents).debugInfoDownloaded(result);
  }

  private getMenuTemplate(): Electron.MenuItemConstructorOptions[] {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'File',
        submenu: [
          {
            label: 'Open Logs Folder',
            click: async () => {
              try {
                const logDirectory = getLogsDir();
                // Ensure logs directory exists
                if (!fs.existsSync(logDirectory)) {
                  fs.mkdirSync(logDirectory, { recursive: true });
                }
                await shell.openPath(logDirectory);
              } catch (error) {}
            },
          },
          {
            label: 'Open Profile Folder',
            click: async () => {
              try {
                const activeProfileId = Profiles.get().activeProfileId;
                if (!activeProfileId) {
                  // Show a message or dialog that no user is signed in
                  return;
                }
                const profileDirectory = getProfileDirectoryPath(activeProfileId);
                // Ensure profile directory exists
                if (!fs.existsSync(profileDirectory)) {
                  fs.mkdirSync(profileDirectory, { recursive: true });
                }
                await shell.openPath(profileDirectory);
              } catch (error) {}
            },
          },
          { type: 'separator' },
          {
            label: 'Log to Disk',
            accelerator:
              process.platform === 'darwin' ? 'Cmd+Shift+L' : 'Ctrl+Shift+L',
            click: async () => {
              try {
                await flushLogs();
              } catch (error) {}
            },
          },
          {
            label: 'Download Debug Info',
            click: async () => {
              const result = await this.exportDebugInfo();
              this.notifyDebugInfoDownload(result);
            },
          },
          ...(process.platform !== 'darwin'
            ? [
                { type: 'separator' as const },
                {
                  label: 'Exit',
                  accelerator: 'Ctrl+Q',
                  click: () => {
                    app.quit();
                  },
                },
              ]
            : []),
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          ...(process.platform === 'darwin'
            ? [
                { role: 'pasteAndMatchStyle' as const },
                { role: 'delete' as const },
                { role: 'selectAll' as const },
                { type: 'separator' as const },
                {
                  label: 'Speech',
                  submenu: [
                    { role: 'startSpeaking' as const },
                    { role: 'stopSpeaking' as const },
                  ],
                },
              ]
            : [
                { role: 'delete' as const },
                { type: 'separator' as const },
                { role: 'selectAll' as const },
              ]),
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            role: 'toggleDevTools',
            label: 'Inspect (Developer Tools)',
            accelerator:
              process.platform === 'darwin' ? 'Cmd+Option+I' : 'Ctrl+Shift+I',
          },
          { type: 'separator' },
          {
            label: 'Actual Size',
            accelerator: 'CmdOrCtrl+0',
            click: async () => {
              await this.resetWindowZoomLevel();
            },
          },
          {
            label: 'Zoom In',
            accelerator: 'CmdOrCtrl+=',
            click: async () => {
              await this.stepWindowZoomLevel(0.5);
            },
          },
          {
            label: 'Zoom Out',
            accelerator: 'CmdOrCtrl+-',
            click: async () => {
              await this.stepWindowZoomLevel(-0.5);
            },
          },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          ...(process.platform === 'darwin'
            ? [
                { role: 'zoom' as const },
                { role: 'close' as const },
                { type: 'separator' as const },
                { role: 'front' as const, label: 'Bring All to Front' },
              ]
            : [{ role: 'close' as const }]),
        ],
      },
      // Dev-only：日志查看器。生产构建中 visible:false，菜单项不出现。
      {
        label: 'Develop',
        visible: !app.isPackaged,
        submenu: [
          {
            label: 'Open Log Viewer',
            accelerator: process.platform === 'darwin' ? 'Cmd+Alt+L' : 'Ctrl+Alt+L',
            click: () => openLogViewerWindow(),
          },
        ],
      },
    ];

    // Adjust menu structure on macOS
    if (process.platform === 'darwin') {
      template.unshift({
        label: app.getName(),
        submenu: [
          { role: 'about', label: 'About ' + app.getName() },
          { type: 'separator' },
          {
            label: 'Preferences…',
            accelerator: 'Cmd+,',
            click: () => {
              const win = this.mainWindow;
              if (!win || win.isDestroyed()) return;
              win.show();
              win.focus();
              navigateMainToRender.bindWebContents(win.webContents).to({ route: '/settings' });
            },
          },
          { type: 'separator' },
          { role: 'services', label: 'Services', submenu: [] },
          { type: 'separator' },
          { role: 'hide', label: 'Hide ' + app.getName() },
          { role: 'hideOthers', label: 'Hide Others' },
          { role: 'unhide', label: 'Show All' },
          { type: 'separator' },
          { role: 'quit', label: 'Quit ' + app.getName() },
        ],
      });
    }

    return template;
  }

  private setupMenu(): void {
    const template = this.getMenuTemplate();
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }
}

// Create and start the application
// 仅用于副作用：实例化即启动；无人 import 这个变量，所以不导出。
// 不能 export default — main 是 electron entry，被 bootstrap 用 require() 加载，
// 任何 export 会污染整个 bundle（rolldown 会把所有 reachable 的命名 export 都冒泡上来）。
if (hasSingleInstanceLock) {
  Profiles.get().bootstrap();
  new ElectronApp();
}
