import { app, BrowserWindow, Menu, shell } from 'electron';
import { zoomLevel, getWindowMeta } from './wins';
import fs from 'fs';
import { mainToRender as navigateMainToRender } from '@shared/ipc/navigate';
import { flushLogs } from '@main/log';
import { openLogViewerWindow } from '@main/log/viewer-window';
import { getLogsDir, getProfileDirectoryPath } from "@main/persist/lib/path";

import { crashRecorder } from '@main/lib/crash-recorder';

export function getMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  const mainWindowFromMenu = (window: Electron.BaseWindow | undefined): BrowserWindow | null => {
    const target = window instanceof BrowserWindow ? window : BrowserWindow.getFocusedWindow();
    return target && getWindowMeta(target)?.role === 'main' ? target : null;
  };

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
            } catch (error) { }
          },
        },
        {
          label: 'Open Profile Folder',
          click: async (_menuItem, browserWindow) => {
            const targetWindow = browserWindow instanceof BrowserWindow ? browserWindow : undefined;
            try {
              const profileId = targetWindow ? getWindowMeta(targetWindow)?.profileId : undefined;
              if (!profileId) return;
              const profileDirectory = getProfileDirectoryPath(profileId);
              // Ensure profile directory exists
              if (!fs.existsSync(profileDirectory)) {
                fs.mkdirSync(profileDirectory, { recursive: true });
              }
              await shell.openPath(profileDirectory);
            } catch (error) { }
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
            } catch (error) { }
          },
        },
        ...(process.platform !== 'darwin'
          ? [
            { type: 'separator' as const },
            {
              label: 'Exit',
              accelerator: 'Ctrl+Q',
              click: () => {
                crashRecorder.beginShutdown('menu');
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
          click: async (_menuItem, browserWindow) => {
            const window = mainWindowFromMenu(browserWindow);
            if (!window) return;
            await zoomLevel.reset(window);
          },
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: async (_menuItem, browserWindow) => {
            const window = mainWindowFromMenu(browserWindow);
            if (!window) return;
            await zoomLevel.step(window, 0.5);
          },
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: async (_menuItem, browserWindow) => {
            const window = mainWindowFromMenu(browserWindow);
            if (!window) return;
            await zoomLevel.step(window, -0.5);
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
          click: (_menuItem, browserWindow) => {
            const win = mainWindowFromMenu(browserWindow);
            if (!win) return;
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

export function setupMenu(): void {
  const template = getMenuTemplate();
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
