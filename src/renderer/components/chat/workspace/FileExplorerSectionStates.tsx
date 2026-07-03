import React from 'react';
import { FileUp, FolderPlus, ClipboardPaste, Loader2, FolderDown } from 'lucide-react';
import { EmptyBox } from '@/components/ui/empty-svg';

/**
 * 图标碟：白底圆碟 + 发丝描边，靠与背景的对比「浮」出来造深度（不靠阴影）。
 *
 * 插画替换点 —— 想换成品牌小插画时，把内部的 lucide 图标换成
 * `<img src={...} className="w-6 h-6" />` 或内联 `<svg>` 即可，圆碟容器保持不变。
 */
const IconDisc: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center justify-center w-12 h-12 rounded-full bg-surface-primary border border-border text-content-secondary">
    {/* 插画占位：稍后可替换为自定义 SVG / <img> */}
    {children}
  </div>
);

/** 拖拽悬停时覆盖在 section body 上的提示层 */
export const DropOverlay: React.FC<{ title: string }> = ({ title }) => (
  <div className="absolute inset-0 z-1000 flex items-center justify-center p-3 pointer-events-none">
    <div className="absolute inset-2 rounded-2xl border border-dashed border-accent/40 bg-white/70 backdrop-blur-xs" />
    <div className="relative flex flex-col items-center gap-3 text-center">
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-accent text-white animate-bounce motion-reduce:animate-none">
        <FolderDown size={22} strokeWidth={1.5} />
      </div>
      <p className="m-0 text-[13px] font-semibold tracking-tight text-content-strong">
        Drop to copy into {title}
      </p>
    </div>
  </div>
);

/** 加载中状态 */
export const LoadingState: React.FC<{ title: string }> = ({ title }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-10 px-6 text-center">
    <IconDisc>
      <Loader2 size={18} strokeWidth={1.75} className="animate-spin motion-reduce:animate-none" />
    </IconDisc>
    <p className="m-0 text-xs font-medium text-content-tertiary">
      Loading {title.toLowerCase()}…
    </p>
  </div>
);

/**
 * workspacePath 尚未初始化（read-only 系统目录用）。
 * 非投放区，不用虚线 well，保持安静紧凑。
 */
export const UninitializedState: React.FC<{ title: string }> = () => (
  <div className="flex flex-col items-center justify-center gap-3 py-8 px-6 text-center">
    <EmptyBox className="w-25 h-auto" />
    <div className="flex flex-col gap-1 items-center">
      <p className="m-0 text-[13px] font-semibold tracking-tight text-content-strong">No files yet</p>
      <p className="m-0 max-w-55 text-xs leading-relaxed text-content-tertiary">
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

/**
 * 目录为空时的引导状态。
 * 可写目录 → 渲染成一个「虚线 drop-well」，既填补空洞、又直接传达「可拖入文件」的语义。
 * 只读目录 → 无 well，安静的图标碟 + 说明。
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  emptyMessage,
  readOnly,
  onAddFiles,
  onAddFolder,
  onOpenPaste,
}) => {
  if (readOnly) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 px-6 text-center">
        <EmptyBox className="w-25 h-auto" />
        <p className="m-0 max-w-55 text-xs leading-relaxed text-content-tertiary">
          {emptyMessage || 'Nothing here yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full px-3 py-3">
      <div className="group/well flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-surface-subtle/50 px-5 py-6 text-center transition-colors hover:border-border-strong hover:bg-surface-subtle">
        <EmptyBox className="w-25 h-auto" />
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[13px] font-semibold leading-snug tracking-tight text-content-strong">
            {emptyMessage || 'Add documents, code, and images'}
          </p>
          <p className="m-0 text-xs leading-relaxed text-content-tertiary">
            Drag &amp; drop, or use the actions below.
          </p>
        </div>
        <div className="flex flex-col gap-2 w-full mt-0.5">
          <button
            type="button"
            onClick={onAddFiles}
            className="inline-flex items-center justify-center gap-2 h-9 w-full rounded-lg bg-accent text-white text-[13px] font-medium transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-1"
          >
            <FileUp size={15} strokeWidth={1.75} />
            Add Files
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onAddFolder}
              className="inline-flex items-center justify-center gap-1.5 h-9 flex-1 rounded-lg border border-border bg-surface-primary text-[13px] font-medium text-content-secondary transition-colors hover:text-content-strong hover:bg-surface-subtle hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong/30"
            >
              <FolderPlus size={15} strokeWidth={1.75} />
              Folder
            </button>
            <button
              type="button"
              onClick={onOpenPaste}
              className="inline-flex items-center justify-center gap-1.5 h-9 flex-1 rounded-lg border border-border bg-surface-primary text-[13px] font-medium text-content-secondary transition-colors hover:text-content-strong hover:bg-surface-subtle hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong/30"
            >
              <ClipboardPaste size={15} strokeWidth={1.75} />
              Paste
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
