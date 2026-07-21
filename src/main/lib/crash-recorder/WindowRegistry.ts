import { BrowserWindow, type WebContents } from 'electron';
import type { WindowIdentity } from './types';

export interface CrashWindowMeta {
  role: 'main' | 'log' | 'screenshot' | 'research';
  profileId?: string;
  tag?: string;
}

export interface CrashWebContentsMeta {
  windowId: number;
  role: 'screenshot' | 'research' | 'log-viewer';
}

interface RegisteredWindow {
  window: BrowserWindow;
  meta: CrashWindowMeta;
}

function routeOf(webContents: WebContents): string {
  const raw = webContents.getURL();
  if (!raw) return '/';
  try {
    const parsed = new URL(raw);
    return parsed.hash ? parsed.hash.slice(1) || '/' : parsed.pathname || '/';
  } catch {
    return '/';
  }
}

function auxiliaryRole(role: CrashWindowMeta['role']): 'screenshot' | 'research' | 'log-viewer' {
  if (role === 'screenshot') return 'screenshot';
  if (role === 'research') return 'research';
  return 'log-viewer';
}

export class WindowRegistry {
  private readonly registered = new WeakMap<BrowserWindow, RegisteredWindow>();
  private readonly expectedTermination = new WeakSet<WebContents>();
  private readonly registeredWebContents = new WeakSet<WebContents>();

  public constructor(
    private readonly onRendererGone: (
      details: Electron.RenderProcessGoneDetails,
      identity: WindowIdentity,
      expectedTermination: boolean,
    ) => void,
    private readonly onSessionEnd: () => void,
  ) {}

  public register(window: BrowserWindow, meta: CrashWindowMeta): void {
    if (this.registered.has(window)) return;
    const metaSnapshot = { ...meta };
    this.registered.set(window, { window, meta: metaSnapshot });
    const webContents = window.webContents;
    this.registeredWebContents.add(webContents);
    this.registerRenderer(webContents, () => this.identity(window, metaSnapshot));
    window.on('close', (event) => {
      queueMicrotask(() => {
        if (!event.defaultPrevented) this.expectedTermination.add(webContents);
      });
    });
    window.once('closed', () => this.expectedTermination.add(webContents));
    window.on('session-end', () => {
      this.expectedTermination.add(webContents);
      this.onSessionEnd();
    });
  }

  public registerWebContents(webContents: WebContents, meta: CrashWebContentsMeta): void {
    if (this.registeredWebContents.has(webContents)) return;
    this.registeredWebContents.add(webContents);
    const metaSnapshot = { ...meta };
    this.registerRenderer(webContents, () => this.webContentsIdentity(webContents, metaSnapshot));
    webContents.once('destroyed', () => this.expectedTermination.add(webContents));
  }

  public markExpected(window: BrowserWindow): void {
    this.expectedTermination.add(window.webContents);
  }

  public markWebContentsExpected(webContents: WebContents): void {
    this.expectedTermination.add(webContents);
  }

  public markAllExpected(): void {
    for (const window of BrowserWindow.getAllWindows()) this.expectedTermination.add(window.webContents);
  }

  private registerRenderer(webContents: WebContents, identity: () => WindowIdentity): void {
    let identitySnapshot = identity();
    const refreshIdentity = (): void => {
      identitySnapshot = identity();
    };
    webContents.on('did-finish-load', refreshIdentity);
    webContents.on('did-navigate', refreshIdentity);
    webContents.on('did-navigate-in-page', refreshIdentity);
    webContents.on('render-process-gone', (_event, details) => {
      this.onRendererGone(details, identitySnapshot, this.expectedTermination.has(webContents));
    });
  }

  private identity(window: BrowserWindow, meta: CrashWindowMeta): WindowIdentity {
    const common = {
      windowId: window.id,
      webContentsId: window.webContents.id,
      rendererProcessId: window.webContents.getOSProcessId(),
      route: routeOf(window.webContents),
    };
    if (meta.role === 'main' && meta.profileId) {
      return { kind: 'profile-main', ...common, profileId: meta.profileId };
    }
    return { kind: 'auxiliary', ...common, role: auxiliaryRole(meta.role) };
  }

  private webContentsIdentity(webContents: WebContents, meta: CrashWebContentsMeta): WindowIdentity {
    return {
      kind: 'auxiliary',
      windowId: meta.windowId,
      webContentsId: webContents.id,
      rendererProcessId: webContents.getOSProcessId(),
      role: meta.role,
      route: routeOf(webContents),
    };
  }
}
