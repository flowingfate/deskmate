/**
 * `read` 工具的图片 backend。
 *
 * 把图片文件(本地路径或 `local://` / `knowledge://` 已解析出的 abs path)读成
 * base64,放进 `ToolResult.images` —— 出境时由 messageBridge 拼成 pi
 * `ToolResultMessage` 的 ImageContent 回灌给模型,让模型真正"看到"图。
 *
 * 触发路径:大图附件以 `opaque` 形态落进 session sandbox(见
 * `renderer/.../useFileHandling`),annotation 把 URI 告诉模型;模型按需
 * `read local://uploads/<name>.png` 时走到这里。
 * **按需压缩**:sandbox 里存的是原图(可能很大);read 时用 `compressImageFirstPass`
 * 按 OpenAI vision 指南把回灌的 base64 压到合理尺寸(短边 ≤768 两侧则原样返回),
 * 原图始终不动。这样"大图存原始、读时才压",避免全尺寸 base64 每轮吃满上下文。
 * 压缩失败(损坏 / sharp 不支持 / 动图)回落原始字节,read 不因此失败。
 *
 * 与 filesystem backend 的差异:filesystem 把二进制当文本流式分页、返回
 * `fileTypeHint='binary'` 占位(模型看不到图);本 backend 专门回图。
 */
import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';

import { log } from '@main/log';
import { compressImageFirstPass } from '@main/lib/utilities/imageStorageCompression';

import type { ToolResult } from '../../types';

const logger = log.child({ mod: 'ReadImageBackend' });

/** 已知图片扩展名 → mime。dispatch 用 key 判定,backend 用 value 标注。 */
const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

/** 单图回灌上限:超过则只回元信息、不内联 base64(防 OOM / 超 provider 限制)。 */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB

/** ext 形如 `.png` 或 `png`,大小写不敏感。 */
export function isImageExtension(ext: string): boolean {
  return ext.replace(/^\./, '').toLowerCase() in IMAGE_EXT_TO_MIME;
}

export interface ImageBackendArgs {
  /** 实际读取的 abs 路径。 */
  readonly path: string;
  /** LLM-visible URI(`local://...`);有则 fileName/url 用它,abs 不外泄。 */
  readonly displayUrl?: string;
}

export async function readImage(args: ImageBackendArgs): Promise<ToolResult> {
  const { path: absPath, displayUrl } = args;
  const ext = nodePath.extname(absPath).replace(/^\./, '').toLowerCase();
  const mimeType = IMAGE_EXT_TO_MIME[ext] ?? 'application/octet-stream';
  const url = displayUrl ?? absPath;
  const fileName = nodePath.basename(url);

  const stat = await fs.stat(absPath);
  if (stat.size > MAX_IMAGE_BYTES) {
    return {
      ok: true,
      content: JSON.stringify({
        url,
        fileName,
        mimeType,
        bytes: stat.size,
        error: `Image too large to view inline (${stat.size} bytes > ${MAX_IMAGE_BYTES} limit).`,
      }),
    };
  }

  const buf = await fs.readFile(absPath);

  // 按需压缩:LLM `read` 一张 sandbox 图时,按 OpenAI vision 指南把它压到合理尺寸
  // 再回灌(短边 ≤768 两侧时 compressImageFirstPass 原样返回,不动)。原图始终留在
  // sandbox 不变,模型每次 read 拿到的是压缩 rendition —— 大图存原始、读时才压,
  // 避免每轮把全尺寸 base64 吃满上下文。
  let imageData = buf.toString('base64');
  let imageMime = mimeType;
  try {
    const compressed = await compressImageFirstPass(imageData, mimeType);
    imageData = compressed.base64Data;
    imageMime = compressed.mimeType;
  } catch (err) {
    // 压缩失败(损坏 / sharp 不支持的编码 / 动图)→ 回灌原始字节,read 不因此失败。
    logger.warn({ msg: 'image compress-on-read failed; serving original bytes', err, url });
  }

  return {
    ok: true,
    content: JSON.stringify({
      url,
      fileName,
      mimeType,
      bytes: buf.length,
      note: 'Image content is attached to this tool result.',
    }),
    images: [{ data: imageData, mimeType: imageMime }],
  };
}
