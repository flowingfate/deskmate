import { useEffect } from 'react';
import { FilePreviewDescriptor } from './FilePreviewPanel';
import { resolveFileDescriptorUrl } from '@/lib/internalUrls';
import { log } from '@/log';

const logger = log.child({ mod: 'useFilePreviewEvent' });

/**
 * 聊天页 inline 预览与全局兜底预览通过它互斥:聊天预览挂载期间把 `mounted` 置真,
 * 全局容器的监听看到后让出处理权,避免同一 `fileViewer:open` 事件被两个容器同时消费。
 * 模块级单例(所有 chunk 共享、HMR 不残留),比挂 `window` + cast 干净。
 */
export const chatFilePreviewCoordinator = { mounted: false };

/** 事件 detail 里的 file 字段收窄并重建成 `FilePreviewDescriptor`(name/url 非空字符串)。 */
function extractDescriptor(event: Event): FilePreviewDescriptor | undefined {
  if (!(event instanceof CustomEvent)) return undefined;
  const detail: unknown = event.detail;
  if (!detail || typeof detail !== 'object' || !('file' in detail)) return undefined;
  const file = detail.file;
  if (!file || typeof file !== 'object') return undefined;
  if (!('name' in file) || !('url' in file)) return undefined;
  const { name, url } = file;
  if (typeof name !== 'string' || name.length === 0) return undefined;
  if (typeof url !== 'string' || url.length === 0) return undefined;

  // 重建成精确 descriptor:必填 name/url 已校验,可选字段各自 narrowing 后透传。
  const descriptor: FilePreviewDescriptor = { name, url };
  if ('mimeType' in file && typeof file.mimeType === 'string') descriptor.mimeType = file.mimeType;
  if ('size' in file && typeof file.size === 'number') descriptor.size = file.size;
  if ('lastModified' in file && typeof file.lastModified === 'string') descriptor.lastModified = file.lastModified;
  return descriptor;
}

interface UseFilePreviewEventOptions {
  /** 命中事件后打开预览(接收已把 URI 解析成绝对路径的 descriptor)。 */
  open: (file: FilePreviewDescriptor) => void;
  /** 聊天页容器传 true:挂载期占用 coordinator,并在捕获阶段 stopImmediate 阻断全局兜底。 */
  isChat: boolean;
}

/**
 * 监听全局 `fileViewer:open` 自定义事件,把 descriptor 的 URI(`local://` / `knowledge://`)
 * 解析成绝对路径后交给 `open`。聊天页容器(`isChat`)占用 coordinator 并优先消费;
 * 全局容器在 coordinator 被占用时让出。
 */
export function useFilePreviewEvent({ open, isChat }: UseFilePreviewEventOptions): void {
  useEffect(() => {
    if (isChat) chatFilePreviewCoordinator.mounted = true;

    const handleOpen = (event: Event) => {
      // 全局容器:聊天页 inline 预览在场时让出。
      if (!isChat && chatFilePreviewCoordinator.mounted) return;
      const file = extractDescriptor(event);
      if (!file) return;
      if (isChat) {
        // 捕获阶段优先命中;阻断同事件冒泡到全局容器的兜底 listener。
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      void (async () => {
        try {
          const resolved = await resolveFileDescriptorUrl(file);
          open(resolved);
        } catch (err) {
          logger.warn({ msg: 'Failed to resolve file URI for preview', err, url: file.url });
        }
      })();
    };

    // 聊天页在捕获阶段监听(先于全局容器);全局容器在冒泡阶段兜底。
    window.addEventListener('fileViewer:open', handleOpen, isChat);
    return () => {
      if (isChat) chatFilePreviewCoordinator.mounted = false;
      window.removeEventListener('fileViewer:open', handleOpen, isChat);
    };
  }, [open, isChat]);
}
