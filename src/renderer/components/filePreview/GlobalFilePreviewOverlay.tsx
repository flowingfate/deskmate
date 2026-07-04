import { memo } from 'react';
import { Dialog, DialogContent } from '@/shadcn/dialog';
import { FilePreviewPanel } from './FilePreviewPanel';
import { GlobalFilePreviewAtom } from './filePreview.atom';
import { useFilePreviewEvent } from './useFilePreviewEvent';

export interface GlobalFilePreviewOverlayProps {
  /** 命中可安装 skill 产物时，Install Skill 按钮回调。 */
  onInstallSkill?: (filePath: string) => void;
}

/**
 * 全局兜底文件预览 —— 居中弹窗(非聊天场景:agent 编辑器知识库、工作区侧栏等)。
 * 监听同一 `fileViewer:open` 事件;聊天页 inline 预览在场时经 coordinator 让出。
 * 复用与聊天页完全一致的 `FilePreviewPanel`,仅外壳换成 shadcn Dialog 居中浮层。
 */
function GlobalFilePreviewOverlay({ onInstallSkill }: GlobalFilePreviewOverlayProps) {
  const [preview, actions] = GlobalFilePreviewAtom.use();

  useFilePreviewEvent({ open: actions.open, isChat: false });

  const handleOpenChange = (open: boolean) => {
    if (!open) actions.cancel();
  };

  return (
    <Dialog open={!!preview} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        className="file-preview-dialog max-w-none p-0 gap-0 border-0 bg-transparent shadow-none overflow-visible flex items-center justify-center"
        onInteractOutside={(e) => { e.preventDefault(); actions.cancel(); }}
      >
        {preview && (
          <div className="file-preview-dialog-frame overflow-hidden rounded-lg w-[80vw] max-w-300 h-[85vh]" data-dbg="global-file-preview-overlay">
            <FilePreviewPanel
              file={preview.file}
              isOpen
              onClose={actions.cancel}
              onDirtyStateChange={actions.markDirty}
              onInstallSkill={onInstallSkill}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default memo(GlobalFilePreviewOverlay);
