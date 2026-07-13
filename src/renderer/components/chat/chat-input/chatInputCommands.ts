/**
 * compose 聊天输入子树的命令句柄注册表（替代旧的 `chatInput:selectFiles` /
 * `chatInput:screenshot` / `agent:fillInput` / `context:mentionSelect`
 * 自定义 window 事件）。
 *
 * 这些「命令」本质是「对当前挂载、持有 textarea DOM ref 的 compose 输入组件发起一次
 * 命令式调用」——不是需要渲染的 state。故用**命令式句柄注册表**而非 atom：consumer 挂载
 * 期把自身方法注册进模块单例，散在别处的 producer 直接调用转发。无 React state、无 re-render、
 * 无 nonce diff，同时把无类型的 `window.CustomEvent` 换成编译期类型契约 + 可跳转引用。
 *
 * 为什么不用 context：producer 之一 `context-menu.atom.ts` 不是 React 组件，读不了 context；
 * 模块级注册表能被 React / 非 React 路径统一调用。
 *
 * 两个句柄各自只会有一个注册者：
 * - compose Textarea（`enableContextMenu` 门控，edit 实例不注册）→ text 命令
 * - ComposeInput（同一时刻仅一个挂载）→ file 命令
 */

import { useEffect, useRef } from 'react';
import type { ContextOption } from '@/lib/chat/contextMentions';

/** compose Textarea 暴露的文本命令句柄。 */
export interface ComposeTextHandle {
  insertMention: (option: ContextOption) => void;
  fillInput: (text: string) => void;
}

/** ComposeInput 暴露的文件命令句柄。 */
export interface ComposeFileHandle {
  selectFiles: () => void;
  screenshot: () => void;
}

let textHandle: ComposeTextHandle | null = null;
let fileHandle: ComposeFileHandle | null = null;

/**
 * consumer 在挂载期注册自身句柄，卸载时清除。注册的是一个稳定转发器（内部读 ref 拿最新
 * handler），故每次渲染 handler 闭包变化无需重注册；只在 `enabled` 变化时挂/卸。
 */
export function useRegisterComposeTextHandle(handle: ComposeTextHandle, enabled: boolean): void {
  const ref = useRef(handle);
  ref.current = handle;
  useEffect(() => {
    if (!enabled) return;
    const forwarder: ComposeTextHandle = {
      insertMention: (o) => ref.current.insertMention(o),
      fillInput: (t) => ref.current.fillInput(t),
    };
    textHandle = forwarder;
    return () => {
      if (textHandle === forwarder) textHandle = null;
    };
  }, [enabled]);
}

export function useRegisterComposeFileHandle(handle: ComposeFileHandle): void {
  const ref = useRef(handle);
  ref.current = handle;
  useEffect(() => {
    const forwarder: ComposeFileHandle = {
      selectFiles: () => ref.current.selectFiles(),
      screenshot: () => ref.current.screenshot(),
    };
    fileHandle = forwarder;
    return () => {
      if (fileHandle === forwarder) fileHandle = null;
    };
  }, []);
}

/** producer 调用入口（无 consumer 挂载时静默 no-op）。 */
export const composeTextCommands: ComposeTextHandle = {
  insertMention: (option) => textHandle?.insertMention(option),
  fillInput: (text) => textHandle?.fillInput(text),
};

export const composeFileCommands: ComposeFileHandle = {
  selectFiles: () => fileHandle?.selectFiles(),
  screenshot: () => fileHandle?.screenshot(),
};
