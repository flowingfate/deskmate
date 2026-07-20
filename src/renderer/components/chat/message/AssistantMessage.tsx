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

interface AssistantMessageProps {
  agentId: string;
  sessionId: string;
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
  agentId,
  sessionId,
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
          <GeneratedFileCards agentId={agentId} sessionId={sessionId} items={generatedFileItems} chatStatus={chatStatus} />
          <GeneratedScheduleCards agentId={agentId} scheduleIds={scheduleIds} />
        </>
      )}
      <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={cleanedText} />
      </div>
    </>
  );

  if (segments) {
    const lastIndex = segments.length - 1;
    return (
      <div data-dbg="assistant-message" className="group animate-[fadeIn_0.3s_ease-out] mb-7 flex flex-col">
        {segments.map((segment, index) => {
          const streaming = index === lastIndex && isStreaming;
          return (
            <div
              key={segment.id}
              className={`message-content relative wrap-break-word flex flex-col markdown-body ${index > 0 ? 'mt-7 ' : ''}${streaming ? 'streaming contain-[layout_style_paint] will-change-contents' : ''}`.trim()}
            >
              {segment.type === 'image-gallery' && segment.imageRegistry ? (
                <ImageGalleryNew agentId={agentId} sessionId={sessionId} imageRegistry={segment.imageRegistry} />
              ) : segment.type === 'text' ? (
                <MarkdownView text={segment.content} />
              ) : null}
            </div>
          );
        })}
        {meta && <div className="text-xs text-[#737373] mt-2 flex flex-col items-stretch gap-2 mb-1">{meta}</div>}
      </div>
    );
  }

  return (
    <div data-dbg="assistant-message" className="group flex flex-col gap-2 min-w-0 contain-[layout_style] items-start">
      <div className={`animate-[fadeIn_0.3s_ease-out] flex flex-col gap-2 assistant-message p-0 w-full message-content relative wrap-break-word markdown-body ${isStreaming ? 'streaming contain-[layout_style_paint] will-change-contents' : ''}`}>
        <MarkdownView text={cleanedText} />
      </div>
      {meta && <div className="text-xs text-[#737373] flex flex-col items-stretch gap-2 mb-2">{meta}</div>}
    </div>
  );
};

const AssistantMessage = React.memo(AssistantMessageInner);
AssistantMessage.displayName = 'AssistantMessage';

export default AssistantMessage;
