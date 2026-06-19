import React from 'react';
import { FolderOpen, FileUp, FolderPlus, ClipboardPaste, Loader2, FolderClock, FolderDown } from 'lucide-react';

/** 拖拽悬停时覆盖在 section body 上的提示层 */
export const DropOverlay: React.FC<{ title: string }> = ({ title }) => (
  <div className="absolute inset-0 z-[1000] flex items-center justify-center p-3 pointer-events-none">
    <div className="absolute inset-2 rounded-2xl border-2 border-dashed border-border-strong bg-black/[0.03] backdrop-blur-[2px]" />
    <div className="relative flex flex-col items-center gap-2.5 text-center">
      <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-white shadow-[0_4px_16px_rgba(15,23,42,0.12)] text-content-secondary animate-bounce motion-reduce:animate-none">
        <FolderDown size={24} strokeWidth={1.75} />
      </div>
      <p className="m-0 text-[13px] font-semibold text-content-heading">
        Drop to copy into {title}
      </p>
    </div>
  </div>
);

/** 加载中状态 */
export const LoadingState: React.FC<{ title: string }> = ({ title }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
    <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-surface-subtle border border-border-subtle">
      <Loader2 size={20} className="text-content-secondary animate-spin motion-reduce:animate-none" />
    </div>
    <p className="m-0 text-xs font-medium text-content-secondary">
      Loading {title.toLowerCase()}…
    </p>
  </div>
);

/** workspacePath 尚未初始化 */
export const UninitializedState: React.FC<{ title: string }> = () => (
  <div className="flex flex-col items-center justify-center gap-4 py-12 px-6 text-center">
    <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-surface-subtle to-surface-secondary border border-border-subtle shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      <FolderClock size={26} strokeWidth={1.75} className="text-content-tertiary" />
    </div>
    <div className="flex flex-col gap-1 items-center">
      <p className="m-0 text-sm font-semibold text-content-heading">Workspace not ready yet</p>
      <p className="m-0 max-w-[220px] text-xs leading-relaxed text-content-secondary">
        Files generated during this chat will appear here automatically.
      </p>
    </div>
  </div>
);

export interface EmptyStateProps {
  emptyMessage?: string;
  readOnly?: boolean;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onOpenPaste: () => void;
}

/** 目录为空时的引导状态 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  emptyMessage,
  readOnly,
  onAddFiles,
  onAddFolder,
  onOpenPaste,
}) => (
  <div className="flex items-center justify-center w-full min-h-[220px] px-6 py-8">
    <div className="flex flex-col items-center gap-4 text-center max-w-[260px]">
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-surface-subtle to-surface-secondary border border-border-subtle shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
        <FolderOpen size={28} strokeWidth={1.75} className="text-content-tertiary" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-sm font-semibold leading-snug text-content-heading">
          {emptyMessage || 'Add documents, code, and images'}
        </p>
        {!emptyMessage && (
          <p className="m-0 text-xs leading-relaxed text-content-secondary">
            Drag and drop files anywhere in this panel.
          </p>
        )}
      </div>
      {!readOnly && (
        <div className="flex flex-col gap-2 w-full mt-1">
          <button
            type="button"
            onClick={onAddFiles}
            className="inline-flex items-center justify-center gap-2 h-9 w-full rounded-lg bg-content-heading text-white text-[13px] font-medium shadow-[0_1px_2px_rgba(15,23,42,0.12)] transition-colors hover:bg-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong/50"
          >
            <FileUp size={15} strokeWidth={1.75} />
            Add Files
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onAddFolder}
              className="inline-flex items-center justify-center gap-1.5 h-9 flex-1 rounded-lg border border-border bg-surface-primary text-[13px] font-medium text-content-heading transition-colors hover:bg-surface-subtle hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong/40"
            >
              <FolderPlus size={15} />
              Folder
            </button>
            <button
              type="button"
              onClick={onOpenPaste}
              className="inline-flex items-center justify-center gap-1.5 h-9 flex-1 rounded-lg border border-border bg-surface-primary text-[13px] font-medium text-content-heading transition-colors hover:bg-surface-subtle hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong/40"
            >
              <ClipboardPaste size={15} />
              Paste
            </button>
          </div>
        </div>
      )}
    </div>
  </div>
);
