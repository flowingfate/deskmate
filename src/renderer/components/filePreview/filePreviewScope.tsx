import React, { createContext, useCallback, useContext } from 'react';
import { FilePreviewDescriptor } from './FilePreviewPanel';
import { ChatFilePreviewAtom, GlobalFilePreviewAtom } from './filePreview.atom';
import { resolveFileDescriptorUrl } from '@/lib/internalUrls';
import { log } from '@/log';

const logger = log.child({ mod: 'filePreviewScope' });

/**
 * 「就近优先」文件预览路由 —— 替代旧的 `fileViewer:open` 全局事件 + capture/bubble +
 * `chatFilePreviewCoordinator` 单例互斥。
 *
 * 语义等价：聊天页在场时，聊天子树里的 producer 打开预览走满铺 inline 面板
 * （`ChatFilePreviewAtom`）；聊天页不在场（agent 编辑器知识库 / 工作区侧栏等）走全局居中
 * 弹窗（`GlobalFilePreviewAtom`）。旧代码用 DOM 捕获阶段 + 模块单例实现「chat 挂载则优先」，
 * 本质就是「按当前所在的组件作用域选 atom 实例」——正是 React context 的主场。
 *
 * - 聊天子树用 `<ChatFilePreviewScope>` 包裹，context 提供绑定到 `ChatFilePreviewAtom` 的 open。
 * - 无 provider 兜底 = 绑定到 `GlobalFilePreviewAtom`。
 * - producer 一律 `const openFilePreview = useOpenFilePreview()` 后调 `openFilePreview(descriptor)`，
 *   URI（`local://` / `knowledge://`）由 `resolveFileDescriptorUrl` 解析成绝对路径，零 cast。
 */

export type OpenFilePreview = (file: FilePreviewDescriptor) => void;

const FilePreviewScopeContext = createContext<OpenFilePreview | null>(null);

/** 把 raw descriptor（URI 未解析）交给 atom.open：先 resolve URI 成绝对路径。 */
function useScopedOpen(atomOpen: OpenFilePreview): OpenFilePreview {
  return useCallback(
    (file: FilePreviewDescriptor) => {
      void (async () => {
        try {
          const resolved = await resolveFileDescriptorUrl(file);
          atomOpen(resolved);
        } catch (err) {
          logger.warn({ msg: 'Failed to resolve file URI for preview', err, url: file.url });
        }
      })();
    },
    [atomOpen],
  );
}

/** 聊天子树 provider：把 open 绑定到 `ChatFilePreviewAtom`（满铺 inline，就近优先）。 */
export function ChatFilePreviewScope({ children }: { children: React.ReactNode }) {
  const open = useScopedOpen(ChatFilePreviewAtom.useChange().open);
  return <FilePreviewScopeContext.Provider value={open}>{children}</FilePreviewScopeContext.Provider>;
}

/**
 * 取当前作用域的 open：聊天子树内 → `ChatFilePreviewAtom`；否则 → `GlobalFilePreviewAtom`。
 * 无条件调用全部 hook（scoped context + global open），再择一返回，满足 hooks 规则。
 */
export function useOpenFilePreview(): OpenFilePreview {
  const scoped = useContext(FilePreviewScopeContext);
  const globalOpen = useScopedOpen(GlobalFilePreviewAtom.useChange().open);
  return scoped ?? globalOpen;
}
