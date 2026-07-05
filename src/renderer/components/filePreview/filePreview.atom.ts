import { atom } from '@/atom';
import { FilePreviewDescriptor } from './FilePreviewPanel';

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
    function cancel() {
      set(null);
    }

    function open(file: FilePreviewDescriptor) {
      const current = get();
      if (!current) {
        return set({ file, isDirty: false });
      }

      const prevKey = `${current.file.name}|${current.file.url}`;
      const nextKey = `${file.name}|${file.url}`;

      // 同一文件 = toggle
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
}

/** 聊天页 inline 预览(满铺 chat-content)。 */
export const ChatFilePreviewAtom = createFilePreviewAtom();

/** 全局兜底预览(居中弹窗,非聊天场景)。 */
export const GlobalFilePreviewAtom = createFilePreviewAtom();
