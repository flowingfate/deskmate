import { describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const closedListeners = new WeakMap<object, () => void>();

  class MockBrowserWindow {
    public once(_event: string, listener: () => void): void {
      closedListeners.set(this, listener);
    }

    public isDestroyed(): boolean {
      return false;
    }
  }

  return {
    MockBrowserWindow,
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
  it('keeps the current Profile owner when a superseded window closes', () => {
    const profileId = 'p_test';
    const first = createWindow({}, { role: 'main', profileId });
    const current = createWindow({}, { role: 'main', profileId });

    harness.close(first);

    expect(mainWindowForProfile(profileId)).toBe(current);
  });
});
