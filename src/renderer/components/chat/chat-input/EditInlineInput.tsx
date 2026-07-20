import React, { useState, useRef, useEffect } from 'react';
import { useSupportsImages } from '@/lib/models/useSupportsImages';
import { ChatStatus } from '@/lib/chat/agentSessionCacheManager';
import type { UserMessage } from '@shared/persist/types'
import { getChatInputShortcutHint } from '@/lib/chat/chatInputKeyboard';
import { log } from '@/log';
import { AttachmentList, AttachmentsStatus } from './Attachments';
import { TextArea } from './Textarea';
import { Plus, ArrowUp } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { useChatInputState } from './shared/useChatInputState';
import { useFileHandling } from './shared/useFileHandling';
import { transformMentions } from './shared/transformMentions';
import { useToast } from '../../ui/ToastProvider';
import { inlineEditConfirmAtom } from '../../overlay/ModifyMsgConfimOverlay';

const logger = log.child({ mod: 'EditInlineInput' });

interface EditInlineInputProps {
  agentId: string;
  sessionId: string;
  initialMessage: UserMessage;
  onSubmitEditedMessage: (message: UserMessage) => Promise<void> | void;
  onCancelEdit: () => void;
  chatStatus?: ChatStatus;
  warningMessage?: string | null;
}

export const EditInlineInput: React.FC<EditInlineInputProps> = ({
  agentId,
  sessionId,
  initialMessage,
  onSubmitEditedMessage,
  onCancelEdit,
  chatStatus,
  warningMessage,
}) => {
  const { textareaStateAtom, attachmentsStateAtom, textareaManager, attachmentManager, hasValidInput } = useChatInputState('edit');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isAwaitingEditConfirmation, setIsAwaitingEditConfirmation] = useState(false);
  const supportsImages = useSupportsImages(agentId);
  const { showToast } = useToast();

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
  });

  useEffect(() => {
    attachmentManager.loadFromMessage(initialMessage);
    textareaManager.set(initialMessage.content);
  }, [attachmentManager, initialMessage]);

  const editConfirmDescription = warningMessage
    ? 'This will replace the response below and regenerate from your edited message. External actions already run will not be undone.'
    : 'This will replace the response below and regenerate from your edited message.';

  const inlineEditConfirm = inlineEditConfirmAtom.useChange();

  const isIdle = !chatStatus || chatStatus === 'idle';

  const handleSend = async () => {
    if (isIdle && hasValidInput && !isProcessing && !isSubmittingEdit) {
      setIsAwaitingEditConfirmation(true);
      try {
        const confirmed = await inlineEditConfirm.request({
          title: 'Regenerate response?',
          description: editConfirmDescription,
        });
        if (!confirmed) return;

        // 确认后才物化附件 —— 取消重新生成不会留下落盘文件。
        let messageToSend: UserMessage;
        try {
          messageToSend = await attachmentManager.createMessage(textareaManager.get(), { agentId, sessionId }, {
            id: initialMessage.id,
            timestamp: initialMessage.time,
          });
        } catch (error) {
          logger.error({ msg: 'Failed to materialize attachments on inline edit', err: error });
          showToast('Failed to attach files. Please try again.', 'error');
          return;
        }
        messageToSend.content = transformMentions(messageToSend.content);

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
      className={`chat-input-container relative shrink-0 overflow-visible pt-4 px-6 pb-0 max-[480px]:pt-3 max-[480px]:px-4 ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={dragHandlers.handleDragOver}
      onDragEnter={dragHandlers.handleDragEnter}
      onDragLeave={dragHandlers.handleDragLeave}
      onDrop={dragHandlers.handleDrop}
    >
      <div className="relative border border-black/7.5 rounded-md overflow-visible transition-all duration-200 ease min-w-95 max-md:min-w-70 max-[480px]:min-w-60 focus-within:border-[#404040] focus-within:shadow-[0_0_0_3px_rgba(0,0,0,0.1),0_2px_12px_rgba(0,0,0,0.08)] contrast-more:border-black">
        <AttachmentList agentId={agentId} sessionId={sessionId} attachmentsStateAtom={attachmentsStateAtom} />
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

        <div className="flex items-center justify-between p-3.5 pt-1 gap-3">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => handleElectronFileSelect()}
            disabled={isProcessing || isSubmittingEdit}
            title="Attach"
          >
            <Plus size={14} />
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
            {isIdle ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCancelEdit}
                  type="button"
                  disabled={isSubmittingEdit || isAwaitingEditConfirmation}
                  title="Cancel"
                  aria-label="Cancel"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
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
                  size="sm"
                  onClick={onCancelEdit}
                  type="button"
                  disabled={isSubmittingEdit || isAwaitingEditConfirmation}
                  title="Cancel"
                  aria-label="Cancel"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
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
