import { describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const closedListeners = new WeakMap<object, () => void>();
  let createdCount = 0;

  class MockBrowserWindow {
    public constructor() {
      createdCount += 1;
    }
    public once(_event: string, listener: () => void): void {
      closedListeners.set(this, listener);
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
      closedListeners.get(window)?.();
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
