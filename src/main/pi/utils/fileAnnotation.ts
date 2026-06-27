import type { Attachment } from '@shared/types/message';

/**
 * 把 user 消息里的「需注解」附件渲染成一段说明文本。这段文本会被 messageBridge
 * 拼到 user message 的 text 之后注入给模型,让模型知道附件元信息(路径、类型、行数、
 * 图片尺寸等)并据此决定 `read`。
 *
 * 覆盖四类:
 *   - `file` / `office` / `opaque` —— 始终走注解(它们从不内联)。
 *   - `image` 且 `source.kind === 'fileRef'` —— 大图落盘形态,**不内联**,走注解让模型
 *     按需 read。`image` 且 `dataUrl`(小图)不进此函数 —— 它们走 PiImageContent 内联。
 * 输出格式行为与老 chatTypes-based 版本一致,只是输入侧从 parts 切到 Domain Attachment。
 */
export function buildFileAnnotationText(attachments: readonly Attachment[]): string {
  const files: Extract<Attachment, { kind: 'text' }>[] = [];
  const offices: Extract<Attachment, { kind: 'office' }>[] = [];
  const others: Extract<Attachment, { kind: 'opaque' }>[] = [];
  const images: Extract<Attachment, { kind: 'image' }>[] = [];

  for (const a of attachments) {
    if (a.kind === 'text') files.push(a);
    else if (a.kind === 'office') offices.push(a);
    else if (a.kind === 'opaque') others.push(a);
    else if (a.kind === 'image' && a.source.kind === 'fileRef') images.push(a);
  }

  if (!files.length && !offices.length && !others.length && !images.length) return '';

  const sections: string[] = [];
  if (images.length) sections.push(renderImages(images));
  if (files.length) sections.push(renderFiles(files));
  if (offices.length) sections.push(renderOffices(offices));
  if (others.length) sections.push(renderOthers(others));

  return sections.join('\n').trimEnd();
}

/**
 * 落盘大图(image+fileRef)。给出 URI + 尺寸,提示模型用 `read` 查看实际内容
 * (read backend 会按 vision 指南压缩后回 base64)。只渲染 fileRef source —— dataUrl
 * 小图已内联,不在此列。
 */
function renderImages(images: ReadonlyArray<Extract<Attachment, { kind: 'image' }>>): string {
  let out = '🖼️ **Image Files List** (use `read` to view contents):\n';
  images.forEach((img, i) => {
    const uri = img.source.kind === 'fileRef' ? img.source.uri : '';
    out += `${i + 1}. **${img.fileName}** (${formatFileSize(img.fileSize)})\n`;
    out += `   - URI: \`${uri}\`\n`;
    out += `   - Type: ${img.mimeType}\n`;
    if (img.width && img.height) out += `   - Dimensions: ${img.width}×${img.height}\n`;
  });
  return out;
}

function renderFiles(files: ReadonlyArray<Extract<Attachment, { kind: 'text' }>>): string {
  let out = '📁 **Text Files List:**\n';
  files.forEach((f, i) => {
    out += `${i + 1}. **${f.fileName}** (${formatFileSize(f.fileSize)})\n`;
    out += `   - URI: \`${f.fileUri}\`\n`;
    out += `   - Type: ${f.mimeType}\n`;
    if (f.lines) out += `   - Lines: ${f.lines}\n`;
  });
  return out;
}

function renderOffices(offices: ReadonlyArray<Extract<Attachment, { kind: 'office' }>>): string {
  let out = '📄 **Office Files List:**\n';
  offices.forEach((o, i) => {
    const rawExt = o.fileName?.split('.').pop();
    const ext = rawExt ? rawExt.toUpperCase() : 'UNKNOWN';
    out += `${i + 1}. **${o.fileName}** (${formatFileSize(o.fileSize)})\n`;
    out += `   - URI: \`${o.fileUri}\`\n`;
    out += `   - Type: ${o.mimeType}\n`;
    out += `   - Extension: ${ext}\n`;
    if (typeof o.pages === 'number') out += `   - Pages: ${o.pages}\n`;
    if (typeof o.lines === 'number') out += `   - Lines: ${o.lines}\n`;
  });
  return out;
}

function renderOthers(others: ReadonlyArray<Extract<Attachment, { kind: 'opaque' }>>): string {
  let out = '📎 **Other Files List:**\n';
  others.forEach((o, i) => {
    out += `${i + 1}. **${o.fileName}** (${formatFileSize(o.fileSize)})\n`;
    out += `   - URI: \`${o.fileUri}\`\n`;
    out += `   - Type: ${o.mimeType}\n`;
    out += `   - Extension: ${o.fileExtension?.toUpperCase() || 'UNKNOWN'}\n`;
    out += `   - Description: ${o.description || 'Other file type'}\n`;
  });
  return out;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
