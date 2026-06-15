// src/renderer/components/chat/toolCallViews/WriteToolCallView.tsx
// Custom view component for the `write` tool

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { ToolCallViewProps, WriteToolArgs, WriteToolResult } from './types';
import FileTypeIcon from '../../ui/FileTypeIcon';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'avif']);

const isImageFile = (filePath: string): boolean => {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS.has(ext) : false;
};

/**
 * Domain ToolCall.args 已是结构化对象;直接用即可。`fileUri` 缺失时 view 会
 * 自己 early-return,与历史行为一致。
 */
const coerceWriteArgs = (args: Record<string, unknown> | undefined): WriteToolArgs | undefined => {
  if (!args) return undefined;
  return args as unknown as WriteToolArgs;
};

/**
 * Parse tool result content
 */
const parseToolResult = (content: string): WriteToolResult | null => {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

/**
 * Extract file name from path
 */
const getFileName = (filePath: string): string => {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};

/**
 * Open file in overlay viewer (image viewer for images, file viewer for others)
 */
const handleOpenFile = (filePath: string) => {
  const fileName = getFileName(filePath);
  if (isImageFile(filePath)) {
    // Open image in OverlayImageViewer
    window.dispatchEvent(
      new CustomEvent('imageViewer:open', {
        detail: {
          images: [{ id: `writefile-${filePath}`, url: filePath, alt: fileName }],
          initialIndex: 0,
        },
      }),
    );
  } else {
    // Open non-image in OverlayFileViewer
    window.dispatchEvent(
      new CustomEvent('fileViewer:open', {
        detail: {
          file: {
            name: fileName,
            url: filePath,
          },
        },
      }),
    );
  }
};

/**
 * Write File / Create File Tool Call custom view
 */
export const WriteToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  executionStatus,
}) => {
  const args = coerceWriteArgs(toolCall.args);
  const resultText = toolCall.response?.result ?? '';
  const result = resultText ? parseToolResult(resultText) : null;

  // If no arguments, don't render
  if (!args || !args.fileUri) {
    return null;
  }

  const isExecuting = executionStatus === 'executing';
  const isInterrupted = executionStatus === 'interrupted';
  const isSuccess = result?.success === true;
  const fileName = getFileName(args.fileUri);

  // If executing (streaming), show content preview
  if (isExecuting && args.content) {
    return (
      <div className="write-file-view">
        <div className="write-file-streaming-container">
          <div className="write-file-streaming-header">
            <FileTypeIcon fileName={fileName} size={16} className="write-file-icon" />
            <span className="write-file-filename">{fileName}</span>
            <span className="write-file-streaming-indicator">Writing...</span>
          </div>
          <div className="write-file-content-preview">
            <pre className="write-file-content-pre">{args.content}</pre>
          </div>
        </div>
      </div>
    );
  }

  if (isInterrupted) {
    return (
      <div className="write-file-view">
        <div className="write-file-error-container">
          <FileTypeIcon fileName={fileName} size={24} className="write-file-icon error" />
          <span className="write-file-filename">{fileName}</span>
          <span className="write-file-error-text">Interrupted before file write result was recorded</span>
        </div>
      </div>
    );
  }

  // After execution completes, show file link
  if (isSuccess && result) {
    return (
      <div className="write-file-view">
        <div
          className="write-file-success-container"
          onClick={() => handleOpenFile(result.fileUri)}
        >
          <div className="write-file-success-content">
            <FileTypeIcon fileName={fileName} size={24} className="write-file-icon" />
            <span className="write-file-filename">{fileName}</span>
          </div>
          <ExternalLink size={14} className="write-file-open-icon" />
        </div>
      </div>
    );
  }

  // Execution failed case
  if (result && !isSuccess) {
    return (
      <div className="write-file-view">
        <div className="write-file-error-container">
          <FileTypeIcon fileName={fileName} size={24} className="write-file-icon error" />
          <span className="write-file-filename">{fileName}</span>
          <span className="write-file-error-text">{result.error || 'Failed to write file'}</span>
        </div>
      </div>
    );
  }

  return null;
};

export default WriteToolCallView;
