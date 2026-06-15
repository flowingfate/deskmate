import React, { memo } from 'react';
import type { Attachment, FileUri, UserMessage } from '@shared/types/message';
import { createUserMessage } from '@shared/utils/messageFactory';
import {
  ContentConverter,
  ContentAnalyzer,
  formatFileSize,
} from '@/lib/utilities/contentUtils';
import FileTypeIcon from '../../ui/FileTypeIcon';
import { log } from '@/log';
import { atom } from '@/atom';

const logger = log.child({ mod: 'ChatAttachment' });

const zeroAttachments: Attachment[] = [];

type ImageAttachment = Extract<Attachment, { kind: 'image' }>;
type FileLikeAttachment = Extract<Attachment, { kind: 'file' | 'office' | 'opaque' }>;

function imageAttachmentUrl(att: ImageAttachment): string {
  if (att.source.kind === 'dataUrl') {
    return `data:${att.mimeType};base64,${att.source.data}`;
  }
  return att.source.uri;
}

function attachmentUri(att: Attachment): string | undefined {
  if (att.kind === 'image') {
    return att.source.kind === 'fileRef' ? att.source.uri : undefined;
  }
  return att.fileUri;
}

export function createAttachmentsAtom() {
  return atom(zeroAttachments, (get, set) => {
    // 与 image 之外的附件用 fileUri 去重;image 用 dataUrl 去不掉(每次都不同)
    // 退而求其次按 fileName + fileSize 去重。
    function isDuplicate(fileName: string, fileSize: number, fullPath?: string): boolean {
      return get().some((att) => {
        const uri = attachmentUri(att);
        if (fullPath && uri && uri === fullPath) return true;
        return att.fileName === fileName && att.fileSize === fileSize;
      });
    }

    async function addImage(file: File): Promise<void> {
      if (isDuplicate(file.name, file.size, (file as { fullPath?: string }).fullPath)) {
        logger.debug({ msg: `[AttachmentManager] Duplicate image skipped: ${file.name}` });
        throw new Error(`DUPLICATE: ${file.name}`);
      }
      try {
        const att = await ContentConverter.fileToImageContent(file);
        set([...get(), att]);
      } catch (error) {
        throw error;
      }
    }

    async function addFile(file: File): Promise<void> {
      logger.debug({ msg: `[AttachmentManager] addFile called: ${file.name}, size=${file.size}, type=${file.type}` });
      if (isDuplicate(file.name, file.size, (file as { fullPath?: string }).fullPath)) {
        logger.debug({ msg: `[AttachmentManager] Duplicate file skipped: ${file.name}` });
        throw new Error(`DUPLICATE: ${file.name}`);
      }
      try {
        const att = await ContentConverter.fileToFileContent(file);
        set([...get(), att]);
      } catch (error) {
        logger.error({ msg: '❌ addFile error:', err: error });
        throw error;
      }
    }

    async function addOthers(file: File): Promise<void> {
      logger.debug({ msg: `[AttachmentManager] addOthers called: ${file.name}, size=${file.size}, type=${file.type}` });
      if (isDuplicate(file.name, file.size, (file as { fullPath?: string }).fullPath)) {
        logger.debug({ msg: `[AttachmentManager] Duplicate others file skipped: ${file.name}` });
        throw new Error(`DUPLICATE: ${file.name}`);
      }
      try {
        const att = await ContentConverter.fileToOthersContent(file);
        set([...get(), att]);
      } catch (error) {
        logger.error({ msg: '❌ addOthers error:', err: error });
        throw error;
      }
    }

    async function addOffice(file: File): Promise<void> {
      logger.debug({ msg: `[AttachmentManager] addOffice called: ${file.name}, size=${file.size}, type=${file.type}` });
      if (isDuplicate(file.name, file.size, (file as { fullPath?: string }).fullPath)) {
        logger.debug({ msg: `[AttachmentManager] Duplicate office file skipped: ${file.name}` });
        throw new Error(`DUPLICATE: ${file.name}`);
      }
      try {
        const att = await ContentConverter.fileToOfficeContent(file);
        set([...get(), att]);
      } catch (error) {
        logger.error({ msg: '❌ addOffice error:', err: error });
        throw error;
      }
    }

    function removeContent(index: number) {
      const list = get();
      if (index < 0 || index >= list.length) return;
      const next = list.slice(0, index).concat(list.slice(index + 1));
      set(next);
    }

    function clear() {
      set(zeroAttachments);
    }

    /**
     * 把已有的 UserMessage 灌进 manager 用作编辑态。Attachment 是值类型,
     * 复制一份引用即可(image source 是 dataUrl 不可变,fileRef 也是 readonly)。
     */
    function loadFromMessage(message: { attachments: Attachment[] }): void {
      clear();
      set([...message.attachments]);
    }

    function isValid(): boolean {
      return get().length > 0;
    }

    /**
     * 创建一条 Domain UserMessage(本组件的最终输出)。
     */
    function createMessage(
      text: string,
      overrides?: { id?: string; timestamp?: number },
    ): UserMessage {
      return createUserMessage({
        content: text,
        attachments: get(),
        id: overrides?.id,
        time: overrides?.timestamp,
      });
    }

    function getPreviewUrl(att: Attachment): string | undefined {
      if (att.kind === 'image') return imageAttachmentUrl(att);
      return undefined;
    }

    return {
      addImage,
      addFile,
      addOthers,
      addOffice,
      removeContent,
      getPreviewUrl,
      clear,
      loadFromMessage,
      isValid,
      createMessage,
    };
  });
}

export type AttachmentsStateAtom = ReturnType<typeof createAttachmentsAtom>;

interface AttachmentManagerForRender {
  getPreviewUrl: (att: Attachment) => string | undefined;
  removeContent: (index: number) => void;
}

function renderAttachment(
  manager: AttachmentManagerForRender,
  att: Attachment,
  originalIndex: number,
): React.ReactNode {
  if (att.kind === 'image') {
    const previewUrl = manager.getPreviewUrl(att);
    return (
      <div
        key={`image-${originalIndex}`}
        className="attachment-item image"
        style={{ cursor: 'pointer' }}
        onClick={() => {
          if (previewUrl) {
            window.dispatchEvent(
              new CustomEvent('imageViewer:open', {
                detail: {
                  images: [
                    {
                      id: `attachment-${originalIndex}`,
                      url: previewUrl,
                      alt: att.fileName,
                    },
                  ],
                  initialIndex: 0,
                },
              }),
            );
          }
        }}
      >
        {previewUrl && (
          <img src={previewUrl} alt={att.fileName} className="attachment-image-preview" />
        )}
        <div className="attachment-image-overlay">
          <svg className="attachment-file-icon" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="attachment-image-name">{att.fileName}</div>
        <button
          className="attachment-remove"
          onClick={(e) => {
            e.stopPropagation();
            manager.removeContent(originalIndex);
          }}
          title="Remove attachment"
        >
          <svg fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    );
  }

  if (att.kind === 'file' || att.kind === 'office' || att.kind === 'opaque') {
    const fileLike = att as FileLikeAttachment;
    const removeTitle =
      att.kind === 'office' ? 'Remove Office file' : 'Remove file';
    return (
      <div
        key={`${att.kind}-${originalIndex}`}
        className="attachment-item file"
        style={{ cursor: 'pointer' }}
        onClick={() => {
          if (fileLike.fileUri) {
            window.dispatchEvent(
              new CustomEvent('fileViewer:open', {
                detail: {
                  file: {
                    name: fileLike.fileName,
                    url: fileLike.fileUri as unknown as FileUri,
                    mimeType: fileLike.mimeType,
                    size: fileLike.fileSize,
                    lastModified:
                      'lastModified' in fileLike && fileLike.lastModified
                        ? new Date(fileLike.lastModified).toLocaleString()
                        : undefined,
                  },
                },
              }),
            );
          }
        }}
      >
        <div className="attachment-file-icon">
          <FileTypeIcon fileName={fileLike.fileName} size={16} />
        </div>
        <div className="attachment-file-info">
          <div className="attachment-name" title={fileLike.fileName}>
            {fileLike.fileName}
          </div>
        </div>
        <button
          className="attachment-remove"
          onClick={(e) => {
            e.stopPropagation();
            manager.removeContent(originalIndex);
          }}
          title={removeTitle}
        >
          <svg fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    );
  }

  return null;
}

function List({ attachmentsStateAtom }: { attachmentsStateAtom: AttachmentsStateAtom }) {
  const [list, manager] = attachmentsStateAtom.use();

  const nodes: React.ReactNode[] = [];
  list.forEach((att, index) => {
    const node = renderAttachment(manager, att, index);
    if (node) nodes.push(node);
  });
  if (nodes.length === 0) return null;
  return (
    <div className="attachments-area">
      <div className="attachment-list">{nodes}</div>
    </div>
  );
}
export const AttachmentList = memo(List);

function Status({ attachmentsStateAtom }: { attachmentsStateAtom: AttachmentsStateAtom }) {
  const list = attachmentsStateAtom.useData();
  const stats = ContentAnalyzer.analyzeContent(list);
  if (stats.totalSize === 0) return null;
  return (
    <div className="content-stats">
      📊 Images: {stats.imageCount} | Files: {stats.fileCount}{' '}
      | Others: {stats.othersCount} | Size:{' '}
      {formatFileSize(stats.totalSize)} | Est. Tokens:{' '}
      {stats.estimatedTokens}
    </div>
  );
}
export const AttachmentsStatus = memo(Status);
