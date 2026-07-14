import React, { useEffect, useRef, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shadcn/alert-dialog';

export interface ConfirmationRequest {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
}

interface PendingConfirmation extends ConfirmationRequest {
  resolve: (confirmed: boolean) => void;
}

type ConfirmationListener = (pending: PendingConfirmation | null) => void;

let pendingConfirmation: PendingConfirmation | null = null;
const listeners = new Set<ConfirmationListener>();

function notify(): void {
  listeners.forEach((listener) => listener(pendingConfirmation));
}

function settleConfirmation(confirmed: boolean): void {
  const pending = pendingConfirmation;
  if (!pending) return;
  pendingConfirmation = null;
  pending.resolve(confirmed);
  notify();
}

export function requestConfirmation(request: ConfirmationRequest): Promise<boolean> {
  settleConfirmation(false);

  return new Promise<boolean>((resolve) => {
    pendingConfirmation = { ...request, resolve };
    notify();
  });
}

export const ConfirmationDialogHost: React.FC = () => {
  const [pending, setPending] = useState<PendingConfirmation | null>(pendingConfirmation);
  const confirmActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const listener: ConfirmationListener = (nextPending) => setPending(nextPending);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) settleConfirmation(false);
      }}
    >
      <AlertDialogContent initialFocusRef={confirmActionRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settleConfirmation(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            ref={confirmActionRef}
            className={pending?.destructive ? 'bg-sc-destructive text-sc-destructive-foreground hover:bg-sc-destructive/90' : undefined}
            onClick={() => settleConfirmation(true)}
          >
            {pending?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
