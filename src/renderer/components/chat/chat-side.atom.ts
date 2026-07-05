import { atom } from '@/atom';
import { ChatFilePreviewAtom } from '../filePreview/filePreview.atom';

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
    const previewActions = use(ChatFilePreviewAtom)[1];
    previewActions.cancel();
    const current = get();
    set({ ...current, visible: !current.visible });
  }

  function effectiveReveal(path: string) {
    set({ visible: true, reveal: { path, nonce: Date.now() } });
  }

  return { setReveal, cancelReveal, setVisible, effectiveToggle, effectiveReveal };
});

