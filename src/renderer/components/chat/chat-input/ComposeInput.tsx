import React, { useState, useRef, useEffect } from 'react';
import { promptHistory } from '@/lib/chat/promptHistory';
import { agentSessionCacheManager, ChatStatus } from '@/lib/chat/agentSessionCacheManager';
import type { UserMessage } from '@shared/persist/types'
import { getChatInputShortcutHint } from '@/lib/chat/chatInputKeyboard';
import { log } from '@/log';
import { AttachmentList, AttachmentsStatus } from './Attachments';
import { TextArea } from './Textarea';
import { ModelSelector } from './ModelSelector';
import { ThinkingLevelSelector } from './ThinkingLevelSelector';
import { Plus, SlidersHorizontal, ArrowUp, X, Loader2 } from 'lucide-react';
import { useToast } from '../../ui/ToastProvider';
import { traceContext } from '@renderer/lib/chat/traceContext';
import { agentIpc } from '@renderer/lib/chat/agentIpc';
import { EditAgentMenuAtom } from '../../menu/EditAgentMenuDropdown';
import { AttachMenuAtom } from '../../menu/AttachMenuDropdown';
import { useRegisterComposeFileHandle } from './chatInputCommands';
import { Button } from '@/shadcn/button';
import { useChatInputState } from './shared/useChatInputState';
import { useFileHandling } from './shared/useFileHandling';
import { transformMentions } from './shared/transformMentions';
import { useSupportsImages } from '@/lib/models/useSupportsImages';

const logger = log.child({ mod: 'ComposeInput' });

interface ComposeInputProps {
  agentId: string;
  sessionId: string;
  onSendMessage: (message: UserMessage) => void;
  chatStatus?: ChatStatus;
  enableContextMenu?: boolean;
  isInputLocked?: boolean;
}

export const ComposeInput: React.FC<ComposeInputProps> = ({
  agentId,
  sessionId,
  onSendMessage,
  chatStatus,
  enableContextMenu,
  isInputLocked = false,
}) => {
  const editAgentMenuActions = EditAgentMenuAtom.useChange();
  const attachMenuActions = AttachMenuAtom.useChange();
  const { textareaStateAtom, attachmentsStateAtom, textareaManager, attachmentManager, hasValidInput } = useChatInputState('compose');
  const { showToast } = useToast();

  const chatInputShortcutHint = getChatInputShortcutHint(
    typeof navigator === 'undefined' ? undefined : navigator.platform,
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const supportsImages = useSupportsImages(agentId);

  const {
    isProcessing,
    isDragOver,
    fileInputRef,
    dragHandlers,
    handleElectronFileSelect,
    handleUnifiedFileInputChange,
    handleImageSelect,
    handleScreenshotCapture,
  } = useFileHandling({
    attachmentManager,
    supportsImages,
    disabled: isInputLocked,
  });

  // 注册文件命令句柄（AttachMenuDropdown 触发 selectFiles/screenshot）。
  useRegisterComposeFileHandle({
    selectFiles: handleElectronFileSelect,
    screenshot: handleScreenshotCapture,
  });

  async function onCancelChat() {
    try {
      logger.debug({ msg: "Cancelling chat..." });
      // 接力 in-flight chat.send tracer：把 cancel 事件挂到同一 trace 上，
      // 让 doctor / log viewer 拿一个 tid 能同时看到 send / cancel 两端。
      // 没有 in-flight tracer（如冷启动或异常路径）时传 undefined，main 端兜底新起。
      const inflight = traceContext.peek(sessionId);
      const trace = inflight?.sid ? inflight.serialize() : undefined;
      await agentIpc.cancelChatSession(agentId, sessionId, trace);
    } catch (error) {
      logger.error({ msg: "Error cancelling chat:", err: error });
    }
  }

  const isIdle = !chatStatus || chatStatus === 'idle';

  const handleSend = async () => {
    if (isInputLocked) return;
    if (isIdle && hasValidInput && !isProcessing) {
      // 附件在此刻才物化进 session files —— 发送 = 落盘。失败则保留输入与附件。
      let messageToSend: UserMessage;
      try {
        messageToSend = await attachmentManager.createMessage(textareaManager.get(), { agentId, sessionId });
      } catch (error) {
        logger.error({ msg: 'Failed to materialize attachments on send', err: error });
        showToast('Failed to attach files. Please try again.', 'error');
        return;
      }
      messageToSend.content = transformMentions(messageToSend.content);

      const message = textareaManager.get().trim();
      if (message) {
        promptHistory.add(message);
      }

      onSendMessage(messageToSend);
      textareaManager.set('');
      attachmentManager.clear();
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  };

  return (
    <div
      className={`chat-input-container relative shrink-0 overflow-visible p-0! h-auto ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={dragHandlers.handleDragOver}
      onDragEnter={dragHandlers.handleDragEnter}
      onDragLeave={dragHandlers.handleDragLeave}
      onDrop={dragHandlers.handleDrop}
    >

      {isInputLocked && (
        <div className="bg-black/8 border-black/28 text-gray-800 text-xs py-1 px-4">
          Inline message editing is active above. Save or cancel that edit to continue composing here.
        </div>
      )}

      <div
        className="border-t border-black/7 focus-within:bg-black/2"
        style={isInputLocked ? { opacity: 0.7, pointerEvents: 'none' } : undefined}
      >
        <AttachmentList agentId={agentId} sessionId={sessionId} attachmentsStateAtom={attachmentsStateAtom} />
        <TextArea
          handleImageSelect={handleImageSelect}
          handleSend={handleSend}
          textareaRef={textareaRef}
          readOnly={isInputLocked}
          title={chatInputShortcutHint}
          supportsImages={supportsImages}
          enableContextMenu={enableContextMenu}
          textareaStateAtom={textareaStateAtom}
        />

        <div className="flex items-center justify-between p-3.5 pt-1 gap-3">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={(e) => attachMenuActions.toggle(e.currentTarget)}
            disabled={isProcessing || isInputLocked}
            title="Attach"
          >
            <Plus size={14} />
          </Button>

          <Button
            variant="outline"
            size="icon-sm"
            onClick={(e) => {
              if (isInputLocked) return;
              editAgentMenuActions.toggle(e.currentTarget);
            }}
            disabled={isInputLocked}
            title="Edit Agent (MCP Tools, System Prompt & Context Enhancement)"
          >
            <SlidersHorizontal size={14} />
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept="*"
            onChange={handleUnifiedFileInputChange}
            style={{ display: 'none' }}
            multiple
          />

          <div className="order-3 ml-auto flex items-center gap-3">
            <ModelSelector
              agentId={agentId}
              shouldLockComposeUi={isInputLocked}
            />

            <ThinkingLevelSelector
              agentId={agentId}
              shouldLockComposeUi={isInputLocked}
            />

            {isIdle ? (
              <Button
                size="icon-sm"
                onClick={handleSend}
                disabled={!hasValidInput || isProcessing || isInputLocked}
                title={chatInputShortcutHint}
              >
                {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
              </Button>
            ) : chatStatus ? (
              <Button
                variant="destructive"
                size="icon-sm"
                onClick={onCancelChat}
                disabled={isInputLocked}
                title="Cancel Chat"
              >
                <X size={14} />
              </Button>
            ) : (
              <Button size="icon-sm" disabled title="Waiting for chat status" type="button">
                <ArrowUp size={14} />
              </Button>
            )}
          </div>
        </div>
      </div>

      {process.env.NODE_ENV === 'development' && <AttachmentsStatus attachmentsStateAtom={attachmentsStateAtom} />}
    </div>
  );
};
