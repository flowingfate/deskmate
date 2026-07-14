import React, { memo } from 'react';
import type { Attachment, UserMessage } from '@shared/persist/types'
import { asFileUri } from '@shared/persist/types'
import { createUserMessage } from '@shared/utils/messageFactory';
import { copyFileToSandbox, type AttachContext } from '@/lib/attachment/copyToSandbox';
import { attachmentApi } from '@/ipc/attachment';
import {
  ContentConverter,
  ContentAnalyzer,
  formatFileSize,
} from '@/lib/utilities/contentUtils';
import FileTypeIcon from '../../ui/FileTypeIcon';
import { log } from '@/log';
import { currentSessionStore } from '@/states/currentSession.atom';
import { toImageDisplaySrc } from '@/lib/mediaUrl';
import { atom } from '@/atom';
import type { Change } from '@/atom/unit';
import { ImageViewerAtom } from '../../ui/OverlayImageViewer';
import { useOpenFilePreview } from '../../filePreview/filePreviewScope';
import type { FilePreviewDescriptor } from '../../filePreview/FilePreviewPanel';

const logger = log.child({ mod: 'ChatAttachment' });

const zeroAttachments: Attachment[] = [];

type ImageAttachment = Extract<Attachment, { kind: 'image' }>;
type FileLikeAttachment = Extract<Attachment, { kind: 'text' | 'office' | 'opaque' }>;

function imageAttachmentUrl(att: ImageAttachment): string {
  if (att.source.kind === 'dataUrl') {
    return `data:${att.mimeType};base64,${att.source.data}`;
  }
  // 编辑态:从既有消息载入的 `image+fileRef`(`local://`)→ `media://` 直供。
  // 草稿态走 objectURL(getPreviewUrl 里 `previewUrls.get` 优先),不到这里。
  const { agentId, chatSessionId } = currentSessionStore.get();
  return toImageDisplaySrc(att.source.uri, { agentId, sessionId: chatSessionId });
}

function attachmentUri(att: Attachment): string | undefined {
  if (att.kind === 'image') {
    return att.source.kind === 'fileRef' ? att.source.uri : undefined;
  }
  return att.fileUri;
}

// compose / edit 两个聊天输入各持有一份独立的草稿态附件状态(两者会同时挂载,
// 见 edit-message.atom 单值编辑态)。动作体抽成共享函数,由下面两个【模块级】atom
// 各自实例化 —— 框架按 store 懒初始化,使每个 atom 拿到独立的闭包状态(pendingFiles /
// previewUrls),从而隔离;不需要工厂动态建 atom。
function attachmentsActions(get: () => Attachment[], set: Change<Attachment[]>) {
  // 草稿态附件(image/file/office/opaque)尚未物化进 sandbox。file/office/opaque
  // 用空串 URI 占位;image 用空 dataUrl 占位 + objectURL 预览。原始 File 暂存
  // pendingFiles,真正物化(image 走 processImage IPC、其余走 copyFileToSandbox)
  // 推迟到 createMessage 发送时。
  const PENDING_URI = asFileUri('');
  const pendingFiles = new WeakMap<Attachment, File>();
  // 草稿 image 的 objectURL 预览。WeakMap 不可迭代,clear() 需要逐一 revoke,故用
  // 普通 Map 持有,在 removeContent / clear 时 revokeObjectURL 防泄漏。
  const previewUrls = new Map<Attachment, string>();

  // 与 image 之外的附件用 fileUri 去重;草稿态 URI 为空 + image 用 dataUrl 都去不掉,
  // 退而求其次按 fileName + fileSize 去重。
  function isDuplicate(fileName: string, fileSize: number, fullPath?: string): boolean {
    return get().some((att) => {
      const uri = attachmentUri(att);
      if (fullPath && uri && uri === fullPath) return true;
      return att.fileName === fileName && att.fileSize === fileSize;
    });
  }

  async function addImage(file: File): Promise<void> {
    if (isDuplicate(file.name, file.size, (file as { fullPath?: string }).fullPath)) {
      logger.debug({ msg: `[AttachmentManager] Duplicate image skipped: ${file.name}` });
      throw new Error(`DUPLICATE: ${file.name}`);
    }
    // 草稿态:不再 attach 即产 dataUrl/判别,只暂存原始 File + objectURL 预览。
    // 「内联 vs 落 sandbox」交给发送时的 processImage IPC 算一次(见 finalize)。
    const att = ContentConverter.imageDraftContent(file);
    pendingFiles.set(att, file);
    previewUrls.set(att, URL.createObjectURL(file));
    set([...get(), att]);
  }

  async function addFile(file: File): Promise<void> {
    logger.debug({ msg: `[AttachmentManager] addFile called: ${file.name}, size=${file.size}, type=${file.type}` });
    if (isDuplicate(file.name, file.size, (file as { fullPath?: string }).fullPath)) {
      logger.debug({ msg: `[AttachmentManager] Duplicate file skipped: ${file.name}` });
      throw new Error(`DUPLICATE: ${file.name}`);
    }
    try {
      const att = await ContentConverter.fileToFileContent(file, PENDING_URI);
      pendingFiles.set(att, file);
      set([...get(), att]);
    } catch (error) {
      logger.error({ msg: '❌ addFile error:', err: error });
      throw error;
    }
  }

  async function addOthers(file: File): Promise<void> {
    logger.debug({ msg: `[AttachmentManager] addOthers called: ${file.name}, size=${file.size}, type=${file.type}` });
    if (isDuplicate(file.name, file.size, (file as { fullPath?: string }).fullPath)) {
      logger.debug({ msg: `[AttachmentManager] Duplicate others file skipped: ${file.name}` });
      throw new Error(`DUPLICATE: ${file.name}`);
    }
    try {
      const att = await ContentConverter.fileToOthersContent(file, PENDING_URI);
      pendingFiles.set(att, file);
      set([...get(), att]);
    } catch (error) {
      logger.error({ msg: '❌ addOthers error:', err: error });
      throw error;
    }
  }

  async function addOffice(file: File): Promise<void> {
    logger.debug({ msg: `[AttachmentManager] addOffice called: ${file.name}, size=${file.size}, type=${file.type}` });
    if (isDuplicate(file.name, file.size, (file as { fullPath?: string }).fullPath)) {
      logger.debug({ msg: `[AttachmentManager] Duplicate office file skipped: ${file.name}` });
      throw new Error(`DUPLICATE: ${file.name}`);
    }
    try {
      const att = await ContentConverter.fileToOfficeContent(file, PENDING_URI);
      pendingFiles.set(att, file);
      set([...get(), att]);
    } catch (error) {
      logger.error({ msg: '❌ addOffice error:', err: error });
      throw error;
    }
  }

  function revokePreview(att: Attachment): void {
    const url = previewUrls.get(att);
    if (url) {
      URL.revokeObjectURL(url);
      previewUrls.delete(att);
    }
  }

  function removeContent(index: number) {
    const list = get();
    if (index < 0 || index >= list.length) return;
    revokePreview(list[index]);
    const next = list.slice(0, index).concat(list.slice(index + 1));
    set(next);
  }

  function clear() {
    for (const url of previewUrls.values()) URL.revokeObjectURL(url);
    previewUrls.clear();
    set(zeroAttachments);
  }

  /**
   * 把已有的 UserMessage 灌进 manager 用作编辑态。Attachment 是值类型,
   * 复制一份引用即可(image source 是 dataUrl 不可变,fileRef 也是 readonly)。
   * 这些附件已带真 URI,不进 pendingFiles —— createMessage 时原样透传。
   */
  function loadFromMessage(message: { attachments: Attachment[] }): void {
    clear();
    set([...message.attachments]);
  }

  function isValid(): boolean {
    return get().length > 0;
  }

  /**
   * 把一个草稿态附件物化,用终态形态重建 Attachment。
   * - image 草稿:走 `processImage` IPC,main 按【解码尺寸】判别 → inline(image+dataUrl)
   *   或 sandbox(image+fileRef,原图已落盘)。两形态都是 image,egress 按 source 分流。
   * - file/office/opaque 草稿:走 `copyFileToSandbox` 落盘 + 真 URI 重建。
   * - 无 pendingFile(编辑态已带真 URI / 已物化的图片):原样透传。
   */
  async function finalize(att: Attachment, ctx: AttachContext): Promise<Attachment> {
    const file = pendingFiles.get(att);
    if (!file) return att; // 编辑态已带真 URI / 已物化,原样透传
    if (att.kind === 'image') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const reply = await attachmentApi.processImage({
        agentId: ctx.agentId,
        sessionId: ctx.sessionId,
        bytes,
        originalName: file.name,
      });
      if (!reply.success) throw new Error(reply.error);
      if (reply.data.kind === 'inline') {
        return ContentConverter.imageFromInline({
          fileName: file.name,
          fileSize: file.size,
          mimeType: reply.data.mimeType,
          base64: reply.data.base64,
          width: reply.data.width,
          height: reply.data.height,
        });
      }
      // 大图落 sandbox,但**保持 image 语义**:source 用 fileRef 指向落盘文件。
      // egress 不内联、走文件注解让模型按需 read;renderer 按 fileRef 读盘出缩略图。
      return ContentConverter.imageFromFileRef({
        fileName: file.name,
        fileSize: file.size,
        mimeType: reply.data.mimeType,
        uri: asFileUri(reply.data.uri),
        width: reply.data.width,
        height: reply.data.height,
      });
    }
    const uri = asFileUri(await copyFileToSandbox(file, ctx));
    switch (att.kind) {
      case 'text':
        return ContentConverter.fileToFileContent(file, uri);
      case 'office':
        return ContentConverter.fileToOfficeContent(file, uri);
      case 'opaque':
        return ContentConverter.fileToOthersContent(file, uri);
      default:
        return att;
    }
  }

  /**
   * 创建一条 Domain UserMessage(本组件的最终输出)。
   * **副作用**:此处才把草稿态附件物化进 session `files/uploads/` —— 文件落盘
   * 与"点击发送"绑定。物化失败会向上抛,由调用方提示并保留输入,不清空附件。
   */
  async function createMessage(
    text: string,
    ctx: AttachContext,
    overrides?: { id?: string; timestamp?: number },
  ): Promise<UserMessage> {
    const attachments = await Promise.all(get().map((att) => finalize(att, ctx)));
    return createUserMessage({
      content: text,
      attachments,
      id: overrides?.id,
      time: overrides?.timestamp,
    });
  }

  function getPreviewUrl(att: Attachment): string | undefined {
    if (att.kind !== 'image') return undefined;
    // 草稿 image 的 source.data 为空,预览用 objectURL;编辑态已物化图用 dataUrl/fileRef。
    return previewUrls.get(att) ?? imageAttachmentUrl(att);
  }

  return {
    addImage,
    addFile,
    addOthers,
    addOffice,
    removeContent,
    getPreviewUrl,
    clear,
    loadFromMessage,
    isValid,
    createMessage,
  };
}

/** 底部主输入(ComposeInput)的附件草稿状态。模块级单例,全 app 一份。 */
export const composeAttachmentsAtom = atom(zeroAttachments, attachmentsActions);
/** 行内编辑(EditInlineInput)的附件草稿状态;与 compose 隔离,互不串台。 */
export const editAttachmentsAtom = atom(zeroAttachments, attachmentsActions);

export type AttachmentsStateAtom = typeof composeAttachmentsAtom;

interface AttachmentManagerForRender {
  getPreviewUrl: (att: Attachment) => string | undefined;
  removeContent: (index: number) => void;
}

function renderAttachment(
  manager: AttachmentManagerForRender,
  att: Attachment,
  originalIndex: number,
  onOpenImage: (url: string, alt: string, id: string) => void,
  onOpenFile: (file: FilePreviewDescriptor) => void,
): React.ReactNode {
  if (att.kind === 'image') {
    const previewUrl = manager.getPreviewUrl(att);
    return (
      <div
        key={`image-${originalIndex}`}
        className="group relative w-12 h-12 max-md:w-10.5 max-md:h-10.5 bg-[rgba(245,245,245,0.9)] border border-[rgba(220,220,220,0.8)] rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.1)] overflow-hidden cursor-pointer transition-all duration-200 ease hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.2)] hover:border-black/60"
        onClick={() => {
          if (previewUrl) {
            onOpenImage(previewUrl, att.fileName, `attachment-${originalIndex}`);
          }
        }}
      >
        {previewUrl && (
          <img src={previewUrl} alt={att.fileName} className="w-full h-full object-cover rounded-md" />
        )}
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 transition-opacity duration-200 ease group-hover:opacity-100">
          <svg className="w-4 h-4 max-md:w-3.5 max-md:h-3.5 text-[#404040] shrink-0 mb-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="absolute bottom-0 left-0 right-0 bg-[linear-gradient(transparent,rgba(0,0,0,0.7))] text-white text-[10px] font-medium pt-2 px-1.5 pb-1 text-center truncate">{att.fileName}</div>
        <button
          className="absolute top-1 right-1 flex items-center justify-center w-4.5 h-4.5 p-0 bg-black/70 border-none rounded-full cursor-pointer transition-all duration-200 ease text-white opacity-0 scale-[0.8] z-10 hover:bg-[rgba(239,68,68,0.9)] hover:scale-110 group-hover:opacity-100 group-hover:scale-100 [&>svg]:w-2.5 [&>svg]:h-2.5"
          onClick={(e) => {
            e.stopPropagation();
            manager.removeContent(originalIndex);
          }}
          title="Remove attachment"
        >
          <svg fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    );
  }

  if (att.kind === 'text' || att.kind === 'office' || att.kind === 'opaque') {
    const fileLike = att as FileLikeAttachment;
    const removeTitle =
      att.kind === 'office' ? 'Remove Office file' : 'Remove file';
    return (
      <div
        key={`${att.kind}-${originalIndex}`}
        className="group flex flex-col items-center justify-center relative w-12 h-12 max-md:w-10.5 max-md:h-10.5 px-2 py-1.5 max-md:px-1.5 max-md:py-1 bg-[rgba(245,245,245,0.8)] border border-[rgba(220,220,220,0.6)] rounded-lg shadow-[0_2px_6px_rgba(0,0,0,0.1)] cursor-pointer transition-all duration-200 ease hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:border-black/60 hover:bg-[rgba(245,245,245,0.95)]"
        onClick={() => {
          if (fileLike.fileUri) {
            onOpenFile({
              name: fileLike.fileName,
              url: fileLike.fileUri,
              mimeType: fileLike.mimeType,
              size: fileLike.fileSize,
              lastModified:
                'lastModified' in fileLike && fileLike.lastModified
                  ? new Date(fileLike.lastModified).toLocaleString()
                  : undefined,
            });
          }
        }}
      >
        <div className="w-4 h-4 max-md:w-3.5 max-md:h-3.5 text-[#404040] shrink-0 mb-0.5">
          <FileTypeIcon fileName={fileLike.fileName} size={16} />
        </div>
        <div className="flex flex-col items-center text-center w-full overflow-hidden">
          <div className="text-[9px] max-md:text-[8px] font-medium text-[#444444] truncate max-w-full leading-[1.1]" title={fileLike.fileName}>
            {fileLike.fileName}
          </div>
        </div>
        <button
          className="absolute top-1 right-1 flex items-center justify-center w-4.5 h-4.5 p-0 bg-[rgba(239,68,68,0.9)] border-none rounded-full cursor-pointer transition-all duration-200 ease text-white opacity-0 scale-[0.8] z-10 hover:bg-[rgba(220,38,38,1)] hover:scale-110 group-hover:opacity-100 group-hover:scale-100 [&>svg]:w-2.5 [&>svg]:h-2.5"
          onClick={(e) => {
            e.stopPropagation();
            manager.removeContent(originalIndex);
          }}
          title={removeTitle}
        >
          <svg fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    );
  }

  return null;
}

function List({ attachmentsStateAtom }: { attachmentsStateAtom: AttachmentsStateAtom }) {
  const [list, manager] = attachmentsStateAtom.use();
  const imageViewer = ImageViewerAtom.useChange();
  const openFilePreview = useOpenFilePreview();

  const nodes: React.ReactNode[] = [];
  list.forEach((att, index) => {
    const node = renderAttachment(
      manager,
      att,
      index,
      (url, alt, id) => imageViewer.open([{ id, url, alt }], 0),
      openFilePreview,
    );
    if (node) nodes.push(node);
  });
  if (nodes.length === 0) return null;
  return (
    <div className="pt-4 px-5 bg-transparent">
      <div className="flex flex-wrap gap-2 items-start">{nodes}</div>
    </div>
  );
}
export const AttachmentList = memo(List);

function Status({ attachmentsStateAtom }: { attachmentsStateAtom: AttachmentsStateAtom }) {
  const list = attachmentsStateAtom.useData();
  const stats = ContentAnalyzer.analyzeContent(list);
  if (stats.totalSize === 0) return null;
  return (
    <div className="content-stats text-xs">
      📊 Images: {stats.imageCount} | Files: {stats.fileCount}{' '}
      | Others: {stats.othersCount} | Size:{' '}
      {formatFileSize(stats.totalSize)} | Est. Tokens:{' '}
      {stats.estimatedTokens}
    </div>
  );
}
export const AttachmentsStatus = memo(Status);
