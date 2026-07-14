import { Bug, Check, Copy } from 'lucide-react';
import { appApi } from '@/ipc/app';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { RibbonItem } from './RibbonItem';

interface DevInfoBadgeProps {
  agentId?: string | null;
  sessionId?: string | null;
}

interface DevInfoRow {
  key: string;
  label: string;
  value: string;
  display?: string;
}

export function DevInfoBadge({ agentId, sessionId }: DevInfoBadgeProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [appVersion, setAppVersion] = useState('1.15.6');

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

  const rows: DevInfoRow[] = [
    { key: 'version', label: 'Version', value: appVersion },
    ...(agentId ? [{ key: 'chat', label: 'Chat ID', value: agentId }] : []),
    ...(sessionId ? [{ key: 'session', label: 'Session ID', value: sessionId }] : []),
    ...(agentId && sessionId
      ? [{
          key: 'both',
          label: 'Copy IDs',
          value: `agent: ${agentId}\nsession: ${sessionId}`,
          display: 'agent + session',
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
            <div
              key={key}
              className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer transition-[background] duration-100 hover:bg-[#fafafa] not-first:border-t not-first:border-(--bg-secondary)"
              onClick={() => copyValue(key, value)}
            >
              <span className="text-[11px] font-medium text-content-tertiary whitespace-nowrap shrink-0">{label}</span>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-content-heading break-all text-right [&_svg]:shrink-0 [&_svg]:text-content-tertiary">
                <span>{display ?? value}</span>
                {copied === key ? <Check size={12} /> : <Copy size={12} />}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
