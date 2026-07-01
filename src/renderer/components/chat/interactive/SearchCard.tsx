import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { researchApi, researchEvents } from '@/ipc/research';
import type { ResearchSessionSnapshot } from '@shared/ipc/research';
import type { PendingInteractiveRequestMap } from '@renderer/lib/chat/session-manager';


const InteractiveSearchCard = (props: {
  data: PendingInteractiveRequestMap['interactive-search'];
}) => {
  const { id, request, task } = props.data;
  const [snapshot, setSnapshot] = useState<ResearchSessionSnapshot | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void researchApi.getSession(id).then((result) => {
      if (!mounted) return;
      if (result.success && result.snapshot) setSnapshot(result.snapshot);
    });
    void researchApi.getActiveRequestId().then((result) => {
      if (!mounted) return;
      if (result.success) setActiveRequestId(result.activeRequestId);
    });

    const cleanupUpdated = researchEvents.updated((_event, payload) => {
      if (payload.requestId === id) setSnapshot(payload.snapshot);
    });
    const cleanupActive = researchEvents.activeChanged((_event, payload) => {
      setActiveRequestId(payload.activeRequestId);
    });
    const cleanupCompleted = researchEvents.completed((_event, payload) => {
      if (payload.requestId === id && task.isPending) task.resolve(payload.response);
    });

    return () => {
      mounted = false;
      cleanupUpdated();
      cleanupActive();
      cleanupCompleted();
    };
  }, [id, task]);

  // 软件单飞：本卡片是否就是当前打开的研究，以及是否有「别的」研究占着窗口。
  const isActive = activeRequestId === id;
  const isAnotherActive = activeRequestId !== null && activeRequestId !== id;

  const sourceCount = snapshot?.sources.length ?? 0;
  const currentPage = useMemo(() => {
    if (!snapshot?.page?.url) return request.searchUrl;
    return snapshot.page.title ? `${snapshot.page.title} — ${snapshot.page.url}` : snapshot.page.url;
  }, [request.searchUrl, snapshot?.page?.title, snapshot?.page?.url]);

  const startResearch = async () => {
    setError(null);
    setStarting(true);
    const result = await researchApi.startRequest(id);
    setStarting(false);
    if (!result.success) setError(result.error || 'Failed to open research window.');
  };

  const focusResearchWindow = async () => {
    setError(null);
    const result = await researchApi.focusRequest(id);
    if (!result.success) setError(result.error || 'Failed to focus research window.');
  };

  const cancelRequest = async () => {
    setError(null);
    const result = await researchApi.cancelRequest(id);
    if (!result.success) {
      setError(result.error || 'Failed to cancel interactive search.');
      return;
    }
    if (task.isPending) task.resolve({ action: 'cancel', sources: [] });
  };

  return (
    <div className="mt-2 p-4">
      <div className="flex items-start justify-between gap-3 max-[720px]:flex-col">
        <div className="flex items-start gap-2.5">
          <Search size={18} className="mt-0.5 shrink-0 text-teal-700" />
          <div>
            <div className="text-[15px] font-semibold text-slate-900">Agent needs source selection</div>
            <div className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
              {isActive
                ? 'Select and confirm web sources in the research window.'
                : 'Open the research window, then select and confirm web sources.'}
            </div>
          </div>
        </div>
        <div className="whitespace-nowrap text-xs font-semibold text-teal-700">
          {request.engine} · {sourceCount}/{request.maxSources}
        </div>
      </div>

      <div className="mt-3.5 flex flex-col gap-3">
        <div className="rounded-2xl border border-slate-300/50 bg-white/90 p-3">
          <div className="text-sm font-semibold text-slate-900">Query</div>
          <div className="mt-2 break-all rounded-lg bg-slate-100/80 px-2.5 py-2 text-xs text-slate-800">
            {request.query}
          </div>
        </div>
        {isActive ? (
          <div className="rounded-2xl border border-slate-300/50 bg-white/90 p-3">
            <div className="text-sm font-semibold text-slate-900">Current page</div>
            <div className="mt-2 break-all rounded-lg bg-slate-100/80 px-2.5 py-2 text-xs text-slate-800">
              {currentPage}
            </div>
          </div>
        ) : null}
        {isAnotherActive ? (
          <div className="rounded-lg bg-amber-50/80 px-2.5 py-2 text-xs leading-snug text-amber-800">
            Another research window is open. Finish or cancel it before starting this one.
          </div>
        ) : null}
        {error ? (
          <div className="rounded-lg bg-rose-50/70 px-2.5 py-2 text-xs leading-snug text-rose-700">{error}</div>
        ) : null}
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2 max-[720px]:[&_button]:flex-1">
        {isActive ? (
          <Button variant="default" size="sm" onClick={focusResearchWindow}>
            Focus Research Window
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            disabled={isAnotherActive || starting}
            onClick={startResearch}
          >
            Start Research
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={cancelRequest}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default InteractiveSearchCard;
