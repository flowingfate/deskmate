import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import { APP_NAME } from '../../../shared/constants/branding';
import { mcpAuthApi, mcpAuthEvents } from '@/ipc/mcp';

const McpAuthConsentDialog: React.FC = () => {
  const [state, setState] = useState<{
    isOpen: boolean;
    requestId: string;
    serverName: string;
    providerLabel: string;
  }>({
    isOpen: false,
    requestId: '',
    serverName: '',
    providerLabel: 'Identity Provider',
  });
  const allowActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const cleanup = mcpAuthEvents.showConsent((_event, data) => {
      setState({
        isOpen: true,
        requestId: data.requestId,
        serverName: data.serverName,
        providerLabel: data.providerLabel,
      });
    });
    return () => cleanup();
  }, []);

  const handleResponse = useCallback(async (decision: 'cancel' | 'allow-this-time') => {
    const requestId = state.requestId;
    setState({ isOpen: false, requestId: '', serverName: '', providerLabel: 'Identity Provider' });
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