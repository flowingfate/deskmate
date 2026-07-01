/**
 * AttachmentList — 用户消息附件展示(图片 / 文件 / Office / 其它)。
 *
 * Domain 重构后:
 *   - 输入是 `RenderUserMessage`(等价 Domain UserMessage),消费 `message.attachments`。
 *   - Attachment 的 discriminator 从 `type` 改成 `kind`,字段从嵌套 `image_url/file/metadata`
 *     改为扁平 `fileName/fileSize/mimeType/source/fileUri`。
 *
 * 大图(超内联阈值)落 sandbox 后持久化形态是 `kind:'opaque'`(egress 走 read 工具,
 * 详见 src/main/lib/attachment/ai.prompt.md)。这类 opaque 若 mime 为图片,**UI 仍应
 * 出缩略图** —— 此处按 mime 把它归入图片一类,bytes 通过 `fsApi.readFile` 异步读盘。
 *
 * 点击图片或文件后通过 `window.dispatchEvent` 通知全局 viewer —— 与历史行为一致。
 */

import React, { useMemo } from 'react';
import type {
  Attachment,
  UserMessage,
} from '@shared/types/message';
import { useCurrentSession } from '@/states/currentSession.atom';
import { toMediaUrl, type MediaUrlContext } from '@/lib/mediaUrl';
import FileTypeIcon from '../../ui/FileTypeIcon';

type ImageAttachment = Extract<Attachment, { kind: 'image' }>;
type FileLikeAttachment = Extract<Attachment, { kind: 'text' | 'office' | 'opaque' }>;
type ImageRenderable = ImageAttachment;

interface ImageCardProps {
  attachment: ImageRenderable;
  index: number;
  url?: string | null;
  onOpen: (index: number) => void;
}

const ImageAttachmentCard: React.FC<ImageCardProps> = ({ attachment, index, url, onOpen }) => {
  const label = attachment.fileName || `Image ${index + 1}`;
  return (
    <div
      className="attachment-card image-attachment clickable"
      onClick={() => onOpen(index)}
      style={{ cursor: 'pointer' }}
      title={`Click to preview: ${label}`}
    >
      <div className="attachment-preview image-preview-full">
        {url ? (
          <img
            src={url}
            alt={label}
            className="attachment-image"
            title={label}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="file-icon">
            <FileTypeIcon fileName={label} size={24} />
          </div>
        )}
      </div>
    </div>
  );
};

interface FileCardProps {
  attachment: FileLikeAttachment;
  onOpen: (att: FileLikeAttachment) => void;
}

const FileAttachmentCard: React.FC<FileCardProps> = ({ attachment, onOpen }) => {
  const fileName = attachment.fileName;
  return (
    <div
      className="attachment-card file-attachment clickable"
      onClick={() => onOpen(attachment)}
      style={{ cursor: 'pointer' }}
      title={`Click to preview: ${fileName}`}
    >
      <div className="attachment-preview">
        <div className="file-icon">
          <FileTypeIcon fileName={fileName} size={24} />
        </div>
      </div>
      <div className="attachment-info">
        <div className="attachment-name" title={fileName}>
          {fileName}
        </div>
      </div>
    </div>
  );
};

interface AttachmentListProps {
  message: UserMessage;
}

function transFiles(ctx: MediaUrlContext, attachments: Attachment[]) {
  const images: ImageRenderable[] = [];
  const files: FileLikeAttachment[] = [];
  const imageUrls: Array<string | null> = [];

  for (const att of attachments) {
    if (att.kind === 'image') {
      images.push(att);
      if (att.source.kind === 'dataUrl') {
        imageUrls.push(`data:${att.mimeType};base64,${att.source.data}`);
      } else {
        imageUrls.push(toMediaUrl(att.source.uri, att.mimeType, ctx));
      }
    } else {
      files.push(att);
    }
  }

  return { images, files, imageUrls };
}

function useFiles(attachments: Attachment[]) {
  const { agentId, chatSessionId: sessionId } = useCurrentSession();
  const ctx: MediaUrlContext = { agentId, sessionId };
  return useMemo(() => transFiles(ctx, attachments), [agentId, sessionId, attachments]);
}

export const AttachmentList: React.FC<AttachmentListProps> = ({ message }) => {
  const { images, files, imageUrls } = useFiles(message.attachments);
  const total = images.length + files.length;
  if (total === 0) return null;

  // 用户消息不流式;每次组件挂载只在点击时触发,无需 useCallback 稳定身份。
  const openImageViewer = (clickedIndex: number) => {
    const payload = images.map((att, idx) => ({
      id: `msg-${message.id || 'unknown'}-img-${idx}`,
      url: imageUrls[idx] ?? '',
      alt: att.fileName || `Image ${idx + 1}`,
    }));
    window.dispatchEvent(
      new CustomEvent('imageViewer:open', { detail: { images: payload, initialIndex: clickedIndex } }),
    );
  };

  const openFileViewer = (att: FileLikeAttachment) => {
    window.dispatchEvent(
      new CustomEvent('fileViewer:open', {
        detail: {
          file: {
            name: att.fileName,
            url: att.fileUri,
            mimeType: att.mimeType,
            size: att.fileSize,
          },
        },
      }),
    );
  };

  const isSingle = total === 1;

  return (
    <div className="message-attachments">
      <div className={`attachments-grid ${isSingle ? 'single-attachment' : 'multiple-attachments'}`}>
        {images.map((att, index) => (
          <ImageAttachmentCard
            key={`image-${index}`}
            attachment={att}
            index={index}
            url={imageUrls[index]}
            onOpen={openImageViewer}
          />
        ))}
        {files.map((att, index) => (
          <FileAttachmentCard
            key={`${att.kind}-${index}`}
            attachment={att}
            onOpen={openFileViewer}
          />
        ))}
      </div>
    </div>
  );
};
