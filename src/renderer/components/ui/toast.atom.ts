import React from 'react';
import { atom } from '@/atom';
import { ToastMessage } from './Toast';

const MAX_TOASTS = 5;

function getTextContent(node: any): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';

  if (React.isValidElement(node)) {
    const props = node.props as any;
    if (props && props.children) {
      if (Array.isArray(props.children)) {
        return props.children.map(getTextContent).join('');
      }
      return getTextContent(props.children);
    }
  }

  if (Array.isArray(node)) {
    return node.map(getTextContent).join('');
  }

  return '';
}

function isDuplicate(existing: ToastMessage[], toast: ToastMessage): boolean {
  return existing.some(t => {
    if (t.type !== toast.type) return false;
    if (typeof t.message === 'string' && typeof toast.message === 'string') {
      return t.message === toast.message;
    }
    if (typeof t.message === 'object' && typeof toast.message === 'object') {
      const a = getTextContent(t.message);
      const b = getTextContent(toast.message);
      return a === b && a.length > 0;
    }
    return false;
  });
}

function generateId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export const toastAtom = atom([] as ToastMessage[], (get, set) => {

  function addToast(toast: ToastMessage) {
    const prev = get();
    if (isDuplicate(prev, toast)) return;
    const trimmed = prev.length >= MAX_TOASTS ? prev.slice(1) : prev;
    set([...trimmed, toast]);
  }

  function removeToast(id: string) {
    set(get().filter(t => t.id !== id));
  }

  function clearAll() {
    set([]);
  }

  function showToast(
    message: string | React.ReactNode,
    type: ToastMessage['type'] = 'info',
    duration: number = 2000,
    options?: Partial<Pick<ToastMessage, 'persistent' | 'actions' | 'onDismiss'>>,
  ): string {
    const id = generateId();
    addToast({
      id,
      message,
      type,
      duration,
      persistent: options?.persistent || false,
      actions: options?.actions,
      onDismiss: options?.onDismiss,
    });
    return id;
  }

  function showSuccess(message: string | React.ReactNode, duration = 2000) {
    showToast(message, 'success', duration);
  }

  function showError(message: string | React.ReactNode, duration = 2000) {
    showToast(message, 'error', duration);
  }

  function showWarning(message: string | React.ReactNode, duration = 2000) {
    showToast(message, 'warning', duration);
  }

  function showInfo(message: string | React.ReactNode, duration = 2000) {
    showToast(message, 'info', duration);
  }

  function showUpdateToast(
    message: string | React.ReactNode,
    actions: ToastMessage['actions'],
    persistent = true,
  ) {
    showToast(message, 'update', undefined, { persistent, actions });
  }

  return { showToast, showSuccess, showError, showWarning, showInfo, showUpdateToast, removeToast, clearAll };
});

export type ToastActions = ReturnType<typeof toastAtom.use>[1];
