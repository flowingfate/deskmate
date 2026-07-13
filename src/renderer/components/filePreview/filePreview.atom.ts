import { atom } from '@/atom';
import { FilePreviewDescriptor } from './FilePreviewPanel';
import { requestConfirmation } from '@/components/ui/ConfirmationDialog';

interface FilePreviewState {
  isDirty: boolean;
  file: FilePreviewDescriptor;
}

/**
 * 文件预览 atom 工厂 —— 聊天页与全局各建一个独立实例,互不干扰。
 *
 * `open` 行为:同一文件再点 = toggle 关闭;切到别的文件时若当前有未保存改动,
 * 弹 confirm 让用户决定丢弃。`markDirty` 由 `FilePreviewPanel` 的 `onDirtyStateChange` 回填。
 */
function createFilePreviewAtom() {
  return atom(null as FilePreviewState | null, (get, set) => {
    async function cancel(): Promise<void> {
      const current = get();
      if (current?.isDirty) {
        const discard = await requestConfirmation({
          title: 'Discard unsaved changes?',
          description: 'You have unsaved changes in the current preview. Do you want to discard them?',
          confirmLabel: 'Discard changes',
          destructive: true,
        });
        if (!discard) return;
      }
      set(null);
    }

    async function open(file: FilePreviewDescriptor): Promise<void> {
      const current = get();
      if (!current) {
        set({ file, isDirty: false });
        return;
      }

      const prevKey = `${current.file.name}|${current.file.url}`;
      const nextKey = `${file.name}|${file.url}`;
      const isSameFile = prevKey === nextKey;

      if (current.isDirty) {
        const discard = await requestConfirmation({
          title: 'Discard unsaved changes?',
          description: isSameFile
            ? 'You have unsaved changes in the current preview. Do you want to discard them and close the preview?'
            : 'You have unsaved changes in the current preview. Do you want to discard them and open another file?',
          confirmLabel: 'Discard changes',
          destructive: true,
        });
        if (!discard) return;
      }

      if (isSameFile) {
        set(null);
        return;
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
}

/** 聊天页 inline 预览(满铺 chat-content)。 */
export const ChatFilePreviewAtom = createFilePreviewAtom();

/** 全局兜底预览(居中弹窗,非聊天场景)。 */
export const GlobalFilePreviewAtom = createFilePreviewAtom();
