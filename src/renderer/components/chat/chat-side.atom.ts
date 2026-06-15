import { atom } from '@/atom';
import { InlineFileDescriptor } from './InlineFilePreviewPanel';

const zeroWorkspaceExplorerState: {
  visible: boolean;
  reveal?: { path: string; nonce: number };
} = { visible: false };

export const WorkspaceExplorerAtom = atom(zeroWorkspaceExplorerState, (get, set, use) => {
  function setReveal(path: string) {
    set({ ...get(), reveal: { path, nonce: Date.now() } });
  }
  function cancelReveal() {
    set({ ...get(), reveal: undefined });
  }
  function setVisible(visible: boolean) {
    set({ ...get(), visible });
  }

  function effectiveToggle() {
    const inlinePreviewActions = use(InlinePreviewAtom)[1];
    inlinePreviewActions.cancel();
    const current = get();
    set({ ...current, visible: !current.visible });
  }

  function effectiveReveal(path: string) {
    set({ visible: true, reveal: { path, nonce: Date.now() } });
  }

  return { setReveal, cancelReveal, setVisible, effectiveToggle, effectiveReveal };
});


interface InlinePreviewState {
  isDirty: boolean;
  file: InlineFileDescriptor;
}

export const InlinePreviewAtom = atom(null as InlinePreviewState | null, (get, set) => {
  function cancel() {
    set(null);
  }

  function open(file: InlineFileDescriptor) {
    const current = get();
    if (!current) {
      return set({ file, isDirty: false });
    }

    const prevKey = `${current.file.name}|${current.file.url}`;
    const nextKey = `${file.name}|${file.url}`;

    // behave as toggle
    if (prevKey === nextKey) {
      if (current.isDirty) {
        const discard = window.confirm('You have unsaved changes in the current preview. Do you want to discard them and open another file?');
        if (discard) set(null);
        return;
      }
      return set(null);
    }

    if (current.isDirty) {
      const discard = window.confirm('You have unsaved changes in the current preview. Do you want to discard them and open another file?');
      if (!discard) return;
    }
    set({ file, isDirty: false });
  }

  function markDirty(isDirty: boolean) {
    const current = get();
    if (current && current.isDirty !== isDirty) {
      set({ ...current, isDirty });
    }
  }

  return { cancel, open, markDirty };
});
