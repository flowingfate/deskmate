import { useState, useRef, useCallback } from 'react';
import { screenshotApi } from '@/ipc/screenshot-main';
import { fsApi } from '@/ipc/fs';
import { validateImageFile } from '@shared/types/chatTypes';
import { FileProcessor } from '@/lib/utilities/contentUtils';
import { type FileWithSource } from '@/lib/attachment/copyToSandbox';
import { log } from '@/log';
const logger = log.child({ mod: 'FileHandling' });

function getFileTypeFromPath(filePath: string): string {
  const extension = filePath.toLowerCase().split('.').pop() || '';
  const mimeMap: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'js': 'text/javascript',
    'ts': 'text/typescript',
    'json': 'application/json',
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return mimeMap[extension] || 'application/octet-stream';
}

interface AttachmentManagerLike {
  addImage: (file: File) => Promise<void>;
  addFile: (file: File) => Promise<void>;
  addOffice: (file: File) => Promise<void>;
  addOthers: (file: File) => Promise<void>;
}

interface UseFileHandlingOptions {
  attachmentManager: AttachmentManagerLike;
  supportsImages: boolean;
  disabled?: boolean;
}

export function useFileHandling({ attachmentManager, supportsImages, disabled = false }: UseFileHandlingOptions) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = useCallback(async (file: FileWithSource) => {
    if (!validateImageFile(file)) {
      alert('Unsupported image format. Please select a PNG, JPEG, GIF, WEBP, or BMP image.');
      return;
    }

    setIsProcessing(true);
    try {
      // 草稿态:不在 attach 阶段判别/落盘。「内联 vs 落 sandbox」由发送时的
      // processImage IPC 在 main 用 sharp 按【解码尺寸】算一次(见 Attachments.finalize)。
      await attachmentManager.addImage(file);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.startsWith('DUPLICATE:')) {
        alert(`This file is already attached: ${file.name}`);
      } else {
        logger.error({ msg: `handleImageSelect error for ${file.name}:`, err: error });
        alert(`Failed to attach image: ${msg}`);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [attachmentManager]);

  const handleFileSelect = useCallback(async (file: FileWithSource) => {
    logger.debug({ msg: "handleFileSelect called:", name: file.name, type: file.type, size: file.size, fullPath: file.fullPath, isOffice: FileProcessor.isOfficeFile(file), isText: FileProcessor.isTextFile(file) });

    setIsProcessing(true);
    try {
      if (FileProcessor.isOfficeFile(file)) {
        await attachmentManager.addOffice(file);
      } else if (FileProcessor.isTextFile(file)) {
        await attachmentManager.addFile(file);
      } else {
        await attachmentManager.addOthers(file);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.startsWith('DUPLICATE:')) {
        alert(`This file is already attached: ${file.name}`);
      } else {
        logger.error({ msg: `handleFileSelect error for ${file.name}:`, err: error });
        alert(`Failed to attach file: ${msg}`);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [attachmentManager]);

  const resolveFilePath = useCallback((file: FileWithSource): string | undefined => {
    let resolvedPath: string | undefined;
    if (window.electronAPI?.fs?.getPathForFile) {
      try {
        resolvedPath = window.electronAPI.fs.getPathForFile(file);
      } catch (err) {
        logger.warn({ msg: "webUtils.getPathForFile failed:", err: err });
      }
    }
    if (!resolvedPath) {
      const electronPath = Reflect.get(file, 'path');
      if (typeof electronPath === 'string' && electronPath.length > 0) {
        resolvedPath = electronPath;
      }
    }
    if (resolvedPath) {
      file.fullPath = resolvedPath;
    }
    return resolvedPath;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
  }, [disabled]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setIsDragOver(false);
    }
  }, [disabled]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    if (disabled) {
      e.preventDefault();
      setIsDragOver(false);
      return;
    }
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      resolveFilePath(file);
    }

    const imageFiles = files.filter((file) => FileProcessor.isImageFile(file));
    const textFiles = files.filter((file) => FileProcessor.isTextFile(file));
    const officeFiles = files.filter((file) => FileProcessor.isOfficeFile(file));
    const otherFiles = files.filter((file) => FileProcessor.isOthersFile(file));

    if (imageFiles.length > 0 && supportsImages) {
      for (const file of imageFiles) {
        if (validateImageFile(file)) {
          await handleImageSelect(file);
        } else {
          alert(`Unsupported image format: ${file.type}. Please drop a PNG, JPEG, GIF, WEBP, or BMP image.`);
        }
      }
    } else if (imageFiles.length > 0 && !supportsImages) {
      alert('The current model does not support images. Image files were ignored.');
    }

    for (const file of officeFiles) {
      await handleFileSelect(file);
    }
    for (const file of textFiles) {
      await handleFileSelect(file);
    }
    for (const file of otherFiles) {
      await handleFileSelect(file);
    }
  }, [disabled, supportsImages, handleImageSelect, handleFileSelect, resolveFilePath]);

  const handleElectronFileSelect = useCallback(async () => {
    try {
      if (!fsApi) {
        logger.error({ msg: "Electron file selection API not available, falling back to browser selection" });
        fileInputRef.current?.click();
        return;
      }

      const result = await fsApi.selectFiles({
        title: 'Select Files to Attach',
        allowMultiple: true
      });

      if (result.success && result.filePaths && result.filePaths.length > 0) {
        setIsProcessing(true);
        try {
          for (const filePath of result.filePaths) {
            const fileInfo = await fsApi.stat(filePath);
            const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'unknown';
            const fileType = getFileTypeFromPath(filePath);
            const isImage = fileType.startsWith('image/');

            if (!fileInfo.success || !fileInfo.stats) {
              logger.error({ msg: "Failed to stat file:", data: filePath });
              alert(`Failed to read file: ${filePath}`);
              continue;
            }

            if (isImage) {
              const fileContent = await fsApi.readFile(filePath, 'base64');
              if (!fileContent.success || !fileContent.content) {
                logger.error({ msg: "Failed to read image file:", data: filePath });
                alert(`Failed to read file: ${filePath}`);
                continue;
              }

              const binaryString = atob(fileContent.content);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const blob = new Blob([bytes], { type: fileType });
              const file = new File([blob], fileName, { type: fileType, lastModified: fileInfo.stats.mtime }) as FileWithSource;
              file.fullPath = filePath;

              if (supportsImages) {
                await handleImageSelect(file);
              } else {
                alert(`The current model does not support images. Ignored image file: ${file.name}`);
              }
            } else {
              const file = new File([], fileName, { type: fileType, lastModified: fileInfo.stats.mtime }) as FileWithSource;
              Object.defineProperty(file, 'size', { value: fileInfo.stats.size });
              file.fullPath = filePath;
              await handleFileSelect(file);
            }
          }
        } catch (error) {
          logger.error({ msg: "Error processing selected files:", err: error });
          alert('An error occurred while processing the selected files.');
        } finally {
          setIsProcessing(false);
        }
      }
    } catch (error) {
      logger.error({ msg: "Error selecting files:", err: error });
      alert('File selection failed. Please try again.');
    }
  }, [supportsImages, handleImageSelect, handleFileSelect]);

  const handleUnifiedFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      for (const file of Array.from(files)) {
        resolveFilePath(file);

        if (FileProcessor.isImageFile(file)) {
          if (supportsImages) {
            await handleImageSelect(file);
          } else {
            alert(`The current model does not support images. Ignored image file: ${file.name}`);
          }
        } else {
          await handleFileSelect(file);
        }
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [supportsImages, handleImageSelect, handleFileSelect, resolveFilePath]);

  const handleScreenshotCapture = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const result = await screenshotApi.capture();
      if (result && result.type === 'success') {
        const uint8Array = new Uint8Array(result.data);
        const blob = new Blob([uint8Array], { type: 'image/png' });
        const file = new File([blob], `screenshot-${Date.now()}.png`, { type: 'image/png' });
        await handleImageSelect(file);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, handleImageSelect]);

  return {
    isProcessing,
    isDragOver,
    fileInputRef,
    dragHandlers: { handleDragOver, handleDragEnter, handleDragLeave, handleDrop },
    handleElectronFileSelect,
    handleUnifiedFileInputChange,
    handleImageSelect,
    handleScreenshotCapture,
  };
}
