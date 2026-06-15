import React, { useState, useRef, useEffect, useCallback } from 'react';
import { agentSessionCacheManager } from '@/lib/chat/agentSessionCacheManager';
import { useAgentById } from '@/states/agents.atom';
import { ChatStatus } from '@/lib/chat/agentSessionCacheManager';
import type { UserMessage } from '@shared/types/message';
import { useModelInfo } from '@/lib/models/useModelInfo';
import { getChatInputShortcutHint } from '@/lib/chat/chatInputKeyboard';
import '../ChatInput.scss';
import { log } from '@/log';
import { AttachmentList, AttachmentsStatus } from './Attachments';
import { TextArea } from './Textarea';
import { Plus, ArrowUp } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { useChatInputState } from './shared/useChatInputState';
import { useFileHandling } from './shared/useFileHandling';
import { transformMentions } from './shared/transformMentions';

const logger = log.child({ mod: 'EditInlineInput' });

interface EditInlineInputProps {
  initialMessage: UserMessage;
  onSubmitEditedMessage: (message: UserMessage) => Promise<void> | void;
  onCancelEdit: () => void;
  chatStatus?: ChatStatus;
  warningMessage?: string | null;
}

function useSupportsImages(): boolean {
  const agentId = agentSessionCacheManager.getCurrentAgentId();
  const agent = useAgentById(agentId);
  const { info } = useModelInfo(agent?.model ?? null);
  return info?.supportsImages ?? false;
}

export const EditInlineInput: React.FC<EditInlineInputProps> = ({
  initialMessage,
  onSubmitEditedMessage,
  onCancelEdit,
  chatStatus,
  warningMessage,
}) => {
  const { textareaStateAtom, attachmentsStateAtom, textareaManager, attachmentManager, hasValidInput } = useChatInputState();
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isAwaitingEditConfirmation, setIsAwaitingEditConfirmation] = useState(false);
  const supportsImages = useSupportsImages();

  const chatInputShortcutHint = getChatInputShortcutHint(
    typeof navigator === 'undefined' ? undefined : navigator.platform,
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    isProcessing,
    isDragOver,
    fileInputRef,
    dragHandlers,
    handleElectronFileSelect,
    handleUnifiedFileInputChange,
    handleImageSelect,
  } = useFileHandling({
    attachmentManager,
    supportsImages,
    getAttachContext: () => {
      const agentId = agentSessionCacheManager.getCurrentAgentId();
      const sessionId = agentSessionCacheManager.getCurrentChatSessionId();
      return agentId && sessionId ? { agentId, sessionId } : null;
    },
  });

  useEffect(() => {
    attachmentManager.loadFromMessage(initialMessage);
    textareaManager.set(initialMessage.content);
  }, [attachmentManager, initialMessage]);

  const editConfirmDescription = warningMessage
    ? 'This will replace the response below and regenerate from your edited message. External actions already run will not be undone.'
    : 'This will replace the response below and regenerate from your edited message.';

  const requestInlineEditConfirmation = useCallback(
    (description: string): Promise<boolean> => {
      const { promise, resolve } = Promise.withResolvers<boolean>();
      const requestId = `inline-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const handleResult = (event: Event) => {
        const customEvent = event as CustomEvent<{ requestId?: string; confirmed?: boolean }>;
        if (customEvent.detail?.requestId !== requestId) return;
        window.removeEventListener('chatInput:confirmInlineEditResult', handleResult as EventListener);
        resolve(customEvent.detail?.confirmed === true);
      };

      window.addEventListener('chatInput:confirmInlineEditResult', handleResult as EventListener);
      window.dispatchEvent(
        new CustomEvent('chatInput:confirmInlineEditRequest', {
          detail: { requestId, title: 'Regenerate response?', description },
        }),
      );
      return promise;
    },
    [],
  );

  const isIdle = !chatStatus || chatStatus === 'idle';

  const handleSend = async () => {
    if (isIdle && hasValidInput && !isProcessing && !isSubmittingEdit) {
      const messageToSend = attachmentManager.createMessage(textareaManager.get(), {
        id: initialMessage.id,
        timestamp: initialMessage.time,
      });
      messageToSend.content = transformMentions(messageToSend.content);

      setIsAwaitingEditConfirmation(true);
      try {
        const confirmed = await requestInlineEditConfirmation(editConfirmDescription);
        if (!confirmed) return;

        setIsSubmittingEdit(true);
        try {
          await onSubmitEditedMessage(messageToSend);
        } catch (error) {
          logger.error({ msg: "Failed to submit inline edit:", err: error });
        } finally {
          setIsSubmittingEdit(false);
        }
      } finally {
        setIsAwaitingEditConfirmation(false);
      }
    }
  };

  return (
    <div
      className={`chat-input-container inline-edit-mode ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={dragHandlers.handleDragOver}
      onDragEnter={dragHandlers.handleDragEnter}
      onDragLeave={dragHandlers.handleDragLeave}
      onDrop={dragHandlers.handleDrop}
    >
      <div className="input-area">
        <AttachmentList attachmentsStateAtom={attachmentsStateAtom} />
        <TextArea
          handleImageSelect={handleImageSelect}
          handleSend={handleSend}
          textareaRef={textareaRef}
          readOnly={false}
          title={chatInputShortcutHint}
          supportsImages={supportsImages}
          enableContextMenu={false}
          textareaStateAtom={textareaStateAtom}
        />

        <div className="button-area">
          <Button
            variant="outline"
            size="icon"
            onClick={() => handleElectronFileSelect()}
            disabled={isProcessing || isSubmittingEdit}
            title="Attach"
          >
            <Plus size={18} />
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept="*"
            onChange={handleUnifiedFileInputChange}
            style={{ display: 'none' }}
            multiple
          />

          <div className="right-buttons-group">
            {isIdle ? (
              <>
                <Button
                  variant="outline"
                  className="w-24 min-w-24"
                  onClick={onCancelEdit}
                  type="button"
                  disabled={isSubmittingEdit || isAwaitingEditConfirmation}
                  title="Cancel"
                  aria-label="Cancel"
                >
                  Cancel
                </Button>
                <Button
                  className="w-24 min-w-24"
                  onClick={handleSend}
                  disabled={!hasValidInput || isProcessing || isSubmittingEdit || isAwaitingEditConfirmation}
                  title="Send"
                  aria-label="Send"
                  type="button"
                >
                  {isSubmittingEdit ? 'Sending...' : isAwaitingEditConfirmation ? 'Waiting...' : 'Send'}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  className="w-24 min-w-24"
                  onClick={onCancelEdit}
                  type="button"
                  disabled={isSubmittingEdit || isAwaitingEditConfirmation}
                  title="Cancel"
                  aria-label="Cancel"
                >
                  Cancel
                </Button>
                <Button
                  className="w-24 min-w-24"
                  onClick={handleSend}
                  disabled
                  title="Waiting for chat status"
                  aria-label="Send"
                  type="button"
                >
                  {isSubmittingEdit ? 'Sending...' : isAwaitingEditConfirmation ? 'Waiting...' : 'Send'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {process.env.NODE_ENV === 'development' && <AttachmentsStatus attachmentsStateAtom={attachmentsStateAtom} />}
    </div>
  );
};
