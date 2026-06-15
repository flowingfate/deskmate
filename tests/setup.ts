/**
 * Vitest global test setup
 * This file is referenced by setupFiles in vitest.config.ts
 */

import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// React 18 test helpers expect this flag in jsdom environments.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Global mock: prevent accidental Electron API calls during tests
vi.mock(
  'electron',
  () => ({
    app: {
      getPath: vi.fn(() => '/tmp/test'),
      setPath: vi.fn(),
      getName: vi.fn(() => 'deskmate-test'),
      getVersion: vi.fn(() => '0.0.0-test'),
      isReady: vi.fn(() => true),
      whenReady: vi.fn(() => Promise.resolve()),
    },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn(),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      send: vi.fn(),
    },
    BrowserWindow: vi.fn().mockImplementation(() => ({
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      webContents: {
        send: vi.fn(),
        on: vi.fn(),
      },
      on: vi.fn(),
      show: vi.fn(),
      close: vi.fn(),
    })),
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      showMessageBox: vi.fn(),
    },
  }),
);

// Default test root for persist module path derivation.
// Source root.ts uses `require('electron')` which the ESM `vi.mock` above does
// not intercept; without an explicit override, `getAppRoot()` blows up reading
// `app.getPath('userData')` on the real (un-mocked) electron module.
// Individual tests may still call `setRootForTesting(...)` to override.
import { setRootForTesting } from '../src/main/persist/lib/root';
setRootForTesting('/tmp/deskmate-test-root');

if (typeof window !== 'undefined') {
  const noopUnsubscribe = vi.fn(() => undefined);
  const invoke = vi.fn(async () => undefined);
  const on = vi.fn(() => noopUnsubscribe);
  const off = vi.fn();
  const write = vi.fn();
  const createNamespace = () => new Proxy({ invoke, on, off, write }, {
    get(target, prop: string | symbol) {
      if (prop in target) {
        return target[prop as keyof typeof target];
      }

      if (typeof prop === 'string' && prop.startsWith('on')) {
        return on;
      }

      return invoke;
    },
  });
  const electronAPI = new Proxy({}, {
    get(_target, _prop) {
      return createNamespace();
    },
  });

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: electronAPI,
  });
}
