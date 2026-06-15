import React from 'react';
import type { UserMessage as UserMessageType } from '@shared/types/message';
import UserMessage from './message/UserMessage';
import AssistantMessage from './message/AssistantMessage';
import { EditInlineInput } from './chat-input';
import { ToolCallsSection } from './message/ToolCallsSection';
import { CachedFilePath, ChatStatus } from '../../lib/chat/agentSessionCacheManager';
import type { EditingMessageState } from './message/edit-message.atom';

export type { ChatRenderItem } from '../../lib/chat/render-items-manager';
export {
  getChatRenderItemStableKey,
  isVisibleChatRenderItem,
  hasTextContent,
} from '../../lib/chat/render-items-manager';
import type { ChatRenderItem } from '../../lib/chat/render-items-manager';

export interface ChatRenderItemProps {
  item: ChatRenderItem;
  isLast?: boolean;
  renderLoadingIndicator: (className?: string) => React.ReactNode;
  editingSourceMessageIndex: number;
  chatStatus?: ChatStatus;
  editingMessage?: EditingMessageState | null;
  onSaveEditedMessage: (updatedMessage: UserMessageType) => void;
  onCancelEdit: () => void;
  onStartEdit: (messageId: string) => void;
  canEditUserMessage?: boolean;
  streamingMessageId?: string;
  fileExistsCache: Record<string, boolean>;
}

const DIM_STYLE: React.CSSProperties = { opacity: 0.42, transition: 'opacity 120ms ease' };

function ChatRenderItemInner(props: ChatRenderItemProps) {
  const {
    item,
    isLast,
    renderLoadingIndicator,
    editingSourceMessageIndex,
    chatStatus,
    editingMessage,
    onSaveEditedMessage,
    onCancelEdit,
    onStartEdit,
    canEditUserMessage,
    streamingMessageId,
    fileExistsCache,
  } = props;

  if (item.type === 'activity-loading') {
    return <div className="chat-activity-slot">{renderLoadingIndicator()}</div>;
  }

  if (item.type === 'activity-placeholder') {
    return (
      <div className="chat-activity-slot chat-activity-slot-placeholder" aria-hidden="true">
        {renderLoadingIndicator('chat-activity-slot-placeholder-content')}
      </div>
    );
  }

  if (item.type === 'tool-calls-section' && item.toolCalls.length > 0) {
    const shouldDim =
      editingSourceMessageIndex >= 0 && (item.sourceMessageIndex ?? -1) > editingSourceMessageIndex;
    return (
      <div
        className={isLast ? 'chat-latest-live-item' : undefined}
        style={shouldDim ? DIM_STYLE : undefined}
      >
        <ToolCallsSection
          toolCalls={item.toolCalls}
          chatStatus={chatStatus}
          sourceMessageIndex={item.sourceMessageIndex}
          sectionKey={item.sectionKey}
          hasSubsequentConversationMessage={item.hasSubsequentConversation}
        />
      </div>
    );
  }

  // system 消息已从 Domain 模型移除;render-items-manager 不再产出 'system' item。

  if (item.type === 'user') {
    const isEditing = editingMessage?.id === item.message.id;
    if (isEditing) {
      return (
        <div className="inline-edit-message-shell">
          <EditInlineInput
            initialMessage={item.message}
            onSubmitEditedMessage={onSaveEditedMessage}
            onCancelEdit={onCancelEdit}
            warningMessage={editingMessage?.warningMessage}
            chatStatus={chatStatus}
          />
        </div>
      );
    }

    const shouldDim = editingSourceMessageIndex >= 0 && item.index > editingSourceMessageIndex;
    const allowEdit = !editingMessage && !!canEditUserMessage;
    return (
      <div style={shouldDim ? DIM_STYLE : undefined}>
        <UserMessage
          message={item.message}
          canEditUserMessage={allowEdit}
          onEditUserMessage={allowEdit ? () => onStartEdit(item.message.id) : undefined}
        />
      </div>
    );
  }

  if (item.type === 'assistant') {
    const isStreaming = streamingMessageId === item.message.id;
    const shouldDim = editingSourceMessageIndex >= 0 && item.index > editingSourceMessageIndex;

    const hasPresentedFiles = (item.presentedFiles?.length ?? 0) > 0;
    const extractedFilePaths = item.extractedFilePaths ?? [];
    const cachedFilePaths: CachedFilePath[] =
      !hasPresentedFiles && extractedFilePaths.length > 0
        ? extractedFilePaths.map((p) => ({ path: p, exists: fileExistsCache[p] ?? true }))
        : [];

    return (
      <div style={shouldDim ? DIM_STYLE : undefined}>
        <AssistantMessage
          message={item.message}
          cleanedText={item.message.content}
          scheduleIds={item.scheduleIds}
          isStreaming={isStreaming}
          presentedFiles={item.presentedFiles}
          cachedFilePaths={cachedFilePaths}
          chatStatus={chatStatus}
        />
      </div>
    );
  }

  return null;
}

/**
 * 自定义 equality —
 * `RenderItemsManager.recompute()` 已经做了 item 引用复用：内容没变的 item 直接复用旧引用，
 * 所以这里只需要做严格的 `===` 浅比较；fileExistsCache 单独按命中字段比。
 */
function areChatRenderItemPropsEqual(
  prev: ChatRenderItemProps,
  next: ChatRenderItemProps,
): boolean {
  if (prev.item !== next.item) return false;
  if (prev.isLast !== next.isLast) return false;
  if (prev.editingSourceMessageIndex !== next.editingSourceMessageIndex) return false;
  if (prev.chatStatus !== next.chatStatus) return false;
  if (prev.canEditUserMessage !== next.canEditUserMessage) return false;
  if (prev.streamingMessageId !== next.streamingMessageId) return false;
  if (prev.renderLoadingIndicator !== next.renderLoadingIndicator) return false;
  if (prev.editingMessage !== next.editingMessage) return false;
  if (prev.onSaveEditedMessage !== next.onSaveEditedMessage) return false;
  if (prev.onCancelEdit !== next.onCancelEdit) return false;
  if (prev.onStartEdit !== next.onStartEdit) return false;

  // fileExistsCache 引用每次都变 — 只看 assistant item 关心的子集是否变化。
  if (next.item.type === 'assistant') {
    for (const p of next.item.extractedFilePaths ?? []) {
      if (prev.fileExistsCache[p] !== next.fileExistsCache[p]) return false;
    }
  }
  return true;
}

export const ChatRenderItemComponent = React.memo(ChatRenderItemInner, areChatRenderItemPropsEqual);
ChatRenderItemComponent.displayName = 'ChatRenderItem';
