import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const listeners = new WeakMap<object, Map<string, () => void>>();
  const bounds = new WeakMap<object, Electron.Rectangle>();

  class MockBrowserWindow {
    public constructor() {
      listeners.set(this, new Map());
      bounds.set(this, { x: 0, y: 0, width: 1200, height: 800 });
    }

    public on(event: string, listener: () => void): void {
      listeners.get(this)?.set(event, listener);
    }

    public isDestroyed(): boolean {
      return false;
    }

    public getNormalBounds(): Electron.Rectangle {
      return bounds.get(this) ?? { x: 0, y: 0, width: 1200, height: 800 };
    }
  }

  return {
    MockBrowserWindow,
    emit(window: object, event: string): void {
      listeners.get(window)?.get(event)?.();
    },
    setBounds(window: object, nextBounds: Electron.Rectangle): void {
      bounds.set(window, nextBounds);
    },
  };
});

vi.mock('electron', () => ({
  BrowserWindow: harness.MockBrowserWindow,
  screen: {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 3840, height: 2160 } }],
  },
}));

import { BrowserWindow } from 'electron';
import { setRootForTesting } from '@main/persist/lib/root';
import {
  persistMaximized,
  persistZoomLevel,
  restoreBounds,
  restoreMaximized,
  restoreZoomLevel,
  trackBounds,
} from '../windowState';

const roots: string[] = [];

function createTestRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deskmate-window-state-'));
  roots.push(root);
  setRootForTesting(root);
  return root;
}

afterEach(() => {
  vi.useRealTimers();
  setRootForTesting(null);
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Profile window state', () => {
  it('persists bounds, zoom, and maximized state independently per Profile', async () => {
    const root = createTestRoot();
    vi.useFakeTimers();

    const profileAWindow = new BrowserWindow({});
    const profileBWindow = new BrowserWindow({});
    harness.setBounds(profileAWindow, { x: 24, y: 36, width: 1100, height: 760 });
    harness.setBounds(profileBWindow, { x: 480, y: 120, width: 900, height: 700 });
    trackBounds(profileAWindow, 'p_a');
    trackBounds(profileBWindow, 'p_b');

    harness.emit(profileAWindow, 'move');
    harness.emit(profileBWindow, 'resize');
    await vi.advanceTimersByTimeAsync(400);
    await persistZoomLevel('p_a', 1);
    await persistMaximized('p_a', true);
    await persistZoomLevel('p_b', -0.5);
    await persistMaximized('p_b', false);

    expect(restoreBounds('p_a')).toEqual({ x: 24, y: 36, width: 1100, height: 760 });
    expect(restoreBounds('p_b')).toEqual({ x: 480, y: 120, width: 900, height: 700 });
    expect(restoreZoomLevel('p_a', 0)).toBe(1);
    expect(restoreZoomLevel('p_b', 0)).toBe(-0.5);
    expect(restoreMaximized('p_a', false)).toBe(true);
    expect(restoreMaximized('p_b', true)).toBe(false);

    expect(JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'p_a', 'window.json'), 'utf8'))).toMatchObject({
      version: 1,
      bounds: { x: 24, y: 36, width: 1100, height: 760 },
      zoomLevel: 1,
      maximized: true,
    });
    expect(JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'p_b', 'window.json'), 'utf8'))).toMatchObject({
      version: 1,
      bounds: { x: 480, y: 120, width: 900, height: 700 },
      zoomLevel: -0.5,
      maximized: false,
    });
  });

  it('migrates transitional state into the Profile directory on the next write', async () => {
    const root = createTestRoot();
    fs.mkdirSync(path.join(root, 'state', 'windows'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'state', 'windows', 'p_transition.json'),
      JSON.stringify({ bounds: { x: 32, y: 48, width: 1024, height: 768 }, zoomLevel: 1.5, maximized: true }),
    );

    expect(restoreBounds('p_transition')).toEqual({ x: 32, y: 48, width: 1024, height: 768 });
    expect(restoreZoomLevel('p_transition', 0)).toBe(1.5);
    expect(restoreMaximized('p_transition', false)).toBe(true);

    await persistZoomLevel('p_transition', 2);

    expect(JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'p_transition', 'window.json'), 'utf8'))).toMatchObject({
      version: 1,
      bounds: { x: 32, y: 48, width: 1024, height: 768 },
      zoomLevel: 2,
      maximized: true,
    });
  });

  it('uses the legacy bounds only when no Profile-specific bounds exist', () => {
    const root = createTestRoot();
    fs.mkdirSync(path.join(root, 'state'), { recursive: true });
    fs.writeFileSync(path.join(root, 'state', 'window.json'), JSON.stringify({ x: 10, y: 20, width: 1000, height: 700 }));

    expect(restoreBounds('p_legacy')).toEqual({ x: 10, y: 20, width: 1000, height: 700 });
  });
});
