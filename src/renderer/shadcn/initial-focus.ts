import * as React from 'react';

export type InitialFocusRef = React.RefObject<HTMLElement | null>;

const INITIAL_FOCUS_ATTRIBUTE = 'data-initial-focus';

function addInitialFocusIndicator(element: HTMLElement): void {
  element.setAttribute(INITIAL_FOCUS_ATTRIBUTE, '');
  element.addEventListener(
    'blur',
    () => element.removeAttribute(INITIAL_FOCUS_ATTRIBUTE),
    { once: true },
  );
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
