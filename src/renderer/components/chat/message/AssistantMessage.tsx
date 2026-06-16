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
  const hasToolCalls = message.tool_calls.length > 0;
  const hasCachedFiles = (cachedFilePaths?.length ?? 0) > 0;
  const hasScheduleCards = scheduleIds.length > 0;
  const messageClass = hasToolCalls
    ? 'message assistant-message has-tool-calls'
    : 'message assistant-message';

  // 工具调用阶段的 metadata 与下方 ToolCallsSection 重复 — 只在收尾或仍有产物时显示。
  const shouldShowMeta = !isStreaming && (!hasToolCalls || hasCachedFiles);
  const shouldShowArtifacts = hasCachedFiles || hasScheduleCards;

  const generatedFileItems = useMemo<GeneratedFileCardItem[]>(() => {
    if (!hasCachedFiles) return [];
    return cachedFilePaths!.map((info) => ({ fileUri: info.path, exists: info.exists }));
  }, [hasCachedFiles, cachedFilePaths]);
  // 仅当出现 <IMAGE_REGISTRY> 标记时才走分段渲染路径 — 多数普通消息直接命中下方 fast path。
  const segments = useMemo<MessageSegment[] | null>(() => {
    if (!hasNewImageFormat(cleanedText)) return null;
    return parseNewFormatMessage(cleanedText, message.id || 'unknown', isStreaming);
  }, [cleanedText, message.id, isStreaming]);

  const metaInner = shouldShowMeta ? (
    <>
      {shouldShowArtifacts && (
        <>
          <GeneratedFileCards items={generatedFileItems} chatStatus={chatStatus} />
          <GeneratedScheduleCards scheduleIds={scheduleIds} />
        </>
      )}
      <div className="message-actions">
        <CopyButton text={cleanedText} />
      </div>
    </>
  ) : null;

  if (segments) {
    const lastIndex = segments.length - 1;
    return (
      <div className="segmented-message new-format">
        {segments.map((segment, index) => {
          const isLastStreaming = index === lastIndex && isStreaming;
          return (
            <div
              key={segment.id}
              className={`segment segment-${segment.type} ${isLastStreaming ? 'streaming' : ''}`}
            >
              <div className={messageClass}>
                <div className={`message-content markdown-body ${isLastStreaming ? 'streaming' : ''}`}>
                  <div className="flex w-full min-w-0 max-w-full items-start">
                    <div className="min-w-0 max-w-full flex-1">
                      {segment.type === 'text' ? (
                        <MarkdownView text={segment.content} />
                      ) : segment.type === 'image-gallery' ? (
                        <ImageGalleryNew imageRegistry={segment.imageRegistry!} />
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {metaInner && <div className="message-meta">{metaInner}</div>}
      </div>
    );
  }

  return (
    <div className="message-container assistant-message-container">
      <div className={messageClass}>
        <div className={`message-content markdown-body ${isStreaming ? 'streaming' : ''}`}>
          <div className="assistant-message-flow min-w-0 w-full max-w-full">
            <MarkdownView text={cleanedText} />
          </div>
        </div>
      </div>
      {metaInner && (
        <div className="message-metadata assistant-message-metadata">{metaInner}</div>
      )}
    </div>
  );
};

const AssistantMessage = React.memo(AssistantMessageInner);
AssistantMessage.displayName = 'AssistantMessage';

export default AssistantMessage;
