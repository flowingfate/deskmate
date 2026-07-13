
import { memo, useRef } from 'react';
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
import { atom } from '@/atom';
import { getConfirmationSettings } from '@/states/settings.atom';
import { persistApi } from '@/ipc/persist';

/**
 * inline-edit「重新生成」确认框（替代旧的 `chatInput:confirmInlineEditRequest` ↔
 * `chatInput:confirmInlineEditResult` 两段式 window 事件握手）。
 *
 * 这是一个 **imperative confirm atom**：`request(payload)` 内部 `Promise.withResolvers`
 * 把 resolve 存进 state，overlay 点确认/取消时 `resolve(true/false)` 并关框，
 * producer 侧变成 `const ok = await inlineEditConfirmAtom.useChange().request(payload)`。
 *
 * skip 逻辑（`inlineEditRegenerate.skipConfirmation`）在 `request` 里同步读
 * `getConfirmationSettings()` 判定——命中直接 resolve(true)，不弹框、不置 state。
 */

interface InlineEditConfirmState {
  open: boolean;
  title: string;
  description: string;
  dontAskAgain: boolean;
  resolver: ((confirmed: boolean) => void) | null;
}

const zeroState: InlineEditConfirmState = {
  open: false,
  title: '',
  description: '',
  dontAskAgain: false,
  resolver: null,
};

export const inlineEditConfirmAtom = atom(zeroState, (get, set) => {
  function request(payload: { title: string; description: string }): Promise<boolean> {
    if (getConfirmationSettings()?.inlineEditRegenerate?.skipConfirmation === true) {
      return Promise.resolve(true);
    }
    // 保险：若上一个请求还悬着（正常不该发生），先按取消收尾。
    get().resolver?.(false);

    const { promise, resolve } = Promise.withResolvers<boolean>();
    set({
      open: true,
      title: payload.title,
      description: payload.description,
      dontAskAgain: false,
      resolver: resolve,
    });
    return promise;
  }

  function setDontAskAgain(value: boolean) {
    set((prev) => ({ ...prev, dontAskAgain: value }));
  }

  function resolve(confirmed: boolean) {
    const prev = get();
    if (confirmed && prev.dontAskAgain) {
      void persistApi.updateConfirmationSettings({
        inlineEditRegenerate: {
          skipConfirmation: true,
        },
      });
    }
    prev.resolver?.(confirmed);
    set(zeroState);
  }

  return { request, setDontAskAgain, resolve };
});

function Overlay() {
  const [state, actions] = inlineEditConfirmAtom.use();
  const confirmActionRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open && state.open) {
          actions.resolve(false);
        }
      }}
    >
      <DialogContent className="max-w-md p-6" initialFocusRef={confirmActionRef}>
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-left">{state.title}</DialogTitle>
          <DialogDescription className="text-left leading-6">
            {state.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6 flex items-center justify-between gap-3 sm:flex-row sm:space-x-0">
          <label className="flex items-center gap-2.5 text-sm text-gray-600 select-none">
            <Checkbox
              checked={state.dontAskAgain}
              onCheckedChange={(checked) => actions.setDontAskAgain(!!checked)}
            />
            <span>Don&apos;t show this again</span>
          </label>
          <div className="flex items-center gap-2.5">
            <Button variant="outline" onClick={() => actions.resolve(false)}>
              Cancel
            </Button>
            <Button ref={confirmActionRef} onClick={() => actions.resolve(true)}>
              Confirm
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default memo(Overlay);
