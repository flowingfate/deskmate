import * as React from 'react';

export type InitialFocusRef = React.RefObject<HTMLElement | null>;

const INITIAL_FOCUS_ATTRIBUTE = 'data-initial-focus';

function addInitialFocusIndicator(element: HTMLElement): void {
  element.setAttribute(INITIAL_FOCUS_ATTRIBUTE, '');

  // 从 Radix DropdownMenu / 菜单项打开对话框时，菜单关闭会异步把焦点抢回 trigger，
  // 使刚获得初始焦点的元素瞬间 blur；随后 Dialog 的 focus-scope 又把焦点拉回本元素。
  // 若在 blur 时立即移除属性，就会在这次抖动中把焦点指示器抹掉（焦点仍在，但 outline 消失）。
  // 因此延到下一帧再判断：焦点已回到本元素则保留并继续监听，真正离开才移除。
  const handleBlur = (): void => {
    requestAnimationFrame(() => {
      if (element.ownerDocument.activeElement === element) {
        return;
      }
      element.removeAttribute(INITIAL_FOCUS_ATTRIBUTE);
      element.removeEventListener('blur', handleBlur);
    });
  };

  element.addEventListener('blur', handleBlur);
}

export function focusInitialElement(event: Event, initialFocusRef?: InitialFocusRef): void {
  if (event.defaultPrevented) {
    return;
  }

  const element = initialFocusRef?.current;
  if (!element || !element.isConnected || element.matches(':disabled')) {
    return;
  }

  element.focus({ preventScroll: true });
  if (element.ownerDocument.activeElement !== element) {
    return;
  }

  event.preventDefault();
  addInitialFocusIndicator(element);
}
