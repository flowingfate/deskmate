import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { useToast } from '../../ui/ToastProvider';
import { PendingInteractiveRequestMap } from '@renderer/lib/chat/session-manager';

const formatRemainingTime = (remainingMs: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const InteractiveAuthCard = (props: {
  data: PendingInteractiveRequestMap['device-auth'];
}) => {
  const { id, request, task } = props.data;
  const { showToast } = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const remainingMs = Math.max(0, request.startedAt + request.timeoutMs - now);

  if (dismissed || remainingMs <= 0) {
    return null;
  }

  const handleCopyDeviceCode = async () => {
    if (!request.deviceCode) return;

    try {
      await navigator.clipboard.writeText(request.deviceCode);
      showToast('Device code copied', 'success');
    } catch {
      showToast('Failed to copy device code', 'error');
    }
  };

  const handleOpenVerificationUri = () => {
    if (!request.verificationUri) return;
    window.open(request.verificationUri, '_blank', 'noopener,noreferrer');
  };

  const handleCancel = () => {
    setDismissed(true);
    task.resolve({
      action: 'cancel',
    });
  };

  return (
    <div className="mt-2 p-4">
      <div className="flex items-start justify-between gap-3 max-[720px]:flex-col">
        <div className="flex items-start gap-2.5">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-neutral-700" />
          <div>
            <div className="text-[15px] font-semibold text-slate-900">{request.title}</div>
            <div className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
              Complete the browser step before the command times out.
            </div>
          </div>
        </div>
        <div className="whitespace-nowrap text-xs font-semibold text-neutral-700">
          Timeout in {formatRemainingTime(remainingMs)}
        </div>
      </div>

      <div className="mt-3.5 flex flex-col gap-3">
        {request.command ? (
          <div className="rounded-2xl border border-slate-300/50 bg-white/90 p-3">
            <div className="text-sm font-semibold text-slate-900">Command</div>
            <div className="mt-2 break-all rounded-lg bg-slate-100/80 px-2.5 py-2 text-xs text-slate-800">
              {request.command}
            </div>
          </div>
        ) : null}

        {request.deviceCode ? (
          <div className="rounded-2xl border border-slate-300/50 bg-white/90 p-3">
            <div className="text-sm font-semibold text-slate-900">Device code</div>
            <div className="mt-2 rounded-lg border border-neutral-600/20 bg-neutral-50/90 px-3 py-2.5 font-mono text-lg font-bold tracking-[0.08em] text-neutral-900">
              {request.deviceCode}
            </div>
          </div>
        ) : null}

        {request.verificationUri ? (
          <div className="rounded-2xl border border-slate-300/50 bg-white/90 p-3">
            <div className="text-sm font-semibold text-slate-900">Verification link</div>
            <div className="mt-2 break-all rounded-lg bg-slate-100/80 px-2.5 py-2 text-xs text-slate-800">
              {request.verificationUri}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2 max-[720px]:[&_button]:flex-1">
        {request.verificationUri ? (
          <Button variant="default" size="sm" onClick={handleOpenVerificationUri}>
            Open Link
          </Button>
        ) : null}
        {request.deviceCode ? (
          <Button variant="outline" size="sm" onClick={handleCopyDeviceCode}>
            Copy Device Code
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default InteractiveAuthCard;
