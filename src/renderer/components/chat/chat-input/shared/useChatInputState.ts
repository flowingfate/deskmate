import React, { useEffect, useMemo } from 'react';
import { createAttachmentsAtom } from '../Attachments';
import { createTextareaAtom } from '../Textarea';
import { atom } from '@/atom';

export function useChatInputState() {
  const textareaStateAtom = useMemo(() => createTextareaAtom(), []);
  const attachmentsStateAtom = useMemo(() => createAttachmentsAtom(), []);
  const validInputAtom = useMemo(() => atom((use) => {
    return use(attachmentsStateAtom).length > 0 || use(textareaStateAtom).trim().length > 0;
  }), [attachmentsStateAtom, textareaStateAtom]);

  const textareaManager = textareaStateAtom.useChange();
  const attachmentManager = attachmentsStateAtom.useChange();
  const hasValidInput = validInputAtom.use();

  useEffect(() => {
    return () => {
      attachmentManager.clear();
      textareaManager.set('');
    };
  }, [attachmentManager, textareaManager]);

  return {
    textareaStateAtom,
    attachmentsStateAtom,
    textareaManager,
    attachmentManager,
    hasValidInput,
  };
}
