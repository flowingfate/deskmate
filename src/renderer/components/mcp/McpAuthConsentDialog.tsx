import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import { mcpAuthApi, mcpAuthEvents } from '@/ipc/mcp';
import type { McpAuthConsentPayload } from '@shared/ipc/mcp';

interface ConsentDialogState {
  isOpen: boolean;
  requestId: string;
  serverName: string;
  providerLabel: string;
}

const EMPTY_STATE: ConsentDialogState = {
  isOpen: false,
  requestId: '',
  serverName: '',
  providerLabel: 'Identity Provider',
};

const McpAuthConsentDialog: React.FC = () => {
  const [state, setState] = useState<ConsentDialogState>(EMPTY_STATE);
  const queueRef = useRef<McpAuthConsentPayload[]>([]);
  const allowActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const cleanup = mcpAuthEvents.showConsent((_event, data) => {
      setState((current) => {
        if (!current.isOpen) {
          return { isOpen: true, ...data };
        }
        if (
          current.requestId === data.requestId
          || queueRef.current.some((request) => request.requestId === data.requestId)
        ) {
          return current;
        }
        queueRef.current.push(data);
        return current;
      });
    });
    return () => cleanup();
  }, []);

  const handleResponse = useCallback(async (decision: 'cancel' | 'allow-this-time') => {
    const requestId = state.requestId;
    const next = queueRef.current.shift();
    setState(next ? { isOpen: true, ...next } : EMPTY_STATE);
    await mcpAuthApi.respondConsent(requestId, decision);
  }, [state.requestId]);

  return (
    <Dialog
      open={state.isOpen}
      onOpenChange={(open) => { if (!open) handleResponse('cancel'); }}
    >
      <DialogContent className="max-w-md" initialFocusRef={allowActionRef}>
        <DialogHeader>
          <DialogTitle>Allow sign-in to {state.providerLabel}?</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            <strong>{state.serverName}</strong> wants to sign in to {state.providerLabel}
          </p>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Profile: <code>{window.electronAPI.profile.id}</code>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleResponse('cancel')}>
            Not now
          </Button>
          <Button ref={allowActionRef} onClick={() => handleResponse('allow-this-time')}>
            Allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default McpAuthConsentDialog;