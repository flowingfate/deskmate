// web fetch 用的有界并发隐藏渲染池。
//
// 「一个 DOM + 一段注入提取器 → ExtractedContent」中负责 headless 的 DOM 来源：
// 渲染 URL（真实浏览器，JS 跑完）→ 等加载 settle → extractFromWebContents → 销毁。
//
// 安全/隐私（headless 比 raw fetch 更像真人，必须主动诚实）：
//   - 内存 partition（'agent-fetch'，无 persist: → 不落盘、cookie/cache 不跨 fetch 残留）。
//   - 不注入 Deskmate preload；sandbox:true；权限请求全 deny；拦下载。
//   - 默认 blockMedia：拦 image/media/font 省资源。
//   - 不绕 CAPTCHA / 风控 / 付费墙（与 web research 同原则）。

import { BrowserWindow, session } from 'electron';
import type { ExtractedContent } from '@shared/types/extractedContent';
import { extractFromWebContents } from './extractFromWebContents';

const PARTITION = 'agent-fetch';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_CONCURRENT = 3;
// did-finish-load 后再给 SPA 异步渲染一个短 settle 窗口。
const SETTLE_MS = 400;
// loadURL 正常重定向会以 ERR_ABORTED(-3) reject did-fail-load，不算失败。
const ERR_ABORTED = -3;

export interface RenderOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  blockMedia?: boolean;
}

class HeadlessRenderer {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private sessionConfigured = false;
  // 哪些 webContents 要拦媒体（per-render，因 partition session 是共享的）。
  private readonly blockingWcIds = new Set<number>();

  async renderAndExtract(url: string, opts: RenderOptions): Promise<ExtractedContent> {
    await this.acquireSlot();
    try {
      return await this.run(url, opts);
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.active < MAX_CONCURRENT) {
      this.active++;
      return Promise.resolve();
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    this.queue.push(() => {
      this.active++;
      resolve();
    });
    return promise;
  }

  private releaseSlot(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  private configureSession(): Electron.Session {
    const sess = session.fromPartition(PARTITION);
    if (this.sessionConfigured) return sess;
    this.sessionConfigured = true;

    sess.setUserAgent(USER_AGENT);
    sess.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    sess.setPermissionCheckHandler(() => false);
    sess.on('will-download', (event) => event.preventDefault());
    sess.webRequest.onBeforeRequest((details, callback) => {
      const wcId = details.webContentsId ?? -1;
      if (this.blockingWcIds.has(wcId)) {
        const type = details.resourceType;
        if (type === 'image' || type === 'media' || type === 'font') {
          callback({ cancel: true });
          return;
        }
      }
      callback({});
    });
    return sess;
  }

  private run(url: string, opts: RenderOptions): Promise<ExtractedContent> {
    const { promise, resolve, reject } = Promise.withResolvers<ExtractedContent>();
    this.configureSession();

    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: PARTITION,
        spellcheck: false,
      },
    });
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    const blockMedia = opts.blockMedia !== false;
    if (blockMedia) this.blockingWcIds.add(wc.id);

    let done = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      clearTimeout(timer);
      clearTimeout(settleTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      this.blockingWcIds.delete(wc.id);
      if (!win.isDestroyed()) win.destroy();
    };
    const fail = (message: string): void => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(message));
    };
    const succeed = (content: ExtractedContent): void => {
      if (done) return;
      done = true;
      cleanup();
      resolve(content);
    };

    const timer = setTimeout(() => fail(`Render timed out after ${opts.timeoutMs}ms`), opts.timeoutMs);
    const onAbort = (): void => fail('Fetch cancelled by user');
    if (opts.signal) {
      if (opts.signal.aborted) {
        // 已 abort：清理后立即拒绝。
        queueMicrotask(onAbort);
        return promise;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    wc.once('did-finish-load', () => {
      // 主文档加载完，再等一个短 settle 让 SPA 异步内容落定，然后注入提取。
      settleTimer = setTimeout(() => {
        if (done) return;
        extractFromWebContents(wc, { selectedTextOnly: false, sourceUrl: url })
          .then(succeed)
          .catch((error) => fail(error instanceof Error ? error.message : String(error)));
      }, SETTLE_MS);
    });

    wc.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame) return; // 子框架失败不致命
      if (errorCode === ERR_ABORTED) return; // 正常重定向
      fail(`Load failed (${errorCode}): ${errorDescription || 'unknown error'}`);
    });

    // loadURL 的 reject（含 ERR_ABORTED）由 did-fail-load 统一处理，这里吞掉。
    win.loadURL(url).catch(() => undefined);
    return promise;
  }
}

export const headlessRenderer = new HeadlessRenderer();
