/**
 * AssistantMessage — 渲染单条 assistant 文本消息。
 *
 * 文本预处理（去 `<FINAL_SUMMARY>`、抽 schedule id）已经由
 * `render-items-manager` 缓存好；这里只负责装配 MarkdownView、
 * GeneratedFileCards、GeneratedScheduleCards、操作按钮。
 */

import React, { useMemo } from 'react';
import type { RenderAssistantMessage } from '@/lib/chat/renderMessage';
import { ChatStatus } from '@/lib/chat/agentSessionCacheManager';
import { MarkdownView } from './MarkdownView';
import { CopyButton } from './CopyButton';
import GeneratedFileCards, {
  GeneratedFileCardItem,
} from './GeneratedFileCards';
import GeneratedScheduleCards from './GeneratedScheduleCards';
import { hasNewImageFormat, parseNewFormatMessage, ImageGalleryNew, MessageSegment } from './ImageGallery';
import './Message.scss';

interface AssistantMessageProps {
  message: RenderAssistantMessage;
  /** assistant.content 文本(由 render-items-manager 缓存好,组件直接渲染)。 */
  cleanedText: string;
  /** 出现在 cleanedText 中的 schedule job id,去重保持顺序。 */
  scheduleIds: string[];
  isStreaming?: boolean;
  /**
   * 出现在 cleanedText 里的 URI / 绝对路径(由 `extractFilePathsFromText` 抽取,
   * `ChatRenderItem` 组装)。每条挂存在性 flag,渲染成产出文件卡片;LLM 在收尾
   * 消息提到的文件就以这种方式浮现,无需额外协议。
   */
  cachedFilePaths?: Array<{ path: string; exists: boolean }>;
  chatStatus?: ChatStatus;
}

const AssistantMessageInner: React.FC<AssistantMessageProps> = ({
  message,
  cleanedText,
  scheduleIds,
  isStreaming = false,
  cachedFilePaths,
  chatStatus,
}) => {
  const hasCachedFiles = (cachedFilePaths?.length ?? 0) > 0;
  const hasScheduleCards = scheduleIds.length > 0;
  const showArtifacts = hasCachedFiles || hasScheduleCards;

  const generatedFileItems = useMemo<GeneratedFileCardItem[]>(
    () => (cachedFilePaths ?? []).map((info) => ({ fileUri: info.path, exists: info.exists })),
    [cachedFilePaths],
  );
  // 仅当出现 <IMAGE_REGISTRY> 标记时才走分段渲染路径 — 多数普通消息直接命中下方 fast path。
  const segments = useMemo<MessageSegment[] | null>(
    () => (hasNewImageFormat(cleanedText) ? parseNewFormatMessage(cleanedText, message.id || 'unknown', isStreaming) : null),
    [cleanedText, message.id, isStreaming],
  );

  const meta = isStreaming ? null :(
    <>
      {showArtifacts && (
        <>
          <GeneratedFileCards items={generatedFileItems} chatStatus={chatStatus} />
          <GeneratedScheduleCards scheduleIds={scheduleIds} />
        </>
      )}
      <div className="message-actions">
        <CopyButton text={cleanedText} />
      </div>
    </>
  );

  if (segments) {
    const lastIndex = segments.length - 1;
    return (
      <div className="segmented-message">
        {segments.map((segment, index) => {
          const streaming = index === lastIndex && isStreaming;
          return (
            <div
              key={segment.id}
              className={`segment segment-${segment.type} message-content markdown-body ${streaming ? 'streaming' : ''}`}
            >
              {segment.type === 'image-gallery' && segment.imageRegistry ? (
                <ImageGalleryNew imageRegistry={segment.imageRegistry} />
              ) : segment.type === 'text' ? (
                <MarkdownView text={segment.content} />
              ) : null}
            </div>
          );
        })}
        {meta && <div className="message-meta mb-1">{meta}</div>}
      </div>
    );
  }

  return (
    <div className="message-container assistant-message-container">
      <div className={`message assistant-message message-content markdown-body ${isStreaming ? 'streaming' : ''}`}>
        <MarkdownView text={cleanedText} />
      </div>
      {meta && <div className="message-metadata mb-2">{meta}</div>}
    </div>
  );
};

const AssistantMessage = React.memo(AssistantMessageInner);
AssistantMessage.displayName = 'AssistantMessage';

export default AssistantMessage;
