import { app, BrowserWindow, Menu, shell } from 'electron';
import { createWindow, getWindowMeta, zoomLevel } from './wins';
import * as path from 'path';
import * as fs from 'fs';
import { log } from '@main/log';
import { crashCaptureManager } from '@main/lib/crash/CrashCaptureManager';
import { PRELOAD_PATH } from '@main/lib/buildPaths';

import { appCacheManager } from '@main/lib/appCache';
import { persistMaximized, restoreBounds, restoreMaximized, trackBounds } from './windowState';
import { ProfileRegistry } from '../profileRegistry'

import { mainToRender as appMainToRender } from '@shared/ipc/app';
import { mainToRender as windowMainToRender } from '@shared/ipc/window';
import { APP_NAME } from '@shared/constants/branding';
import { IS_DEV } from './context';


const DEV_SERVER_PORT = process.env.DEV_SERVER_PORT || '39017';
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'] || `http://localhost:${DEV_SERVER_PORT}`;
const openingMainWindows = new Map<string, Promise<BrowserWindow>>()

function hasAnotherMainWindow(window: BrowserWindow): boolean {
  return BrowserWindow.getAllWindows().some((candidate) =>
    candidate !== window && getWindowMeta(candidate)?.role === 'main',
  );
}


async function createMainWindowImpl(profileId: string): Promise<BrowserWindow> {
  const profile = ProfileRegistry.require(profileId);

  // Create the browser window
  const window = createWindow({
    width: 1200,
    height: 800,
    // 展开上次记忆的几何（位置 + 尺寸）；无记忆或窗口已离屏时回退上面的默认值。
    ...restoreBounds(profileId),
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
      additionalArguments: [`--deskmate-profile-id=${profileId}`],
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
  }, { role: 'main', profileId });

  profile.attachMainWindow(window);
  crashCaptureManager.attachToMainWindow(window);
  crashCaptureManager.recordBreadcrumb('window', 'main-window-created', {
    windowId: window.id,
  });

  // 挂载窗口几何记忆：move / resize 后防抖保存，下次启动恢复到同一屏幕与位置。
  trackBounds(window, profileId);

  // Native right-click context menu for editable fields (Cut/Copy/Paste/Select All)
  window.webContents.on('context-menu', (_event, params) => {
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
      contextMenu.popup({ window });
    }
  });

  const applyPersistedZoomLevel = async (): Promise<void> => {
    try {
      if (window.isDestroyed()) return;
      window.webContents.setZoomLevel(await zoomLevel.get(window));
    } catch (error) {
      console.error('[Zoom] Failed to restore zoom level:', error);
    }
  };

  const ensurePersistedZoomLevel = async (): Promise<void> => {
    try {
      if (window.isDestroyed()) return;
      const persistedZoomLevel = await zoomLevel.get(window);
      const actualZoomLevel = window.webContents.getZoomLevel();
      if (actualZoomLevel !== persistedZoomLevel) {
        window.webContents.setZoomLevel(persistedZoomLevel);
      }
    } catch (error) {
      console.error('[Zoom] Failed to ensure zoom level:', error);
    }
  };

  const persistMainWindowMaximized = async (maximized: boolean) => {
    try {
      await persistMaximized(profileId, maximized);
    } catch (error) {
      console.error('[WindowState] Failed to persist maximized state:', error);
    }
  };

  const reapplyPersistedZoomLevelAfterWindowStateChange = (state: 'maximized' | 'normal') => {
    if (!window.isDestroyed()) {
      windowMainToRender.bindWebContents(window.webContents).stateChanged(state);
    }

    setTimeout(() => {
      void applyPersistedZoomLevel();
    }, 0);
  };

  // Listen for window state changes
  window.on('maximize', () => {
    void persistMainWindowMaximized(true);
    reapplyPersistedZoomLevelAfterWindowStateChange('maximized');
  });
  window.on('unmaximize', () => {
    void persistMainWindowMaximized(false);
    reapplyPersistedZoomLevelAfterWindowStateChange('normal');
  });

  // macOS fullscreen events — notify renderer so it can adjust traffic-light-aware layout
  window.on('enter-full-screen', () => {
    if (!window.isDestroyed()) {
      windowMainToRender.bindWebContents(window.webContents).fullScreenChanged(true);
    }
  });
  window.on('leave-full-screen', () => {
    if (!window.isDestroyed()) {
      windowMainToRender.bindWebContents(window.webContents).fullScreenChanged(false);
    }
  });

  window.webContents.on('did-finish-load', () => {
    void applyPersistedZoomLevel();
  });

  window.webContents.on('did-stop-loading', () => {
    void ensurePersistedZoomLevel();
  });

  // Restore persisted zoom level for the initial blank page before the first navigation.
  await applyPersistedZoomLevel();

  // Set up window event handlers first
  window.once('ready-to-show', async () => {
    console.timeEnd('[Startup] Total main.ts load');
    console.log('[Startup] 🎉 Window ready-to-show event fired!');
    crashCaptureManager.recordBreadcrumb('window', 'main-window-ready-to-show', {
      windowId: window.id,
    });

    if (!window.isDestroyed()) {
      try {
        await appCacheManager.initialize();
        const legacyMaximized = appCacheManager.getConfig().mainWindowMaximized ?? false;
        if (restoreMaximized(profileId, legacyMaximized)) {
          window.maximize();
        }
      } catch (error) {
        console.error('[WindowState] Failed to restore maximized state:', error);
      }

      // 🚀 Optimization: show window immediately, move heavy initialization to background
      window.show();
      console.log('[Startup] 🎉 Window shown!');

      // 📸 Deferred registration of screenshot feature IPC handlers
      setImmediate(async () => {
        try {
          const { registerScreenshotIPC, registerScreenshotShortcut } = await import('@main/lib/screenshot');
          registerScreenshotIPC({});
          await registerScreenshotShortcut({});
        } catch (error) {
          console.error('[Startup] Failed to register screenshot IPC:', error);
        }
      });

      console.log('[Startup] App fully ready (AgentChat), notifying renderer');
      appMainToRender.bindWebContents(window.webContents).ready(true);

      if (IS_DEV) {
        setTimeout(() => {
          window.webContents.openDevTools();
        }, 2000); // Delay 1 second before opening DevTools, ensure window is fully loaded

        // Add keyboard shortcuts for development
        window.webContents.on('before-input-event', (_event, input) => {
          if ((input.key === 'F5') || (input.control && input.key === 'r')) {
            window.webContents.reload();
          }
        });
      }
    }
  });


  // ProfileCacheManager.setMainWindow 钩子已删 —— persist 走全局 mainWindow() getter 自动拿窗口。
  // AppCacheManager 同理：移除 setMainWindow 后，sendConfigToFrontend 内部用 wins.mainWindow() / anyVisibleWindow()。

  // 在 macOS 上保留最后一个主窗口的隐藏行为；关闭其它 Profile 窗口必须真正销毁，
  // 这样 Profile 会 detach owner window，后续可被安全删除。
  if (process.platform === 'darwin') {
    window.on('close', (event) => {
      if (hasAnotherMainWindow(window)) return;
      event.preventDefault();
      window.hide();
    });
  }

  window.on('closed', () => {
    profile.detachMainWindow(window);
  });

  // Handle external links
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  // Load the app
  try {
    if (IS_DEV) {
      // electron-vite sets ELECTRON_RENDERER_URL
      // Retry logic: Chromium network service can crash transiently on startup (ERR_FAILED -2)
      const maxRetries = 5;
      const retryDelayMs = 1000;
      let lastError: unknown;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await window.loadURL(DEV_SERVER_URL);
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
        await window.loadURL('data:text/html,<html><body><h1>' + encodeURIComponent(APP_NAME) + '</h1><p>HTML file not found. Please run: npm run build</p></body></html>');
      } else {
        await window.loadFile(htmlPath);
      }
    }
  } catch (error) {
    // Load error page
    const errorMessage = error instanceof Error ? error.message : String(error);
    await window.loadURL('data:text/html,<html><body><h1>' + encodeURIComponent(APP_NAME) + ' - Error</h1><p>Failed to load: ' + errorMessage + '</p></body></html>');
  }
  return window;
}

export async function createMainWindow(
  profileId: string = ProfileRegistry.defaultProfileId,
): Promise<BrowserWindow> {
  if (!profileId) return Promise.reject(new Error('Main window requires a default profile.'));

  const pending = openingMainWindows.get(profileId);
  if (pending) return pending;

  const profile = ProfileRegistry.require(profileId);
  const existing = profile.getMainWindow();
  if (existing) {
    existing.show();
    existing.focus();
    return existing;
  }

  const creating = createMainWindowImpl(profileId);
  openingMainWindows.set(profileId, creating);
  creating.finally(() => {
    if (openingMainWindows.get(profileId) === creating) openingMainWindows.delete(profileId);
  });

  return creating;
}
