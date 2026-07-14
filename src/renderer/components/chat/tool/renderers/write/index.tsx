// src/renderer/components/chat/tool/renderers/write/index.tsx
// `write` 工具的 ToolRenderer —— 文件路径输入 / 可点击文件卡片输出。
//
// slot 划分:
//   inputArgsText      : 细粒度 input,只展示 fileUri(替代 JSON dump)
//   OutputSuccessBlock : 成功时展示可点击的文件卡片(打开预览)
// chip / executing / interrupted / failed 走默认。

import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { ToolCall } from '@shared/persist/types'
import type {
  ToolRenderer,
  ToolOutputSuccessSlotProps,
  WriteToolArgs,
  WriteToolResult,
} from '../../types';
import FileTypeIcon from '../../../../ui/FileTypeIcon';
import { useCurrentSession } from '@/states/currentSession.atom';
import { toImageDisplaySrc, type MediaUrlContext } from '@/lib/mediaUrl';
import { ImageViewerAtom } from '../../../../ui/OverlayImageViewer';
import { useOpenFilePreview } from '../../../../filePreview/filePreviewScope';
import type { FilePreviewDescriptor } from '../../../../filePreview/FilePreviewPanel';

const coerceWriteArgs = (args: Record<string, unknown> | undefined): WriteToolArgs | null => {
  if (!args || typeof (args as unknown as WriteToolArgs).fileUri !== 'string') return null;
  return args as unknown as WriteToolArgs;
};

const parseWriteResult = (content: string): WriteToolResult | null => {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const getFileName = (filePath: string): string => {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
};

const IMAGE_EXT: Record<string, true> = {
  png: true, jpg: true, jpeg: true, gif: true, bmp: true, webp: true,
  svg: true, ico: true, tiff: true, tif: true, avif: true,
};
const isImage = (name: string): boolean => {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext ? IMAGE_EXT[ext] === true : false;
};

const handleOpenFile = (
  filePath: string,
  ctx: MediaUrlContext,
  openImage: (images: { id: string; url: string; alt?: string }[], index: number) => void,
  openFile: (file: FilePreviewDescriptor) => void,
) => {
  const name = getFileName(filePath);
  if (isImage(name)) {
    // write 目标是 `local://` / `knowledge://` URI → `media://` 直供;裸路径 → `file://`。
    const src = toImageDisplaySrc(filePath, ctx);
    openImage([{ id: filePath, url: src, alt: name }], 0);
    return;
  }
  openFile({ name, url: filePath });
};

const inputArgsText = (toolCall: ToolCall): string => {
  const args = coerceWriteArgs(toolCall.args);
  return args ? args.fileUri : '';
};


const OutputSuccessBlock: React.FC<ToolOutputSuccessSlotProps> = ({ toolCall, result }) => {
  // hooks 必须在任何 early-return 前调用。
  const { agentId, chatSessionId } = useCurrentSession();
  const mediaCtx: MediaUrlContext = { agentId, sessionId: chatSessionId };
  const imageViewer = ImageViewerAtom.useChange();
  const openFilePreview = useOpenFilePreview();
  const parsed = parseWriteResult(result);
  if (!parsed || parsed.success !== true) {
    return (
      <pre className="m-0 px-2.5 py-2 rounded-[4px] bg-gray-50 border-1 border-black/7 font-mono text-[11.5px] whitespace-pre-wrap">
        {result}
      </pre>
    );
  }
  const args = coerceWriteArgs(toolCall.args);
  const fileUri = parsed.fileUri || args?.fileUri || '';
  const fileName = getFileName(fileUri);
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-[4px] bg-gray-50 border-1 border-black/7 cursor-pointer hover:bg-gray-100 transition-colors"
      onClick={() => handleOpenFile(fileUri, mediaCtx, imageViewer.open, openFilePreview)}
    >
      <FileTypeIcon fileName={fileName} size={20} />
      <span className="flex-1 min-w-0 truncate font-mono text-[12px] text-gray-800">
        {fileName}
      </span>
      <ExternalLink size={14} className="text-gray-400 shrink-0" />
    </div>
  );
};

export const writeRenderer: ToolRenderer = {
  inputArgsText,
  OutputSuccessBlock,
};
