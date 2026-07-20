import React from 'react';
import type { UserMessage as UserMessageType } from '@shared/persist/types'
import UserMessage from './message/UserMessage';
import AssistantMessage from './message/AssistantMessage';
import { EditInlineInput } from './chat-input';
import { ToolCallsSection } from './tool';
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
  /** items 列表里是否最后一项(activity 已纳入考虑);驱动 `chat-latest-live-item` CSS hook。 */
  isLast?: boolean;
  /**
   * 用户在编辑某条更早的消息,此项位于编辑点之后 → 需半透明。
   * 由 `ChatContainer` 在 render-items 坐标系里算好下发,本组件不做位置计算。
   */
  shouldDim: boolean;
  /**
   * 仅 `tool-calls-section` 用:整列里"还可能被驱动"的那一段。`true` ↔ 它是
   * 末位 tool-section 且 chat 非 idle。`ChatContainer` 算好下发。
   */
  isLive: boolean;
  renderLoadingIndicator: (className?: string) => React.ReactNode;
  agentId: string;
  sessionId: string;
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
    shouldDim,
    isLive,
    renderLoadingIndicator,
    agentId,
    sessionId,
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
    return <div className="flex items-start mt-2">{renderLoadingIndicator()}</div>;
  }

  if (item.type === 'activity-placeholder') {
    return (
      <div className="flex items-start mt-2 pointer-events-none" aria-hidden="true">
        {renderLoadingIndicator('invisible')}
      </div>
    );
  }

  const dimStyle = shouldDim ? DIM_STYLE : undefined;

  if (item.type === 'tool-calls-section' && item.toolCalls.length > 0) {
    return (
      <div className="px-0!" style={dimStyle}>
        <ToolCallsSection
          agentId={agentId}
          sessionId={sessionId}
          toolCalls={item.toolCalls}
          sectionKey={item.sectionKey}
          isLive={isLive}
        />
      </div>
    );
  }

  if (item.type === 'user') {
    const isEditing = editingMessage?.id === item.message.id;
    if (isEditing) {
      return (
        <div className="relative isolate mb-5">
          <EditInlineInput
            agentId={agentId}
            sessionId={sessionId}
            initialMessage={item.message}
            onSubmitEditedMessage={onSaveEditedMessage}
            onCancelEdit={onCancelEdit}
            warningMessage={editingMessage?.warningMessage}
            chatStatus={chatStatus}
          />
        </div>
      );
    }

    const allowEdit = !editingMessage && !!canEditUserMessage;
    return (
      <div style={dimStyle}>
        <UserMessage
          agentId={agentId}
          sessionId={sessionId}
          message={item.message}
          canEditUserMessage={allowEdit}
          onEditUserMessage={allowEdit ? () => onStartEdit(item.message.id) : undefined}
        />
      </div>
    );
  }

  if (item.type === 'assistant') {
    const isStreaming = streamingMessageId === item.message.id;
    const cachedFilePaths: CachedFilePath[] = item.extractedFilePaths.map(
      (p) => ({ path: p, exists: fileExistsCache[p] ?? true }),
    );

    return (
      <div style={dimStyle}>
        <AssistantMessage
          agentId={agentId}
          sessionId={sessionId}
          message={item.message}
          cleanedText={item.message.content}
          scheduleIds={item.scheduleIds}
          isStreaming={isStreaming}
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
 * `RenderItemsManager.recompute()` 已经做了 item 引用复用:内容没变的 item 直接复用旧引用,
 * 这里对 item 做严格 `===` 浅比较;位置派生的 shouldDim/isLive 则单独比较布尔值。
 */
function areChatRenderItemPropsEqual(
  prev: ChatRenderItemProps,
  next: ChatRenderItemProps,
): boolean {
  if (prev.item !== next.item) return false;
  if (prev.isLast !== next.isLast) return false;
  if (prev.shouldDim !== next.shouldDim) return false;
  if (prev.isLive !== next.isLive) return false;
  if (prev.agentId !== next.agentId || prev.sessionId !== next.sessionId) return false;
  if (prev.canEditUserMessage !== next.canEditUserMessage) return false;
  if (prev.streamingMessageId !== next.streamingMessageId) return false;
  if (prev.renderLoadingIndicator !== next.renderLoadingIndicator) return false;
  if (prev.editingMessage !== next.editingMessage) return false;
  if (prev.onSaveEditedMessage !== next.onSaveEditedMessage) return false;
  if (prev.onCancelEdit !== next.onCancelEdit) return false;
  if (prev.onStartEdit !== next.onStartEdit) return false;

  // chatStatus 只影响文件卡片的写操作门控和当前编辑器；仅跨 idle 边界时重渲对应 item。
  const didChatIdleStateChange = (
    (!prev.chatStatus || prev.chatStatus === 'idle')
    !== (!next.chatStatus || next.chatStatus === 'idle')
  );
  if (didChatIdleStateChange) {
    const isEditingUserMessage = next.item.type === 'user'
      && next.editingMessage?.id === next.item.message.id;
    const hasGeneratedFiles = next.item.type === 'assistant'
      && next.item.extractedFilePaths.length > 0;
    if (isEditingUserMessage || hasGeneratedFiles) return false;
  }

  // fileExistsCache 引用每次都变 — 只看 assistant item 关心的子集是否变化。
  if (next.item.type === 'assistant') {
    for (const p of next.item.extractedFilePaths) {
      if (prev.fileExistsCache[p] !== next.fileExistsCache[p]) return false;
    }
  }
  return true;
}

export const ChatRenderItemComponent = React.memo(ChatRenderItemInner, areChatRenderItemPropsEqual);
ChatRenderItemComponent.displayName = 'ChatRenderItem';
