import { memo } from 'react';
import { FilePreviewPanel } from './FilePreviewPanel';
import { ChatFilePreviewAtom } from './filePreview.atom';

/**
 * 聊天页 inline 文件预览浮层 —— 满铺 chat-content 区(连 ComposeInput 一起遮住)。
 * 触发源:聊天子树里的 producer 经 `useOpenFilePreview()`(在 `ChatFilePreviewScope` 内绑定
 * 到 `ChatFilePreviewAtom`)命令式打开;不再监听全局 `fileViewer:open` 事件。
 */
function ChatFilePreviewOverlay() {
  const [preview, actions] = ChatFilePreviewAtom.use();

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
