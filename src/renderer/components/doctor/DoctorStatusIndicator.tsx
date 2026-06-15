import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/shadcn/tooltip';
import { Popover, PopoverTrigger, PopoverContent } from '@/shadcn/popover';
import { doctorAnalyzeAtom } from '@/states/doctor.atom';
import AgentQuestionForm from './AgentQuestionForm';
import { doctor_icon } from './Icon';

const TOOLTIP_AUTO_MS = 2000;

const DoctorStatusIndicator: React.FC = () => {
  const [analyze, actions] = doctorAnalyzeAtom.use();
  const [hovered, setHovered] = useState(false);
  const [autoTooltipUntil, setAutoTooltipUntil] = useState(0);
  const [, force] = useState(0);

  useEffect(() => {
    if (!analyze.step) return;
    setAutoTooltipUntil(analyze.step.at + TOOLTIP_AUTO_MS);
    const timer = setTimeout(() => force((n) => n + 1), TOOLTIP_AUTO_MS);
    return () => clearTimeout(timer);
  }, [analyze.step?.at]);

  if (analyze.status === 'idle') return null;

  const isLoading =
    analyze.status === 'pending' ||
    analyze.status === 'analyzing' ||
    analyze.status === 'creating_issue' ||
    analyze.status === 'waiting_for_user';
  const isDone = analyze.status === 'done';
  const isError = analyze.status === 'error';

  const showAutoTooltip = Date.now() < autoTooltipUntil;
  const terminalTooltip = isDone
    ? 'Diagnosis complete and reported'
    : isError
      ? (analyze.error || 'An error occurred during diagnosis')
      : null;
  const tooltipText = terminalTooltip ?? analyze.step?.info ?? null;
  const tooltipVisible =
    !analyze.question &&
    !!tooltipText &&
    (terminalTooltip ? hovered : (showAutoTooltip || hovered));
  const popoverVisible = !!analyze.question;

  const onClick = () => {
    if (isDone || isError) {
      actions.dismiss();
    }
  };

  const clickable = isDone || isError;

  const triggerButton = (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={analyze.step?.info || 'Doctor running'}
      data-dbg="doctor-status-indicator"
      className={`inline-flex items-center gap-1 ${
        clickable ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      {isLoading && <><Loader2 size={12} className="animate-spin text-blue-500" /><span className="text-blue-500">doctor: running</span></>}
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
            className="max-w-[280px] border-0 bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg pointer-events-none flex flex-col items-center gap-1"
          >
            {doctor_icon}
            <span className="text-center leading-snug">{tooltipText}</span>
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          side="top"
          align="start"
          className="w-[340px] p-0 border-0 bg-transparent shadow-none"
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
