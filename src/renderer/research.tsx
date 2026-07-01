import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  Globe2,
  Loader2,
  MousePointer2,
  Plus,
  RotateCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { researchApi, researchEvents } from '@/ipc/research';
import type { ResearchPageSnapshot, ResearchSessionSnapshot } from '@shared/ipc/research';
import { Button } from '@/shadcn/button';
import { cn } from '@/lib/utilities/utils';
import './styles/tokens/_index.scss';
import './styles/globals.css';

const requestId = new URLSearchParams(window.location.search).get('requestId') || '';

const ResearchApp = () => {
  const [snapshot, setSnapshot] = useState<ResearchSessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void researchApi.getSession(requestId).then((result) => {
      if (!mounted) return;
      if (result.success && result.snapshot) {
        setSnapshot(result.snapshot);
      } else {
        setError(result.error || 'Research session not found.');
      }
    });

    const cleanupUpdated = researchEvents.updated((_event, payload) => {
      if (payload.requestId !== requestId) return;
      setSnapshot(payload.snapshot);
    });
    const cleanupCompleted = researchEvents.completed((_event, payload) => {
      if (payload.requestId !== requestId) return;
      setSnapshot((current) => current ? { ...current, status: payload.response.action === 'submit' ? 'completed' : 'cancelled' } : current);
    });

    return () => {
      mounted = false;
      cleanupUpdated();
      cleanupCompleted();
    };
  }, []);

  const maxSources = snapshot?.request.maxSources ?? 5;
  const sources = snapshot?.sources ?? [];
  const tabs = snapshot?.tabs ?? [];
  const activePage = snapshot?.page;
  const canConfirm = sources.length > 0 && snapshot?.status === 'active';
  const sourceLimitReached = sources.length >= maxSources;

  const runAction = async (name: string, action: () => Promise<{ success: boolean; error?: string }>) => {
    setError(null);
    setBusyAction(name);
    try {
      const result = await action();
      if (!result.success) setError(result.error || 'Action failed.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div data-dbg="research-window" className="h-screen w-screen overflow-hidden bg-slate-50 text-slate-900">
      <header className="flex flex-col h-19 border-b border-slate-200 bg-white text-slate-900 shadow-sm">
        <div className="flex h-9 items-center gap-3 border-b border-slate-200 pl-24 pr-3 [-webkit-app-region:drag]">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
            <ShieldCheck size={14} className="text-slate-700" />
            <span>Human Research</span>
          </div>
          <div className="min-w-0 flex-1 truncate text-xs text-slate-500">{snapshot?.request.query || 'Preparing research session'}</div>
          <div className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
            {sources.length}/{maxSources} sources
          </div>
        </div>

        <div className="flex flex-1 items-end gap-1 bg-slate-50 px-3 pt-1 [-webkit-app-region:no-drag]">
          <div className="mb-1 mr-1 flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label="Go back"
              disabled={!activePage?.canGoBack}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-950 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none"
              onClick={() => void runAction('back', () => researchApi.goBack(requestId))}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              aria-label="Go forward"
              disabled={!activePage?.canGoForward}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-950 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none"
              onClick={() => void runAction('forward', () => researchApi.goForward(requestId))}
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              aria-label="Reload page"
              disabled={!activePage}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-950 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none"
              onClick={() => void runAction('reload', () => researchApi.reloadPage(requestId))}
            >
              <RotateCw size={14} className={cn(activePage?.loading && 'animate-spin')} />
            </button>
          </div>
          <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
          {tabs.map((tab, index) => {
            const active = tab.tabId === snapshot?.activeTabId;
            return (
              <div
                key={tab.tabId}
                className={cn(
                  'group flex h-8 min-w-0 max-w-60 items-center rounded-t-md border px-1.5 text-xs transition-colors',
                  active
                    ? 'border-slate-200 border-b-white bg-white text-slate-950 shadow-sm'
                    : 'border-transparent bg-slate-100/70 text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-950',
                )}
              >
                <button
                  type="button"
                  aria-label={`Activate research tab ${index + 1}`}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left"
                  onClick={() => void runAction('activate-tab', () => Promise.resolve(researchApi.activateTab(requestId, tab.tabId)))}
                >
                  {tab.loading ? <Loader2 size={13} className="shrink-0 animate-spin text-slate-700" /> : <Globe2 size={13} className="shrink-0" />}
                  <span className="truncate">{readablePageLabel(tab)}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Close research tab ${index + 1}`}
                  disabled={tabs.length <= 1}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate opacity-0 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-20 group-hover:opacity-100"
                  onClick={() => void runAction('close-tab', () => Promise.resolve(researchApi.closeTab(requestId, tab.tabId)))}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            aria-label="Open new research tab"
            className="mb-1 flex h-7 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-950 hover:shadow-sm"
            onClick={() => void runAction('new-tab', () => researchApi.createTab(requestId))}
          >
            <Plus size={15} />
          </button>
          </div>
        </div>
      </header>

      <main className="absolute bottom-0 left-0 right-105 top-19 bg-white">
        <div className="pointer-events-none flex h-full items-start justify-center p-6 text-xs text-slate-400">
          <div className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 shadow-sm">{activePage ? readablePageLabel(activePage) : 'Loading page...'}</div>
        </div>
      </main>

      <aside className="absolute bottom-0 right-0 top-19 flex w-105 flex-col border-l border-slate-200 bg-white shadow-[-18px_0_44px_-28px_rgba(15,23,42,0.55)]">
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-950">Sources</div>
              <div className="mt-1 text-xs text-slate-500">Add page or text that you want to reference in your research.</div>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-slate-300 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Current tab</div>
            <div className="mt-1 line-clamp-1 text-sm font-medium text-slate-900">{activePage ? readablePageLabel(activePage) : 'Loading page'}</div>
            <div className="mt-1 break-all text-xs text-slate-500">{activePage?.url || snapshot?.request.searchUrl || ''}</div>
          </div>

          {error && <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" disabled={busyAction === 'page' || sourceLimitReached} onClick={() => void runAction('page', () => researchApi.addCurrentPageAsSource(requestId))}>
              <FilePlus2 size={14} className="mr-1" />
              Add page
            </Button>
            <Button variant="outline" size="sm" disabled={busyAction === 'selection' || sourceLimitReached || !activePage?.hasSelection} title={!activePage?.hasSelection ? 'Select text on the page first' : undefined} onClick={() => void runAction('selection', () => researchApi.addSelectedTextAsSource(requestId))}>
              <MousePointer2 size={14} className="mr-1" />
              Add selected text
            </Button>
          </div>
          {sourceLimitReached && (
            <div className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
              Source limit reached. Remove one source before adding another.
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {sources.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-500">
              Keep the search results in one tab, open candidates in more tabs, then add the pages or selected snippets that should be cited.
            </div>
          ) : sources.map((source, index) => (
            <article key={source.sourceId} className="rounded-md border border-black/7 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-700">Source {index + 1} · {source.method} · {source.charCount} chars</div>
                  <div className="mt-1 line-clamp-2 text-sm font-semibold text-slate-950">{source.title}</div>
                  <div className="mt-1 break-all text-xs text-slate-500">{source.url}</div>
                </div>
                <Button className="shrink-0" variant="ghost" size="icon-xs" aria-label={`Remove source ${index + 1}`} onClick={() => void runAction('remove', () => researchApi.removeSource(requestId, source.sourceId))}>
                  <Trash2 size={12} />
                </Button>
              </div>
              <p className="mt-3 line-clamp-6 whitespace-pre-wrap text-xs leading-4 bg-slate-50/50 px-2 py-1 rounded overflow-y-auto">
                {source.markdown.slice(0, 700)}
              </p>
            </article>
          ))}
        </div>

        <footer className="border-t border-slate-200 p-4">
          <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            Confirming sends extracted source text to the current Agent/LLM. Check private, logged-in, localhost, or internal pages before confirming.
          </div>
          <div className="flex gap-2">
            <Button type="button" className="flex-1 bg-slate-950 text-white hover:bg-slate-800" disabled={!canConfirm || busyAction === 'confirm'} onClick={() => void runAction('confirm', () => Promise.resolve(researchApi.confirmRequest(requestId)))}>
              <Check size={16} />
              Confirm to Agent
            </Button>
            <Button type="button" variant="outline" onClick={() => void runAction('cancel', () => Promise.resolve(researchApi.cancelRequest(requestId)))}>
              <X size={16} />
              Cancel
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
};

function readablePageLabel(page: ResearchPageSnapshot): string {
  const title = page.title.trim();
  if (title.length > 0) return title;
  if (page.url.length === 0) return 'New tab';
  try {
    return new URL(page.url).hostname || page.url;
  } catch {
    return page.url;
  }
}

createRoot(document.getElementById('root')!).render(<ResearchApp />);
