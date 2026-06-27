import { useEffect } from 'react';
import { composeAttachmentsAtom, editAttachmentsAtom } from '../Attachments';
import { composeTextAtom, editTextAtom } from '../Textarea';
import { atom } from '@/atom';

// 校验「可发送」的派生只读 atom —— compose / edit 各一个,模块级单例。
// computed atom 只在布尔结果翻转时通知,故输入框不会因每次按键而重渲。
const composeValidAtom = atom((use) =>
  use(composeAttachmentsAtom).length > 0 || use(composeTextAtom).trim().length > 0,
);
const editValidAtom = atom((use) =>
  use(editAttachmentsAtom).length > 0 || use(editTextAtom).trim().length > 0,
);

// 两个聊天输入场景各绑定一组隔离的模块级 atom(ComposeInput 与 EditInlineInput 同时挂载)。
const SCOPES = {
  compose: { text: composeTextAtom, attachments: composeAttachmentsAtom, valid: composeValidAtom },
  edit: { text: editTextAtom, attachments: editAttachmentsAtom, valid: editValidAtom },
} as const;

export type ChatInputScope = keyof typeof SCOPES;

export function useChatInputState(scope: ChatInputScope) {
  const { text: textareaStateAtom, attachments: attachmentsStateAtom, valid } = SCOPES[scope];

  const textareaManager = textareaStateAtom.useChange();
  const attachmentManager = attachmentsStateAtom.useChange();
  const hasValidInput = valid.use();

  // 卸载时清空本场景的草稿(并 revoke 草稿图片的 objectURL),避免跨会话/跨编辑残留。
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
