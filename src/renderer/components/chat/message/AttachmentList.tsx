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
import { cn } from '@/lib/utilities/utils';

type ImageAttachment = Extract<Attachment, { kind: 'image' }>;
type FileLikeAttachment = Extract<Attachment, { kind: 'text' | 'office' | 'opaque' }>;
type ImageRenderable = ImageAttachment;

interface ImageCardProps {
  attachment: ImageRenderable;
  index: number;
  url?: string | null;
  isSingle: boolean;
  onOpen: (index: number) => void;
}

const CARD_BASE =
  'group flex flex-col rounded-lg overflow-hidden cursor-pointer bg-[#f8f9facc] border border-[#d6d6d680] transition-all hover:border-black/50 hover:-translate-y-px hover:shadow-[0_2px_8px_#0000001a]';
const PREVIEW_BASE = 'w-full flex items-center justify-center relative overflow-hidden';
const FILE_ICON = 'opacity-80 transition-all group-hover:opacity-100 group-hover:scale-105';

const ImageAttachmentCard: React.FC<ImageCardProps> = ({ attachment, index, url, isSingle, onOpen }) => {
  const label = attachment.fileName || `Image ${index + 1}`;
  return (
    <div
      className={cn(
        CARD_BASE,
        isSingle ? 'w-50 max-md:w-40' : 'w-12.5 max-md:w-10.5',
      )}
      onClick={() => onOpen(index)}
      title={`Click to preview: ${label}`}
    >
      <div
        className={cn(
          PREVIEW_BASE,
          'bg-transparent',
          isSingle ? 'h-40 max-md:h-34' : 'h-12.5 max-md:h-10.5',
        )}
      >
        {url ? (
          <img
            src={url}
            alt={label}
            className="object-cover max-w-full max-h-full"
            title={label}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className={cn(FILE_ICON, isSingle ? 'text-5xl' : 'text-base max-md:text-sm')}>
            <FileTypeIcon fileName={label} size={24} />
          </div>
        )}
      </div>
    </div>
  );
};

interface FileCardProps {
  attachment: FileLikeAttachment;
  isSingle: boolean;
  onOpen: (att: FileLikeAttachment) => void;
}

const FileAttachmentCard: React.FC<FileCardProps> = ({ attachment, isSingle, onOpen }) => {
  const fileName = attachment.fileName;
  return (
    <div
      className={cn(
        CARD_BASE,
        isSingle ? 'w-50 max-md:w-40' : 'w-12.5 max-md:w-10.5',
      )}
      onClick={() => onOpen(attachment)}
      title={`Click to preview: ${fileName}`}
    >
      <div
        className={cn(
          PREVIEW_BASE,
          'bg-[#f3f4f6cc]',
          isSingle ? 'h-30 max-md:h-25' : 'h-7.5 max-md:h-6.5',
        )}
      >
        <div className={cn(FILE_ICON, isSingle ? 'text-5xl max-md:text-[40px]' : 'text-base max-md:text-sm')}>
          <FileTypeIcon fileName={fileName} size={24} />
        </div>
      </div>
      <div
        className={cn(
          'w-full flex items-center justify-center border-t border-[#e5e7eb99] bg-white/90',
          isSingle
            ? 'h-10 p-2 max-md:h-9 max-md:p-1.5'
            : 'h-5 px-0.5 py-1 max-md:h-4 max-md:px-px max-md:py-0.5',
        )}
      >
        <div
          className={cn(
            'text-[#4b5563e6] font-medium leading-[1.2] text-center',
            isSingle ? 'text-[13px] max-md:text-xs' : 'truncate text-[9px] leading-[1.1] max-md:text-[8px]',
          )}
          title={fileName}
        >
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
      <div
        className={cn(
          'flex flex-wrap gap-2 items-start',
          isSingle ? 'max-w-50' : 'max-w-full',
        )}
      >
        {images.map((att, index) => (
          <ImageAttachmentCard
            key={`image-${index}`}
            attachment={att}
            index={index}
            url={imageUrls[index]}
            isSingle={isSingle}
            onOpen={openImageViewer}
          />
        ))}
        {files.map((att, index) => (
          <FileAttachmentCard
            key={`${att.kind}-${index}`}
            attachment={att}
            isSingle={isSingle}
            onOpen={openFileViewer}
          />
        ))}
      </div>
    </div>
  );
};
