import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { useToast } from '../../ui/ToastProvider';
import './InteractiveRequestCard.scss';
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
    <div className="interactive-request-card interactive-auth-card">
      <div className="interactive-request-header">
        <div className="interactive-request-title-wrap">
          <ShieldAlert size={18} className="interactive-request-icon" />
          <div>
            <div className="interactive-request-title">{request.title}</div>
            <div className="interactive-request-description">
              Complete the browser step before the command times out.
            </div>
          </div>
        </div>
        <div className="interactive-auth-timeout">Timeout in {formatRemainingTime(remainingMs)}</div>
      </div>

      <div className="interactive-request-section">
        {request.command ? (
          <div className="interactive-request-item">
            <div className="interactive-request-item-title">Command</div>
            <div className="interactive-request-path">{request.command}</div>
          </div>
        ) : null}

        {request.deviceCode ? (
          <div className="interactive-request-item">
            <div className="interactive-request-item-title">Device code</div>
            <div className="interactive-auth-code">{request.deviceCode}</div>
          </div>
        ) : null}

        {request.verificationUri ? (
          <div className="interactive-request-item">
            <div className="interactive-request-item-title">Verification link</div>
            <div className="interactive-request-path">{request.verificationUri}</div>
          </div>
        ) : null}
      </div>

      <div className="interactive-request-footer">
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
