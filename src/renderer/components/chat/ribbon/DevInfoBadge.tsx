import { Bug, Check, Copy } from 'lucide-react';
import { appApi } from '@/ipc/app';
import { useSchedulesByAgentId } from '@/states/schedules.atom';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { RibbonItem } from './RibbonItem';

interface DevInfoRow {
  key: string;
  label: string;
  value: string;
  display?: string;
}


interface DevInfoBadgeProps {
  agentId: string;
  jobId: string | null;
  sessionId: string | null;
}

export function DevInfoBadge({ agentId, jobId, sessionId }: DevInfoBadgeProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [appVersion, setAppVersion] = useState('1.15.6');
  const scheduleJob = useSchedulesByAgentId(agentId).find(({ id }) => id === jobId);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;

    appApi.getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('1.15.6'));
  }, []);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const copyValue = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const identifiers = [
    `agent: ${agentId}`,
    jobId ? `job: ${jobId}` : null,
    sessionId ? `session: ${sessionId}` : null,
  ].filter((value): value is string => value !== null);
  const rows: DevInfoRow[] = [
    { key: 'version', label: 'Version', value: appVersion },
    { key: 'agent', label: 'Agent ID', value: agentId },
    ...(jobId
      ? [{
          key: 'job',
          label: 'Schedule',
          value: jobId,
          display: scheduleJob?.id,
        }]
      : []),
    ...(sessionId ? [{ key: 'session', label: 'Session ID', value: sessionId }] : []),
    ...(identifiers.length > 1
      ? [{
          key: 'identifiers',
          label: 'Copy IDs',
          value: identifiers.join('\n'),
          display: identifiers.map((value) => value.split(':', 1)[0]).join(' + '),
        }]
      : []),
  ];

  return (
    <div className="relative flex shrink-0 self-stretch" ref={ref}>
      <RibbonItem
        isActive={open}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Development information"
        tooltip="Development information"
        onClick={() => setOpen((value) => !value)}
      >
        <Bug size={14} strokeWidth={1.75} aria-hidden="true" />
      </RibbonItem>
      {open && (
        <div className="absolute right-0 bottom-[calc(100%+6px)] z-1000 min-w-52 overflow-hidden rounded-lg border border-border bg-white shadow-[0_4px_16px_rgba(0,0,0,0.1)]">
          {rows.map(({ key, label, value, display }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left cursor-pointer transition-[background] duration-100 hover:bg-[#fafafa] focus-visible:outline-none focus-visible:bg-[#fafafa] not-first:border-t not-first:border-(--bg-secondary)"
              onClick={() => copyValue(key, value)}
            >
              <span className="text-[11px] font-medium text-content-tertiary whitespace-nowrap shrink-0">{label}</span>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-content-heading break-all text-right [&_svg]:shrink-0 [&_svg]:text-content-tertiary">
                <span>{display ?? value}</span>
                {copied === key ? <Check size={12} /> : <Copy size={12} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
