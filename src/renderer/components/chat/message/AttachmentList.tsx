/**
 * AttachmentList — 用户消息附件展示(图片 / 文件 / Office / 其它)。
 *
 * Domain 重构后:
 *   - 输入是 `RenderUserMessage`(等价 Domain UserMessage),消费 `message.attachments`。
 *   - Attachment 的 discriminator 从 `type` 改成 `kind`,字段从嵌套 `image_url/file/metadata`
 *     改为扁平 `fileName/fileSize/mimeType/source/fileUri`。
 *
 * 点击图片或文件后通过 `window.dispatchEvent` 通知全局 viewer —— 与历史行为一致。
 */

import React from 'react';
import type {
  Attachment,
  UserMessage,
} from '@shared/types/message';
import FileTypeIcon from '../../ui/FileTypeIcon';

type ImageAttachment = Extract<Attachment, { kind: 'image' }>;
type FileLikeAttachment = Extract<Attachment, { kind: 'file' | 'office' | 'opaque' }>;

/** 把 Domain ImageAttachment 物化成 `<img src>` 用得上的 URL。 */
function imageAttachmentUrl(att: ImageAttachment): string {
  if (att.source.kind === 'dataUrl') {
    return `data:${att.mimeType};base64,${att.source.data}`;
  }
  return att.source.uri;
}

interface ImageCardProps {
  attachment: ImageAttachment;
  index: number;
  onOpen: (index: number) => void;
}

const ImageAttachmentCard: React.FC<ImageCardProps> = ({ attachment, index, onOpen }) => {
  const label = attachment.fileName || `Image ${index + 1}`;
  return (
    <div
      className="attachment-card image-attachment clickable"
      onClick={() => onOpen(index)}
      style={{ cursor: 'pointer' }}
      title={`Click to preview: ${label}`}
    >
      <div className="attachment-preview image-preview-full">
        <img
          src={imageAttachmentUrl(attachment)}
          alt={label}
          className="attachment-image"
          title={label}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
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

export const AttachmentList: React.FC<AttachmentListProps> = ({ message }) => {
  const images = message.attachments.filter(
    (a): a is ImageAttachment => a.kind === 'image',
  );
  const fileLikes = message.attachments.filter(
    (a): a is FileLikeAttachment =>
      a.kind === 'file' || a.kind === 'office' || a.kind === 'opaque',
  );

  const total = images.length + fileLikes.length;
  if (total === 0) return null;

  // 用户消息不流式;每次组件挂载只在点击时触发,无需 useCallback 稳定身份。
  const openImageViewer = (clickedIndex: number) => {
    const payload = images.map((att, idx) => ({
      id: `msg-${message.id || 'unknown'}-img-${idx}`,
      url: imageAttachmentUrl(att),
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
            onOpen={openImageViewer}
          />
        ))}
        {fileLikes.map((att, index) => (
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
