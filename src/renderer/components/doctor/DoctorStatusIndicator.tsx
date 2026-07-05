import React from 'react';
import { CheckCircle2, AlertTriangle, Loader2, ExternalLink, X } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/shadcn/tooltip';
import { Popover, PopoverTrigger, PopoverContent } from '@/shadcn/popover';
import { doctorAnalyzeAtom } from '@/states/doctor.atom';
import AgentQuestionForm from './AgentQuestionForm';
import { doctor_icon } from './Icon';
import { useHoverIntent, useAutoWindow } from './doctorIndicatorHooks';

const TOOLTIP_AUTO_MS = 2000;
const HOVER_GRACE_MS = 140;

const DoctorStatusIndicator: React.FC = () => {
  const [analyze, actions] = doctorAnalyzeAtom.use();
  // ① hover 意图（含宽限期）；② step 变化时自动闪出 tooltip 2s。
  const { hovered, enter, leave } = useHoverIntent(HOVER_GRACE_MS);
  const autoTooltipActive = useAutoWindow(analyze.step?.at, TOOLTIP_AUTO_MS);

  if (analyze.status === 'idle') return null;

  const isLoading =
    analyze.status === 'pending' ||
    analyze.status === 'analyzing' ||
    analyze.status === 'creating_issue' ||
    analyze.status === 'waiting_for_user';
  const isDone = analyze.status === 'done';
  const isError = analyze.status === 'error';

  // 终端态（done/error）只在 hover 时提示；运行态额外支持「新 step 自动闪 2s」。
  const terminalTooltip = isDone
    ? 'Diagnosis complete and reported'
    : isError
      ? (analyze.error || 'An error occurred during diagnosis')
      : null;
  const tooltipText = terminalTooltip ?? analyze.step?.info ?? null;
  const tooltipVisible =
    !analyze.question &&
    !!tooltipText &&
    (terminalTooltip ? hovered : (autoTooltipActive || hovered));
  const popoverVisible = !!analyze.question;

  // done 且带回 issueUrl 时额外给出 View Issue 按钮。
  const issueUrl = analyze.status === 'done' ? analyze.issueUrl : undefined;

  const triggerButton = (
    <span
      onMouseEnter={enter}
      onMouseLeave={leave}
      aria-label={analyze.step?.info || 'Doctor running'}
      data-dbg="doctor-status-indicator"
      className="inline-flex items-center gap-1 cursor-default px-1 hover:bg-black/10"
    >
      {isLoading && <><Loader2 size={12} className="animate-spin text-neutral-500" /><span className="text-neutral-500">doctor: running</span></>}
      {isDone && <><CheckCircle2 size={12} className="text-emerald-500" strokeWidth={2.25} /><span className="text-emerald-500">doctor: done</span></>}
      {isError && <><AlertTriangle size={12} className="text-red-500" strokeWidth={2.25} /><span className="text-red-500">doctor: error</span></>}
    </span>
  );

  return (
    <TooltipProvider delayDuration={0}>
      <Popover open={popoverVisible}>
        <Tooltip open={tooltipVisible && !popoverVisible}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              {triggerButton}
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            onMouseEnter={enter}
            onMouseLeave={leave}
            className="relative max-w-70 border-0 bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg flex flex-col items-center gap-1"
          >
            <button
              type="button"
              onClick={actions.dismiss}
              aria-label="Dismiss"
              className="absolute right-1 top-1 rounded p-0.5 text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <X size={12} />
            </button>
            {doctor_icon}
            <span className="text-center leading-snug">{tooltipText}</span>
            {issueUrl && (
              <button
                type="button"
                onClick={() => {
                  window.open(issueUrl, '_blank', 'noopener,noreferrer');
                  actions.dismiss();
                }}
                className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-500 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-400 cursor-pointer"
              >
                <ExternalLink size={12} />
                View Issue
              </button>
            )}
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          side="top"
          align="start"
          className="w-85 p-0 border-0 bg-transparent shadow-none"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {analyze.question && (
            <AgentQuestionForm payload={analyze.question} />
          )}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
};

export default DoctorStatusIndicator;
