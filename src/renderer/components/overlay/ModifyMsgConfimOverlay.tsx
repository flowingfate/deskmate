
import { useCallback, useEffect, useState, memo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import { Checkbox } from '@/shadcn/checkbox';
import { useConfirmationSettings } from '@/states/settings.atom';
import { persistApi } from '@/ipc/persist';

function Overlay() {
  const [inlineEditConfirmState, setInlineEditConfirmState] = useState<{
    open: boolean;
    requestId: string | null;
    title: string;
    description: string;
    dontAskAgain: boolean;
  }>({
    open: false,
    requestId: null,
    title: '',
    description: '',
    dontAskAgain: false,
  });
  const confirmation = useConfirmationSettings();

  const skipInlineEditRegenerateConfirm =
    confirmation?.inlineEditRegenerate?.skipConfirmation === true;

  const resolveInlineEditConfirm = useCallback((confirmed: boolean) => {
    setInlineEditConfirmState((prev) => {
      if (prev.requestId) {
        window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditResult', {
          detail: {
            requestId: prev.requestId,
            confirmed,
          },
        }));
      }

      if (confirmed && prev.dontAskAgain) {
        void persistApi.updateConfirmationSettings({
          inlineEditRegenerate: {
            skipConfirmation: true,
          },
        });
      }

      return {
        open: false,
        requestId: null,
        title: '',
        description: '',
        dontAskAgain: false,
      };
    });
  }, []);

  useEffect(() => {
    const handleInlineEditConfirmRequest = (event: Event) => {
      const customEvent = event as CustomEvent<{
        requestId?: string;
        title?: string;
        description?: string;
      }>;

      if (!customEvent.detail?.requestId) {
        return;
      }

      if (skipInlineEditRegenerateConfirm) {
        window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditResult', {
          detail: {
            requestId: customEvent.detail.requestId,
            confirmed: true,
          },
        }));
        return;
      }

      setInlineEditConfirmState({
        open: true,
        requestId: customEvent.detail.requestId,
        title: customEvent.detail.title || 'Confirm action',
        description: customEvent.detail.description || '',
        dontAskAgain: false,
      });
    };

    window.addEventListener(
      'chatInput:confirmInlineEditRequest',
      handleInlineEditConfirmRequest as EventListener,
    );

    return () => {
      window.removeEventListener(
        'chatInput:confirmInlineEditRequest',
        handleInlineEditConfirmRequest as EventListener,
      );
    };
  }, [skipInlineEditRegenerateConfirm]);

  return (
    <Dialog
      open={inlineEditConfirmState.open}
      onOpenChange={(open) => {
        if (!open && inlineEditConfirmState.open) {
          resolveInlineEditConfirm(false);
        }
      }}
    >
      <DialogContent className="max-w-md p-6">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-left">{inlineEditConfirmState.title}</DialogTitle>
          <DialogDescription className="text-left leading-6">
            {inlineEditConfirmState.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6 flex items-center justify-between gap-3 sm:flex-row sm:space-x-0">
          <label className="flex items-center gap-2.5 text-sm text-gray-600 select-none">
            <Checkbox
              checked={inlineEditConfirmState.dontAskAgain}
              onCheckedChange={(checked) => {
                setInlineEditConfirmState((prev) => ({
                  ...prev,
                  dontAskAgain: !!checked,
                }));
              }}
            />
            <span>Don&apos;t show this again</span>
          </label>
          <div className="flex items-center gap-2.5">
            <Button variant="outline" onClick={() => resolveInlineEditConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => resolveInlineEditConfirm(true)}>
              Confirm
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default memo(Overlay);
