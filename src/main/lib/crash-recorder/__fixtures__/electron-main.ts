import { app, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { crashRecorder } from '../CrashRecorder';

const scenario = process.argv.find((argument) => argument.startsWith('--scenario='))?.slice('--scenario='.length) ?? 'normal';
const root = process.env.DESKMATE_TEST_USER_DATA_PATH;
if (!root) throw new Error('DESKMATE_TEST_USER_DATA_PATH is required.');

const chromium = path.join(root, 'chromium');
fs.mkdirSync(chromium, { recursive: true });
app.setPath('userData', chromium);
app.setName('Deskmate Crash Recorder Fixture');
crashRecorder.bootstrap(false);

function createProfileWindow(profileId: string): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });
  crashRecorder.registerWindow(window, { role: 'main', profileId });
  return window;
}

function cleanExit(reason: 'test' | 'updater-restart' = 'test'): void {
  crashRecorder.beginShutdown(reason);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.destroy();
  }
  crashRecorder.finishShutdown(0);
  crashRecorder.close();
  app.exit(0);
}

app.on('window-all-closed', () => {
  // Fixture controls its own lifecycle explicitly.
});

void app.whenReady().then(async () => {
  if (scenario === 'recover') {
    setTimeout(() => cleanExit(), 1_500);
    return;
  }
  if (scenario === 'normal') {
    createProfileWindow('p_normal');
    setTimeout(() => cleanExit(), 300);
    return;
  }
  if (scenario === 'updater') {
    createProfileWindow('p_updater');
    setTimeout(() => cleanExit('updater-restart'), 300);
    return;
  }
  if (scenario === 'close-one') {
    const first = createProfileWindow('p_a');
    createProfileWindow('p_b');
    await Promise.all(BrowserWindow.getAllWindows().map((window) => window.loadURL('data:text/html,<p>fixture</p>')));
    first.destroy();
    setTimeout(() => cleanExit(), 500);
    return;
  }
  if (scenario === 'renderer') {
    const window = createProfileWindow('p_renderer');
    await window.loadURL('data:text/html,<p>renderer crash</p>');
    void window.webContents.executeJavaScript('setTimeout(() => process.crash(), 50)').catch(() => undefined);
    setTimeout(() => cleanExit(), 1_500);
    return;
  }
  if (scenario === 'dual') {
    const first = createProfileWindow('p_a');
    const second = createProfileWindow('p_b');
    await Promise.all([
      first.loadURL('data:text/html,<p>profile a</p>'),
      second.loadURL('data:text/html,<p>profile b</p>'),
    ]);
    void first.webContents.executeJavaScript('setTimeout(() => process.crash(), 50)').catch(() => undefined);
    setTimeout(() => cleanExit(), 1_500);
    return;
  }
  if (scenario === 'main-native') {
    setTimeout(() => process.crash(), 100);
    return;
  }
  if (scenario === 'main-js') {
    setTimeout(() => {
      throw new Error('fixture uncaught exception');
    }, 100);
    return;
  }
  if (scenario === 'hold-running') {
    process.stdout.write('FIXTURE_READY\n');
    setInterval(() => undefined, 1_000);
    return;
  }
  if (scenario === 'hold-closing') {
    crashRecorder.beginShutdown('test');
    process.stdout.write('FIXTURE_READY\n');
    setInterval(() => undefined, 1_000);
    return;
  }
  throw new Error(`Unknown fixture scenario: ${scenario}`);
});
