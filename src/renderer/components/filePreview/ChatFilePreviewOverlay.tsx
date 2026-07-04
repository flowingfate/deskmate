import { memo } from 'react';
import { FilePreviewPanel } from './FilePreviewPanel';
import { ChatFilePreviewAtom } from './filePreview.atom';
import { useFilePreviewEvent } from './useFilePreviewEvent';

/**
 * 聊天页 inline 文件预览浮层 —— 满铺 chat-content 区(连 ComposeInput 一起遮住)。
 * 触发源:任意位置 `dispatchEvent(new CustomEvent('fileViewer:open', { detail: { file } }))`。
 * 挂载期占用 coordinator,让全局兜底容器 `GlobalFilePreviewOverlay` 让出,避免同一事件被两处消费。
 */
function ChatFilePreviewOverlay() {
  const [preview, actions] = ChatFilePreviewAtom.use();

  useFilePreviewEvent({ open: actions.open, isChat: true });

  if (!preview) return null;

  return (
    <div className="absolute inset-0 z-10 flex bg-white" data-dbg="chat-file-preview-overlay">
      <FilePreviewPanel
        file={preview.file}
        isOpen
        onClose={actions.cancel}
        onDirtyStateChange={actions.markDirty}
      />
    </div>
  );
}

export default memo(ChatFilePreviewOverlay);
