import React, { useRef } from 'react';
import { promptHistory } from '@/lib/chat/promptHistory';
import { validateImageFile } from '@shared/types/chatTypes';
import {
  getCurrentSearchQuery,
  insertMention,
  ContextOption,
  shouldShowContextMenu,
} from '@/lib/chat/contextMentions';
import { MentionHighlight } from '../MentionHighlight';
import { getChatInputEnterAction } from '@/lib/chat/chatInputKeyboard';
import { ContextMenuAtom, zeroContextMenuState } from './context-menu.atom';
import { useRegisterComposeTextHandle } from './chatInputCommands';
import { atom } from '@/atom';

const NOOP = () => {};
function useContextMenu(enabled?: boolean) {
  const [contextMenuState, actions] = ContextMenuAtom.use();
  if (enabled) {
    return [contextMenuState, {
      onContextMenuTrigger: actions.triggerMenu,
      onContextMenuClose: actions.closeMenu,
      onContextMenuNavigate: actions.navigateMenu,
      onContextMenuHover: actions.hoverMenu,
      onContextMenuSelect: actions.selectMenu,
    }] as const;
  }
  return [zeroContextMenuState, {
    onContextMenuTrigger: NOOP,
    onContextMenuClose: NOOP,
    onContextMenuNavigate: NOOP,
    onContextMenuHover: NOOP,
    onContextMenuSelect: NOOP,
  }] as const;
}

interface TextAreaProps {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  readOnly: boolean;
  title: string;
  supportsImages: boolean;
  enableContextMenu?: boolean;
  handleSend: () => void;
  handleImageSelect: (file: File) => Promise<void>;
  textareaStateAtom: TextareaStateAtom;
}

/** 底部主输入(ComposeInput)的草稿文本。模块级单例。 */
export const composeTextAtom = atom('', (get, set) => ({ get, set }));
/** 行内编辑(EditInlineInput)的草稿文本;与 compose 隔离。 */
export const editTextAtom = atom('', (get, set) => ({ get, set }));

export type TextareaStateAtom = typeof composeTextAtom;

export function TextArea(props: TextAreaProps) {
  const { textareaRef, title, readOnly, supportsImages, enableContextMenu, handleSend, handleImageSelect, textareaStateAtom } = props;
  // Used to prevent triggering edit monitoring when handling history
  const isNavigatingHistory = useRef(false);
  const [contextMenuState, {
    onContextMenuTrigger,
    onContextMenuClose,
    onContextMenuNavigate,
    onContextMenuSelect,
  }] = useContextMenu(enableContextMenu);
  const [message, { set: setMessage }] = textareaStateAtom.use();


  // Get cursor position information
  const getCursorPosition = (): {
    position: number;
    isAtStart: boolean;
    isAtEnd: boolean;
    isInMiddle: boolean;
  } => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return { position: 0, isAtStart: true, isAtEnd: true, isInMiddle: false };
    }

    const position = textarea.selectionStart;
    const textLength = message.length;
    const isAtStart = position === 0;
    const isAtEnd = position === textLength;
    const isInMiddle = !isAtStart && !isAtEnd && textLength > 0;

    return { position, isAtStart, isAtEnd, isInMiddle };
  };

  // Set cursor position
  const setCursorPosition = (position: number) => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.setSelectionRange(position, position);
      textarea.focus();
    }
  };

  // Get the bounding rect of the ChatInput container
  const getInputContainerRect = (): DOMRect | null => {
    const container =
      (textareaRef.current?.closest('.textarea-layer-container') as HTMLElement | null) ||
      (textareaRef.current?.closest('.chat-input-container') as HTMLElement | null);
    return container?.getBoundingClientRect() || null;
  };

  // Handle mention selection
  const handleMentionSelect = (option: ContextOption, fromKeyboard: boolean = false) => {
    if (!textareaRef.current) return;

    // If this is the default option (no relativePath or value), close the menu
    // and let the existing ContextMenu onSelect flow handle it
    if (!option.relativePath && !option.value) {

      if (fromKeyboard) {
        // Keyboard selection: close the menu and restore focus
        onContextMenuClose();
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
          }
        }, 0);
      }

      // Do nothing here; let ContextMenu's onSelect call ChatView's handler
      return;
    }

    // FIX: Read the current text from the DOM directly to avoid React state / DOM desync.
    // When the user types quickly, React state (message) may not yet reflect the DOM value.
    // Using the DOM value ensures cursorPos and text always agree.
    const currentText = textareaRef.current.value;
    const cursorPos = textareaRef.current.selectionStart;
    const pathToInsert = option.value || option.relativePath || '';

    const { newText, newCursorPos } = insertMention(
      currentText,
      cursorPos,
      pathToInsert,
    );

    setMessage(newText);
    onContextMenuClose?.();

    // Restore focus and set the cursor position
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  // 用导航态文本填充输入框（来自 ChatView 的 selectedText）。
  const handleFillInput = (text: string) => {
    if (!text || typeof text !== 'string') return;
    setMessage(text);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(text.length, text.length);
      }
    }, 0);
  };

  // 注册文本命令句柄：仅 compose 输入框（enableContextMenu）注册，
  // edit 实例不注册，消除旧全局事件在 compose/edit 两个 Textarea 上并存监听的隐患。
  useRegisterComposeTextHandle(
    {
      insertMention: (option) => handleMentionSelect(option),
      fillInput: handleFillInput,
    },
    !!enableContextMenu,
  );

  // Handle history navigation
  const handleHistoryNavigation = (direction: 'up' | 'down') => {
    const { isAtStart, isAtEnd, isInMiddle } = getCursorPosition();


    if (direction === 'up') {
      if (isAtStart) {
        // Cursor at start, switch to previous prompt
        const previousPrompt = promptHistory.previous();
        if (previousPrompt !== null) {
          isNavigatingHistory.current = true;
          setMessage(previousPrompt);
          // After selecting up, cursor defaults to start
          setTimeout(() => {
            setCursorPosition(0);
            isNavigatingHistory.current = false;
          }, 0);
        }
      } else {
        // Cursor at middle or end, move to start
        setCursorPosition(0);
      }
    } else if (direction === 'down') {
      if (isAtEnd) {
        // Cursor at end, switch to next prompt
        const nextPrompt = promptHistory.next();
        if (nextPrompt !== null) {
          isNavigatingHistory.current = true;
          setMessage(nextPrompt);
          // After selecting down, cursor defaults to end
          setTimeout(() => {
            setCursorPosition(nextPrompt.length);
            isNavigatingHistory.current = false;
          }, 0);
        }
      } else {
        // Cursor at start or middle, move to end
        setCursorPosition(message.length);
      }
    }
  };


  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Context menu keyboard navigation (high priority)
    if (contextMenuState.show && contextMenuState.options.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onContextMenuNavigate('up');
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onContextMenuNavigate('down');
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowRight') {
        e.preventDefault();
        const selectedOption = contextMenuState.options[contextMenuState.selectedIndex];

        // 默认项（无 value/relativePath，如 Add Knowledge / Chat Session / Skill）→ 交给
        // ContextMenu.onSelect 展开对应列表；带 value 的项（文件 / skill URI）就地插入。
        if (!selectedOption.relativePath && !selectedOption.value) {
          onContextMenuSelect(selectedOption);
        } else {
          handleMentionSelect(selectedOption, true);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onContextMenuClose();
        return;
      }
    }

    if (e.key === 'Enter') {
      const enterAction = getChatInputEnterAction({
        key: e.key,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
      });

      if (enterAction === 'ignore') {
        return;
      }

      if (enterAction === 'newline' && e.altKey) {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const currentValue = textarea.value;
          const newValue = currentValue.substring(0, start) + '\n' + currentValue.substring(end);
          setMessage(newValue);

          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + 1;
          }, 0);
        }
        return;
      }

      if (enterAction === 'send') {
        e.preventDefault();
        handleSend();
        return;
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handleHistoryNavigation('up');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleHistoryNavigation('down');
    }
  };

  // Handle input content changes, monitor editing behavior
  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;

    setMessage(newValue);

    // 唯一 `@` 触发键：命中即展示菜单（默认项 / 文件 / skill）。
    if (shouldShowContextMenu(newValue, cursorPos)) {
      const query = getCurrentSearchQuery(newValue, cursorPos);
      const inputRect = getInputContainerRect();
      if (inputRect) {
        onContextMenuTrigger(query, inputRect);
      }
    } else {
      onContextMenuClose();
    }

    // If not navigating history, record as editing behavior
    if (!isNavigatingHistory.current) {
      promptHistory.setCurrentEditing(newValue);
    }
  };

  // Handle clipboard paste events - supports screenshot paste and text trimming
  const handlePaste = async (e: React.ClipboardEvent) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) {
      return;
    }

    // FIX: Prefer plain text over images.
    // When copying a table from Excel/Word the clipboard contains both text and image formats;
    // text should take priority.
    const hasTextContent = clipboardData.types.includes('text/plain');
    const textContent = clipboardData.getData('text/plain');

    // If there is non-empty text content, handle the paste manually and trim surrounding whitespace
    if (hasTextContent && textContent.trim().length > 0) {
      e.preventDefault();
      const trimmedText = textContent.trim();

      // Get the current cursor position
      const textarea = textareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newMessage = message.slice(0, start) + trimmedText + message.slice(end);
        setMessage(newMessage);

        // Set the new cursor position and scroll to it
        const newCursorPos = start + trimmedText.length;
        requestAnimationFrame(() => {
          textarea.selectionStart = newCursorPos;
          textarea.selectionEnd = newCursorPos;
          // Scroll to the cursor position (bottom)
          textarea.scrollTop = textarea.scrollHeight;
        });
      } else {
        setMessage(message + trimmedText);
      }
      return;
    }

    // Check whether the current model supports images
    if (!supportsImages) {
      return;
    }

    // Check whether the clipboard contains image files (only process images when there is no text)
    const items = Array.from(clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));

    if (imageItems.length === 0) {
      return;
    }

    // Prevent default paste behaviour (only for pure image pastes)
    e.preventDefault();

    // Process each image item
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) {

        // Validate image format
        if (!validateImageFile(file)) {
          alert(
            `Unsupported image format: ${file.type}. Please paste a PNG, JPEG, GIF, WEBP, or BMP image.`,
          );
          continue;
        }

        // Generate a file name for the pasted image
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const extension = file.type.split('/')[1] || 'png';
        const fileName = `screenshot-${timestamp}.${extension}`;

        // Create a new File object with the generated file name
        const renamedFile = new File([file], fileName, { type: file.type });

        await handleImageSelect(renamedFile);
      }
    }
  };


  return (
    <div className="textarea-layer-container relative mt-2.5">
      {/* Highlight layer (below the textarea) */}
      <MentionHighlight text={message} textareaRef={textareaRef} />

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={message}
        onChange={handleMessageChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        readOnly={readOnly}
        title={title}
        placeholder="Message Deskmate…"
        className="w-full resize-none border-none px-5 py-0 m-0 text-[13px] leading-[1.6] bg-transparent text-[#1a1a1a] outline-none font-[inherit] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden relative z-2 field-sizing-content min-h-[3lh] max-h-[8lh] placeholder:text-black/25 disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
}
