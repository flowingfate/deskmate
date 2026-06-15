import { memo, useEffect } from 'react';
import { InlinePreviewAtom } from './chat-side.atom';
import InlineFilePreviewPanel, { InlineFileDescriptor } from './InlineFilePreviewPanel';
import { resolveFileDescriptorUrl } from '@/lib/internalUrls';
import { log } from '@/log';
const logger = log.child({ mod: 'ChatInlinePreviewOverlay' });
/**
 * `OverlayFileViewer`(全局兜底)与本组件(聊天页 inline)都在 `window` 上监听
 * `fileViewer:open` 自定义事件;本组件挂载期间 OverlayFileViewer 必须让出处理权,
 * 否则同一事件会被两个 viewer 同时打开。模块级单例 + 直接 `.mounted` 读写,
 * 比挂在 `window` 上 + `as any` 干净:类型完整、HMR 不残留、所有 chunk 共享。
 */
export const inlinePreviewCoordinator = { mounted: false };

/**
 * 聊天页内的 inline 文件预览浮层 — 铺满整个 chat-content 区域(连 ComposeInput 一起遮住)。
 * 触发源: 任意位置 `dispatchEvent(new CustomEvent('fileViewer:open', { detail: { file } }))`。
 * 与 OverlayFileViewer 通过上面的 coordinator 互斥。本组件再调一次 stopImmediatePropagation
 * 兜底,以防同事件在 AT_TARGET 阶段先触发了 OverlayFileViewer 的 listener。
 */
function isInlineFileDescriptor(value: unknown): value is InlineFileDescriptor {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { name?: unknown; url?: unknown };
  return typeof candidate.name === 'string'
    && candidate.name.length > 0
    && typeof candidate.url === 'string'
    && candidate.url.length > 0;
}

function ChatInlinePreviewOverlay() {
  const [inlinePreview, previewActions] = InlinePreviewAtom.use();

  useEffect(() => {
    inlinePreviewCoordinator.mounted = true;

    const handleFileViewerOpen = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const file = detail && typeof detail === 'object'
        ? (detail as { file?: unknown }).file
        : undefined;
      if (!isInlineFileDescriptor(file)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // `file.url` 可能是 URI(`local://` / `knowledge://`)。URI → 绝对路径
      // 再开 panel;非 URI 透传。解析失败 → log 不开 panel(已 stopImmediate 阻断兜底)。
      void (async () => {
        try {
          const resolved = await resolveFileDescriptorUrl(file);
          previewActions.open(resolved);
        } catch (err) {
          logger.warn({ msg: 'Failed to resolve file URI for inline preview', err, url: file.url });
        }
      })();
    };

    window.addEventListener('fileViewer:open', handleFileViewerOpen, true);
    return () => {
      inlinePreviewCoordinator.mounted = false;
      window.removeEventListener('fileViewer:open', handleFileViewerOpen, true);
    };
  }, []);

  if (!inlinePreview) return null;

  return (
    <div className="absolute inset-0 z-10 flex bg-white">
      <InlineFilePreviewPanel
        file={inlinePreview.file}
        isOpen
        onClose={previewActions.cancel}
        onDirtyStateChange={previewActions.markDirty}
      />
    </div>
  );
}

export default memo(ChatInlinePreviewOverlay);
