import type { Attachment } from '@shared/types/message';

/**
 * 把 user 消息里的 file / office / opaque 附件渲染成一段说明文本。
 * 这段文本会被 messageBridge 拼到 user message 的 text 之后注入给模型,
 * 让模型知道附件元信息（路径、类型、行数等）。
 *
 * image attachment 不进此函数 —— 它们走 PiImageContent。
 * 输出格式行为与老 chatTypes-based 版本一致,只是输入侧从 parts 切到 Domain Attachment。
 */
export function buildFileAnnotationText(attachments: readonly Attachment[]): string {
  const files: Extract<Attachment, { kind: 'file' }>[] = [];
  const offices: Extract<Attachment, { kind: 'office' }>[] = [];
  const others: Extract<Attachment, { kind: 'opaque' }>[] = [];

  for (const a of attachments) {
    if (a.kind === 'file') files.push(a);
    else if (a.kind === 'office') offices.push(a);
    else if (a.kind === 'opaque') others.push(a);
  }

  if (!files.length && !offices.length && !others.length) return '';

  const sections: string[] = [];
  if (files.length) sections.push(renderFiles(files));
  if (offices.length) sections.push(renderOffices(offices));
  if (others.length) sections.push(renderOthers(others));

  return sections.join('\n').trimEnd();
}

function renderFiles(files: ReadonlyArray<Extract<Attachment, { kind: 'file' }>>): string {
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
