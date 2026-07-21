import { describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const listeners = new WeakMap<object, Map<string, Array<() => void>>>();
  const windows: object[] = [];
  let createdCount = 0;

  class MockBrowserWindow {
    public readonly webContents = {
      id: 1,
      on: vi.fn(),
      getURL: vi.fn(() => ''),
      getOSProcessId: vi.fn(() => 123),
    };

    public constructor() {
      createdCount += 1;
      windows.push(this);
      listeners.set(this, new Map());
    }

    public static getAllWindows(): object[] {
      return [...windows];
    }

    public on(event: string, listener: () => void): void {
      const byEvent = listeners.get(this);
      const eventListeners = byEvent?.get(event) ?? [];
      eventListeners.push(listener);
      byEvent?.set(event, eventListeners);
    }

    public once(event: string, listener: () => void): void {
      this.on(event, listener);
    }

    public isDestroyed(): boolean {
      return false;
    }
  }

  return {
    MockBrowserWindow,
    createdCount(): number {
      return createdCount;
    },
    close(window: object): void {
      for (const listener of listeners.get(window)?.get('closed') ?? []) listener();
    },
  };
});

vi.mock('electron', () => ({
  BrowserWindow: harness.MockBrowserWindow,
}));

import { createWindow, mainWindowForProfile } from '../wins';

describe('main window registry', () => {
  it('returns the existing main window for a Profile', () => {
    const profileId = 'p_test';
    const first = createWindow({}, { role: 'main', profileId });
    const duplicate = createWindow({}, { role: 'main', profileId });

    expect(duplicate).toBe(first);
    expect(harness.createdCount()).toBe(1);
    harness.close(first);
    expect(mainWindowForProfile(profileId)).toBeNull();
  });
});
