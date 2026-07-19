import { beforeEach, describe, expect, it, vi } from 'vitest';

const windowHarness = vi.hoisted(() => ({
  mainWindowForProfile: vi.fn(),
}));

const ipcHarness = vi.hoisted(() => {
  const toastTargets: object[] = [];
  const navigationTargets: object[] = [];
  return {
    toastTargets,
    navigationTargets,
    toast: vi.fn(),
    navigate: vi.fn(),
  };
});

const notificationHarness = vi.hoisted(() => {
  const instances: Array<{ emit(event: string): void }> = [];
  return {
    instances,
    isSupported: vi.fn(() => true),
  };
});

vi.mock('@main/startup/wins', () => ({
  mainWindowForProfile: windowHarness.mainWindowForProfile,
}));

vi.mock('@shared/ipc/notification', () => ({
  mainToRender: {
    bindWebContents: (webContents: object) => {
      ipcHarness.toastTargets.push(webContents);
      return { sessionCompletion: ipcHarness.toast };
    },
  },
}));

vi.mock('@shared/ipc/navigate', () => ({
  mainToRender: {
    bindWebContents: (webContents: object) => {
      ipcHarness.navigationTargets.push(webContents);
      return { to: ipcHarness.navigate };
    },
  },
}));

vi.mock('@main/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('electron', () => {
  class Notification {
    private readonly handlers = new Map<string, () => void>();

    static isSupported(): boolean {
      return notificationHarness.isSupported();
    }

    constructor() {
      notificationHarness.instances.push(this);
    }

    on(event: string, handler: () => void): this {
      this.handlers.set(event, handler);
      return this;
    }

    show(): void {}

    emit(event: string): void {
      this.handlers.get(event)?.();
    }
  }

  return {
    BrowserWindow: class BrowserWindow {},
    Notification,
  };
});

import { showSessionCompletionNotification } from '../sessionCompletion';

function makeWindow(focused: boolean) {
  return {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => focused,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      isDestroyed: () => false,
    },
  };
}

const completion = {
  profileId: 'p_owner',
  agentId: 'a_1',
  jobId: 'j_1',
  sessionId: 's_1',
  sessionTitle: 'Scheduled run',
  outcome: 'completed' as const,
};

describe('showSessionCompletionNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationHarness.instances.length = 0;
    ipcHarness.toastTargets.length = 0;
    ipcHarness.navigationTargets.length = 0;
  });

  it('sends an in-app toast only to the owning profile window', () => {
    const ownerWindow = makeWindow(true);
    windowHarness.mainWindowForProfile.mockReturnValue(ownerWindow);

    showSessionCompletionNotification(completion);

    expect(windowHarness.mainWindowForProfile).toHaveBeenCalledWith('p_owner');
    expect(ipcHarness.toastTargets).toEqual([ownerWindow.webContents]);
    expect(ipcHarness.toast).toHaveBeenCalledWith({
      agentId: 'a_1',
      jobId: 'j_1',
      sessionId: 's_1',
      sessionTitle: 'Scheduled run',
      outcome: 'completed',
    });
  });

  it('resolves a system notification click against the same profile', () => {
    windowHarness.mainWindowForProfile.mockReturnValue(null);
    showSessionCompletionNotification(completion);
    expect(notificationHarness.instances).toHaveLength(1);

    const ownerWindow = makeWindow(false);
    windowHarness.mainWindowForProfile.mockReturnValue(ownerWindow);
    notificationHarness.instances[0].emit('click');

    expect(windowHarness.mainWindowForProfile).toHaveBeenLastCalledWith('p_owner');
    expect(ipcHarness.navigationTargets).toEqual([ownerWindow.webContents]);
    expect(ipcHarness.navigate).toHaveBeenCalledWith({
      route: '/agent/a_1/job/j_1/s_1',
    });
  });
});
