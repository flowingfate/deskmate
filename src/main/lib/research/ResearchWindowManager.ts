import { BrowserWindow, WebContentsView } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mainToRender, type ResearchActionResult, type ResearchActiveResult, type ResearchPageSnapshot, type ResearchSessionSnapshot, type ResearchSnapshotResult, type ResearchSourceResult } from '@shared/ipc/research';
import type {
  InteractiveSearchEngine,
  InteractiveSearchInteractionRequest,
  InteractiveSearchInteractionResponse,
  InteractiveSearchSource,
} from '@shared/types/interactiveRequestTypes';
import { PRELOAD_PATH } from '@main/lib/buildPaths';
import { createWindow, mainWebContents } from '@main/startup/wins';
import { log } from '@main/log';
import { crashRecorder } from '@main/lib/crash-recorder';
import { extractLivePage } from './extractLivePage';

const DEV_SERVER_PORT = process.env.DEV_SERVER_PORT || '39017';
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL || `http://localhost:${DEV_SERVER_PORT}`;
const IS_DEV = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const CHROME_HEIGHT = 76;
const SIDEBAR_WIDTH = 420;
const MAX_SOURCES = 8;
// 防御性上限：用户可自由发起 research（不自动开窗），但 pending 队列
// 不应被失控的 agent 循环无限堆积。正常 2-3 个 session 远到不了这里。
const MAX_PENDING_REQUESTS = 16;

// 选区标记桥：唯一前缀，main 据此从 console-message 中识别选区信号。
const SELECTION_MARKER = '__deskmate_selection__';
// 注入到外部页面 view：监听 selectionchange，仅在「有/无选区」布尔翻转时
// 通过 console.debug 上报（不含选区内容），main 侧据此启用/禁用「Add selected text」。
const SELECTION_PROBE_SCRIPT = `(() => {
  if (window.__deskmateSelectionProbe) return;
  window.__deskmateSelectionProbe = true;
  let last = null;
  const report = () => {
    const has = !!(window.getSelection && window.getSelection().toString().trim());
    if (has === last) return;
    last = has;
    console.debug('${SELECTION_MARKER}' + (has ? '1' : '0'));
  };
  document.addEventListener('selectionchange', report, { passive: true });
  report();
})()`;

interface ResearchPageTab {
  tabId: string;
  view: WebContentsView;
  createdAt: number;
  hasSelection: boolean;
}

// 已发起但尚未开窗的请求：card 已渲染、等用户点击「开始研究」。
interface PendingResearchRequest {
  request: InteractiveSearchInteractionRequest;
  eventSender: Electron.WebContents;
}

interface ActiveResearchSession {
  request: InteractiveSearchInteractionRequest;
  eventSender: Electron.WebContents;
  window: BrowserWindow;
  tabs: ResearchPageTab[];
  activeTabId: string;
  sources: InteractiveSearchSource[];
  status: ResearchSessionSnapshot['status'];
  addInFlight: boolean;
}

class ResearchWindowManager {
  private active: ActiveResearchSession | null = null;
  private readonly pending = new Map<string, PendingResearchRequest>();

  registerPending(
    request: InteractiveSearchInteractionRequest,
    eventSender: Electron.WebContents,
  ): ResearchActionResult {
    if (this.active?.request.callId === request.callId) return { success: true };
    if (this.pending.has(request.callId)) return { success: true };
    const total = this.pending.size + (this.active ? 1 : 0);
    if (total >= MAX_PENDING_REQUESTS) {
      return { success: false, error: `Too many interactive searches awaiting the user (max ${MAX_PENDING_REQUESTS}).` };
    }
    this.pending.set(request.callId, { request, eventSender });
    return { success: true };
  }

  getActiveRequestId(): ResearchActiveResult {
    return { success: true, activeRequestId: this.currentActiveId() };
  }

  // 用户在 chat 卡片点击「开始研究」时才真正开窗：把 pending 请求提升为 active。
  // 单飞由这里强校验（UI 仅做置灰提示）：已有 active 时拒绝开第二个。
  async startRequest(requestId: string): Promise<ResearchActionResult> {
    if (this.active && this.active.status === 'active' && !this.active.window.isDestroyed()) {
      if (this.active.request.callId === requestId) {
        this.active.window.show();
        this.active.window.focus();
        this.activeTab(this.active).view.webContents.focus();
        return { success: true };
      }
      return { success: false, error: 'Another interactive search is already active. Finish it first.' };
    }

    const pending = this.pending.get(requestId);
    if (!pending) return { success: false, error: 'Interactive search request not found or already completed.' };
    this.pending.delete(requestId);

    try {
      await this.openWindowForSession(pending.request, pending.eventSender);
      this.broadcastActive();
      return { success: true };
    } catch (error) {
      // 开窗失败：把请求退回 pending，用户可在 card 重试「开始研究」。
      this.pending.set(requestId, pending);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async openWindowForSession(
    request: InteractiveSearchInteractionRequest,
    eventSender: Electron.WebContents,
  ): Promise<void> {
    const win = createWindow({
      width: 1440,
      height: 900,
      minWidth: 1120,
      minHeight: 680,
      show: false,
      title: 'Deskmate Research',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : process.platform === 'win32' ? 'hidden' : 'default',
      trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 14 } : undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: PRELOAD_PATH.research,
        sandbox: false,
        spellcheck: false,
      },
    }, { role: 'research', tag: request.callId });

    const active: ActiveResearchSession = {
      request,
      eventSender,
      window: win,
      tabs: [],
      activeTabId: '',
      sources: [],
      status: 'active',
      addInFlight: false,
    };
    this.active = active;

    const updateBounds = () => {
      if (!this.active || this.active.window !== win || win.isDestroyed()) return;
      this.updateTabLayout(this.active);
    };

    win.on('resize', updateBounds);
    win.on('close', () => {
      for (const tab of active.tabs) {
        crashRecorder.markWebContentsExpectedTermination(tab.view.webContents);
      }
    });
    win.on('closed', () => {
      if (this.active?.window === win && this.active.status === 'active') {
        this.completeRequest(request.callId, 'cancel');
      }
      if (this.active?.window === win) {
        this.clearActive();
      }
    });

    try {
      const initialTab = this.createPageTab(active);
      active.tabs.push(initialTab);
      active.activeTabId = initialTab.tabId;
      this.updateTabLayout(active);

      // research chrome 加载失败是致命的（窗口没有 UI），向上抛出由 startRequest 退回 pending。
      await this.loadResearchChrome(win, request.callId);
      // 外部搜索页 load 失败不致命：safeLoadURL 吞错，页面自身错误页交给用户重试。
      await this.safeLoadURL(initialTab.view.webContents, request.searchUrl);
      win.show();
      win.focus();
      this.updateTabLayout(active);
      this.notifyUpdated(request.callId);
    } catch (error) {
      // 开窗中途失败：清理半开窗口与 active，避免「僵死 active」永久卡死单飞。
      active.status = 'cancelled';
      if (this.active === active) this.active = null;
      if (!win.isDestroyed()) win.destroy();
      throw error;
    }
  }

  getSession(requestId: string): ResearchSnapshotResult {
    const active = this.requireSession(requestId);
    if (active) return { success: true, snapshot: this.snapshot(active) };
    if (this.pending.has(requestId)) return { success: true };
    return { success: false, error: 'Interactive search session not found.' };
  }

  focusRequest(requestId: string): ResearchActionResult {
    const active = this.requireSession(requestId);
    if (!active) return { success: false, error: 'Interactive search session not found.' };
    if (active.window.isMinimized()) active.window.restore();
    active.window.show();
    active.window.focus();
    this.activeTab(active).view.webContents.focus();
    return { success: true };
  }

  focusPageView(requestId: string): ResearchActionResult {
    const active = this.requireSession(requestId);
    if (!active) return { success: false, error: 'Interactive search session not found.' };
    this.activeTab(active).view.webContents.focus();
    return { success: true };
  }

  async createTab(requestId: string): Promise<ResearchSnapshotResult> {
    const active = this.requireSession(requestId);
    if (!active) return { success: false, error: 'Interactive search session not found.' };

    await this.appendTab(active, active.request.searchUrl);
    return { success: true, snapshot: this.snapshot(active) };
  }

  activateTab(requestId: string, tabId: string): ResearchSnapshotResult {
    const active = this.requireSession(requestId);
    if (!active) return { success: false, error: 'Interactive search session not found.' };
    const tab = active.tabs.find((item) => item.tabId === tabId);
    if (!tab) return { success: false, error: 'Research tab not found.' };
    active.activeTabId = tabId;
    this.updateTabLayout(active);
    this.notifyUpdated(requestId);
    tab.view.webContents.focus();
    return { success: true, snapshot: this.snapshot(active) };
  }

  closeTab(requestId: string, tabId: string): ResearchSnapshotResult {
    const active = this.requireSession(requestId);
    if (!active) return { success: false, error: 'Interactive search session not found.' };
    if (active.tabs.length <= 1) return { success: false, error: 'At least one research tab must stay open.' };

    const tabIndex = active.tabs.findIndex((item) => item.tabId === tabId);
    if (tabIndex < 0) return { success: false, error: 'Research tab not found.' };

    const [removed] = active.tabs.splice(tabIndex, 1);
    active.window.contentView.removeChildView(removed.view);
    crashRecorder.markWebContentsExpectedTermination(removed.view.webContents);
    removed.view.webContents.close({ waitForBeforeUnload: false });

    if (active.activeTabId === tabId) {
      const nextIndex = Math.min(tabIndex, active.tabs.length - 1);
      active.activeTabId = active.tabs[nextIndex].tabId;
    }

    this.updateTabLayout(active);
    this.notifyUpdated(requestId);
    this.activeTab(active).view.webContents.focus();
    return { success: true, snapshot: this.snapshot(active) };
  }

  async navigateSearch(
    requestId: string,
    query: string,
    engine: InteractiveSearchEngine,
    openInNewTab = false,
  ): Promise<ResearchActionResult> {
    const active = this.requireSession(requestId);
    if (!active) return { success: false, error: 'Interactive search session not found.' };
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) return { success: false, error: 'Search query is required.' };

    const searchUrl = buildSearchUrl(trimmedQuery, engine);
    if (openInNewTab) {
      await this.appendTab(active, searchUrl);
      return { success: true };
    }

    await this.safeLoadURL(this.activeTab(active).view.webContents, searchUrl);
    return { success: true };
  }

  goBack(requestId: string): ResearchActionResult {
    const active = this.requireSession(requestId);
    if (!active) return { success: false, error: 'Interactive search session not found.' };
    const wc = this.activeTab(active).view.webContents;
    if (wc.canGoBack()) wc.goBack();
    return { success: true };
  }

  goForward(requestId: string): ResearchActionResult {
    const active = this.requireSession(requestId);
    if (!active) return { success: false, error: 'Interactive search session not found.' };
    const wc = this.activeTab(active).view.webContents;
    if (wc.canGoForward()) wc.goForward();
    return { success: true };
  }

  reloadPage(requestId: string): ResearchActionResult {
    const active = this.requireSession(requestId);
    if (!active) return { success: false, error: 'Interactive search session not found.' };
    this.activeTab(active).view.webContents.reload();
    return { success: true };
  }

  async addCurrentPageAsSource(requestId: string): Promise<ResearchSourceResult> {
    return this.addSource(requestId, false);
  }

  async addSelectedTextAsSource(requestId: string): Promise<ResearchSourceResult> {
    return this.addSource(requestId, true);
  }

  removeSource(requestId: string, sourceId: string): ResearchSnapshotResult {
    const active = this.requireSession(requestId);
    if (!active) return { success: false, error: 'Interactive search session not found.' };
    active.sources = active.sources.filter((source) => source.sourceId !== sourceId);
    this.notifyUpdated(requestId);
    return { success: true, snapshot: this.snapshot(active) };
  }

  reorderSources(requestId: string, sourceIds: string[]): ResearchSnapshotResult {
    const active = this.requireSession(requestId);
    if (!active) return { success: false, error: 'Interactive search session not found.' };
    const byId = new Map(active.sources.map((source) => [source.sourceId, source]));
    const reordered = sourceIds
      .map((sourceId) => byId.get(sourceId))
      .filter((source): source is InteractiveSearchSource => Boolean(source));
    const seen = new Set(reordered.map((source) => source.sourceId));
    for (const source of active.sources) {
      if (!seen.has(source.sourceId)) reordered.push(source);
    }
    active.sources = reordered;
    this.notifyUpdated(requestId);
    return { success: true, snapshot: this.snapshot(active) };
  }

  confirmRequest(requestId: string): ResearchActionResult {
    const active = this.requireSession(requestId);
    if (!active) return { success: false, error: 'Interactive search session not found.' };
    if (active.sources.length === 0) return { success: false, error: 'Add at least one source before confirming.' };
    this.completeRequest(requestId, 'submit');
    return { success: true };
  }

  cancelRequest(requestId: string): ResearchActionResult {
    if (this.active && this.active.request.callId === requestId) {
      this.completeRequest(requestId, 'cancel');
      return { success: true };
    }
    // 还在 pending（窗口未开）就取消：摘除并通知 chat 渲染器，让 task 以 cancel 收束。
    const pending = this.pending.get(requestId);
    if (pending) {
      this.pending.delete(requestId);
      if (!pending.eventSender.isDestroyed()) {
        mainToRender.bindWebContents(pending.eventSender).completed({
          requestId,
          response: { action: 'cancel', sources: [] },
        });
      }
      return { success: true };
    }
    return { success: false, error: 'Interactive search session not found.' };
  }

  finishRequest(requestId: string): void {
    this.pending.delete(requestId);
    const active = this.requireSession(requestId);
    if (!active) return;
    if (!active.window.isDestroyed()) active.window.close();
    this.clearActive();
  }

  private createPageTab(active: ActiveResearchSession): ResearchPageTab {
    const tab: ResearchPageTab = {
      tabId: `tab_${randomUUID()}`,
      view: new WebContentsView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          partition: 'persist:agent-search',
          spellcheck: false,
        },
      }),
      createdAt: Date.now(),
      hasSelection: false,
    };

    active.window.contentView.addChildView(tab.view);
    crashRecorder.registerWebContents(tab.view.webContents, {
      windowId: active.window.id,
      role: 'research',
    });
    tab.view.webContents.setWindowOpenHandler(({ url }) => {
      void this.openUrlInNewTab(active.request.callId, url);
      return { action: 'deny' };
    });

    const notify = () => this.notifyUpdated(active.request.callId);
    tab.view.webContents.on('did-start-loading', notify);
    tab.view.webContents.on('did-stop-loading', notify);
    tab.view.webContents.on('page-title-updated', notify);
    tab.view.webContents.on('did-navigate', notify);
    tab.view.webContents.on('did-navigate-in-page', notify);

    // 选区存在性回传：页面 view 无 Deskmate preload，用单向 console 标记桥把
    // 「当前是否有选区」(布尔，不含选区内容) 报回 main。注入脚本只在布尔翻转时
    // 输出，避免拖拽时的 console 风暴；导航后选区清空，重置为 false。
    tab.view.webContents.on('did-finish-load', () => {
      tab.hasSelection = false;
      void tab.view.webContents.executeJavaScript(SELECTION_PROBE_SCRIPT, true).catch(() => undefined);
    });
    tab.view.webContents.on('console-message', (details) => {
      if (!details.message.startsWith(SELECTION_MARKER)) return;
      const next = details.message.endsWith('1');
      if (next === tab.hasSelection) return;
      tab.hasSelection = next;
      if (tab.tabId === active.activeTabId) this.notifyUpdated(active.request.callId);
    });

    return tab;
  }

  private async openUrlInNewTab(requestId: string, url: string): Promise<void> {
    const active = this.requireSession(requestId);
    if (!active) return;
    await this.appendTab(active, url);
  }

  // 新建 tab 并加载 url：push、设为 active、立即刷快照（即时显示新 tab），
  // 再 safeLoadURL（吞 ERR_ABORTED 等），最后聚焦。createTab/navigateSearch/openUrlInNewTab 共用。
  private async appendTab(active: ActiveResearchSession, url: string): Promise<ResearchPageTab> {
    const tab = this.createPageTab(active);
    active.tabs.push(tab);
    active.activeTabId = tab.tabId;
    this.updateTabLayout(active);
    this.notifyUpdated(active.request.callId);
    await this.safeLoadURL(tab.view.webContents, url);
    tab.view.webContents.focus();
    return tab;
  }

  // 外部页面导航：吞掉 ERR_ABORTED（页面自身重定向/被后续导航取代时 loadURL 会
  // reject，属正常）与其它 load 失败（页面会渲染错误页，用户可重试），不向上抛。
  private async safeLoadURL(wc: Electron.WebContents, url: string): Promise<void> {
    try {
      await wc.loadURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ERR_ABORTED')) return;
      log.warn({ msg: `[research] loadURL failed: ${url} (${message})`, mod: 'research' });
    }
  }

  private updateTabLayout(active: ActiveResearchSession): void {
    if (active.window.isDestroyed()) return;
    const bounds = active.window.getContentBounds();
    const viewBounds = {
      x: 0,
      y: CHROME_HEIGHT,
      width: Math.max(360, bounds.width - SIDEBAR_WIDTH),
      height: Math.max(240, bounds.height - CHROME_HEIGHT),
    };

    for (const tab of active.tabs) {
      tab.view.setBounds(viewBounds);
      tab.view.setVisible(tab.tabId === active.activeTabId);
    }
  }

  private async addSource(requestId: string, selectedTextOnly: boolean): Promise<ResearchSourceResult> {
    const active = this.requireSession(requestId);
    if (!active) return { success: false, error: 'Interactive search session not found.' };
    if (active.addInFlight) {
      return { success: false, error: 'Still adding the previous source, please wait.' };
    }
    if (active.sources.length >= Math.min(MAX_SOURCES, active.request.maxSources)) {
      return { success: false, error: `Source limit reached (${active.request.maxSources}).` };
    }

    active.addInFlight = true;
    try {
      const source = await extractLivePage(this.activeTab(active).view.webContents, { selectedTextOnly });
      // 整页来源按归一化 URL 去重：同一页面只允许添加一次。
      // 选区来源不去重——同页不同选区是合法的独立 source。
      if (!selectedTextOnly) {
        const normalized = normalizeSourceUrl(source.url);
        const duplicate = active.sources.some(
          (existing) => existing.method !== 'selection' && normalizeSourceUrl(existing.url) === normalized,
        );
        if (duplicate) {
          return { success: false, error: 'This page is already added as a source.' };
        }
      }
      active.sources.push(source);
      this.notifyUpdated(requestId);
      return { success: true, source, snapshot: this.snapshot(active) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      active.addInFlight = false;
    }
  }

  private completeRequest(requestId: string, action: InteractiveSearchInteractionResponse['action']): void {
    const active = this.requireSession(requestId);
    if (!active) return;
    if (active.status !== 'active') return;

    active.status = action === 'submit' ? 'completed' : 'cancelled';
    this.broadcastActive();
    const response: InteractiveSearchInteractionResponse = {
      action,
      sources: action === 'submit' ? [...active.sources] : [],
    };
    if (!active.eventSender.isDestroyed()) {
      mainToRender.bindWebContents(active.eventSender).completed({ requestId, response });
    }
    if (!active.window.isDestroyed()) {
      mainToRender.bindWebContents(active.window.webContents).completed({ requestId, response });
      setTimeout(() => {
        if (!active.window.isDestroyed()) active.window.close();
      }, 120);
    }
  }

  private notifyUpdated(requestId: string): void {
    const active = this.requireSession(requestId);
    if (!active) return;
    const snapshot = this.snapshot(active);
    if (!active.eventSender.isDestroyed()) {
      mainToRender.bindWebContents(active.eventSender).updated({ requestId, snapshot });
    }
    if (!active.window.isDestroyed()) {
      mainToRender.bindWebContents(active.window.webContents).updated({ requestId, snapshot });
    }
  }

  private currentActiveId(): string | null {
    return this.active && this.active.status === 'active' ? this.active.request.callId : null;
  }

  private clearActive(): void {
    if (!this.active) return;
    this.active = null;
    this.broadcastActive();
  }

  // 单飞信号：active 变化时广播给 chat 渲染器（main window），
  // 让所有 session 的 SearchCard 即时切换 start/waiting 态。
  private broadcastActive(): void {
    const wc = mainWebContents();
    if (!wc || wc.isDestroyed()) return;
    mainToRender.bindWebContents(wc).activeChanged({ activeRequestId: this.currentActiveId() });
  }

  private requireSession(requestId: string): ActiveResearchSession | null {
    if (!this.active || this.active.request.callId !== requestId) return null;
    return this.active;
  }

  private activeTab(active: ActiveResearchSession): ResearchPageTab {
    return active.tabs.find((tab) => tab.tabId === active.activeTabId) || active.tabs[0];
  }

  private snapshot(active: ActiveResearchSession): ResearchSessionSnapshot {
    const tabs = active.tabs.map((tab) => this.snapshotTab(tab));
    const activePage = tabs.find((tab) => tab.tabId === active.activeTabId) || tabs[0];
    return {
      request: active.request,
      sources: [...active.sources],
      tabs,
      activeTabId: active.activeTabId,
      status: active.status,
      page: activePage,
    };
  }

  private snapshotTab(tab: ResearchPageTab): ResearchPageSnapshot {
    const wc = tab.view.webContents;
    return {
      tabId: tab.tabId,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      loading: wc.isLoading(),
      hasSelection: tab.hasSelection,
    };
  }

  private async loadResearchChrome(win: BrowserWindow, requestId: string): Promise<void> {
    if (IS_DEV) {
      await win.loadURL(`${DEV_SERVER_URL}/research.html?requestId=${encodeURIComponent(requestId)}`);
      return;
    }

    const htmlPath = path.join(__dirname, '../renderer/research.html');
    await win.loadFile(htmlPath, { query: { requestId } });
  }
}

export const researchWindowManager = new ResearchWindowManager();

export function buildSearchUrl(query: string, engine: InteractiveSearchEngine): string {
  const encoded = encodeURIComponent(query);
  if (engine === 'baidu') return `https://www.baidu.com/s?wd=${encoded}`;
  return `https://www.bing.com/search?q=${encoded}`;
}

// 归一化用于整页去重：去掉 hash 片段（#section 不构成新页面），
// 解析失败时回退到 trim 后的原始串。
function normalizeSourceUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}
