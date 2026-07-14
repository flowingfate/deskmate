/**
 * Unified content processing utility — UnifiedAttachmentSystem
 *
 * Provides unified content part handling, transformation, and validation
 * Supports unified management for text, image, and file content types
 */

import {
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_TEXT_TYPES,
  FILE_ATTACHMENT_LIMITS,
} from '@shared/types/chatTypes';
import type { Attachment, FileUri } from '@shared/persist/types'
import { getImageDimensions, smartCompressImage, shouldCompressImageAdvanced } from './imageCompression';
import { log } from '@/log';
const logger = log.child({ mod: 'ContentUtils' });

// ===== Attachment Construction Utilities =====
//
// Domain `Attachment` 通过 discriminated union(`kind`)区分四种形态。
// 这里提供三类 helper:文件 → Attachment(`fileToImage / fileToFile / fileToOffice / fileToOpaque`),
// 现成数据 → Attachment(`makeImage / makeFile / makeOffice / makeOpaque`,留作内部用),
// dataUrl 拆分 base64 部分(图片附件 source.kind === 'dataUrl' 只存 base64 部分)。

function dataUrlToBase64(dataUrl: string): string {
  const m = /^data:[^;]+;base64,(.*)$/.exec(dataUrl);
  return m ? m[1] : dataUrl;
}

/** Image attachment with embedded dataUrl base64. */
function makeImageAttachment(input: {
  fileName: string;
  fileSize: number;
  mimeType: string;
  dataUrl: string;
  width?: number;
  height?: number;
  detail?: 'auto' | 'low' | 'high';
}): Attachment {
  return {
    kind: 'image',
    fileName: input.fileName,
    fileSize: input.fileSize,
    mimeType: input.mimeType,
    source: { kind: 'dataUrl', data: dataUrlToBase64(input.dataUrl) },
    width: input.width,
    height: input.height,
    detail: input.detail ?? 'auto',
  };
}

function makeFileAttachment(input: {
  fileName: string;
  fileUri: FileUri;
  fileSize: number;
  mimeType: string;
  encoding?: string;
  lastModified?: number;
  lines?: number;
  detail?: 'auto' | 'low' | 'high';
}): Attachment {
  return {
    kind: 'text',
    fileName: input.fileName,
    fileSize: input.fileSize,
    mimeType: input.mimeType,
    fileUri: input.fileUri,
    detail: input.detail ?? 'auto',
    lastModified: input.lastModified,
    lines: input.lines,
    encoding: input.encoding,
  };
}

function makeOfficeAttachment(input: {
  fileName: string;
  fileUri: FileUri;
  fileSize: number;
  mimeType: string;
  lastModified?: number;
  pages?: number;
  lines?: number;
  detail?: 'auto' | 'low' | 'high';
}): Attachment {
  return {
    kind: 'office',
    fileName: input.fileName,
    fileSize: input.fileSize,
    mimeType: input.mimeType,
    fileUri: input.fileUri,
    detail: input.detail ?? 'auto',
    lastModified: input.lastModified,
    pages: input.pages,
    lines: input.lines,
  };
}

function makeOpaqueAttachment(input: {
  fileName: string;
  fileUri: FileUri;
  fileSize: number;
  mimeType: string;
  fileExtension?: string;
  description?: string;
}): Attachment {
  return {
    kind: 'opaque',
    fileName: input.fileName,
    fileSize: input.fileSize,
    mimeType: input.mimeType,
    fileUri: input.fileUri,
    fileExtension: input.fileExtension,
    description: input.description,
  };
}

// ===== File Processing Utilities =====

export class FileProcessor {
  private static readonly OFFICE_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-word.document.macroEnabled.12',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  ];

  private static readonly OFFICE_EXTENSIONS = [
    '.pdf',
    '.docx',
    '.docm',
    '.pptx',
    '.pptm',
  ];

  // Check whether a file is a supported image format
  static isImageFile(file: File): boolean {
    return SUPPORTED_IMAGE_TYPES.includes(file.type as any);
  }

  // Check whether a file is an Office document
  static isOfficeFile(file: File): boolean {
    const mimeType = (file.type || '').toLowerCase();
    if (this.OFFICE_MIME_TYPES.includes(mimeType)) {
      return true;
    }

    const fileName = file.name.toLowerCase();
    return this.OFFICE_EXTENSIONS.some(ext => fileName.endsWith(ext));
  }

  // Check whether a file is a supported text format
  static isTextFile(file: File): boolean {
    if (this.isOfficeFile(file)) {
      return false;
    }

    // Check MIME type
    if (SUPPORTED_TEXT_TYPES.includes(file.type as any)) {
      return true;
    }

    // Check file extension
    const fileName = file.name.toLowerCase();
    return FILE_ATTACHMENT_LIMITS.SUPPORTED_TEXT_EXTENSIONS.some(ext =>
      fileName.endsWith(ext.toLowerCase())
    );
  }

  // Check whether a file is of "other" type (not image, text, or Office)
  static isOthersFile(file: File): boolean {
    return !this.isImageFile(file) && !this.isTextFile(file) && !this.isOfficeFile(file);
  }

  // Check whether a file size is within the limit
  static isFileSizeValid(file: File): boolean {
    return file.size <= FILE_ATTACHMENT_LIMITS.MAX_FILE_SIZE_BYTES;
  }

  // Convert a File object to a DataURL
  static async fileToDataURL(file: File): Promise<string> {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
    return promise;
  }

  // Convert a File object to text
  static async fileToText(file: File): Promise<string> {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const reader = new FileReader();
    reader.onload = () => {
      let content = reader.result as string;

      // Check line count limit
      const lines = content.split('\n');
      if (lines.length > FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES) {
        content =
          lines.slice(0, FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES).join('\n') +
          `\n\n... [File truncated; original has ${lines.length} lines, showing first ${FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES}]`;
      }
      resolve(content);
    };
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
    return promise;
  }
  // Get the MIME type of a file
  static getMimeType(file: File): string {
    if (file.type) {
      return file.type;
    }

    // Infer MIME type from file extension
    const fileName = file.name.toLowerCase();
    const mimeMap: Record<string, string> = {
      // Basic text files
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.rst': 'text/x-rst',
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.docm': 'application/vnd.ms-word.document.macroEnabled.12',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.pptm': 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
      '.rtf': 'text/rtf',

      // Web technologies
      '.js': 'text/javascript',
      '.ts': 'text/typescript',
      '.jsx': 'text/javascript',
      '.tsx': 'text/typescript',
      '.mjs': 'text/javascript',
      '.cjs': 'text/javascript',
      '.css': 'text/css',
      '.scss': 'text/x-scss',
      '.sass': 'text/x-sass',
      '.less': 'text/x-less',
      '.stylus': 'text/x-stylus',
      '.html': 'text/html',
      '.htm': 'text/html',
      '.xhtml': 'application/xhtml+xml',
      '.vue': 'text/x-vue',
      '.svelte': 'text/x-svelte',
      '.json': 'application/json',
      '.json5': 'application/json5',
      '.jsonc': 'application/json',
      '.xml': 'application/xml',
      '.svg': 'image/svg+xml',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
      '.toml': 'text/x-toml',
      '.ini': 'text/x-ini',
      '.cfg': 'text/x-ini',
      '.conf': 'text/x-ini',

      // Programming languages — C/C++ family
      '.c': 'text/x-c',
      '.cc': 'text/x-c++',
      '.cpp': 'text/x-cpp',
      '.cxx': 'text/x-cpp',
      '.c++': 'text/x-cpp',
      '.h': 'text/x-c',
      '.hpp': 'text/x-cpp',
      '.hxx': 'text/x-cpp',
      '.h++': 'text/x-cpp',

      // Programming languages — others
      '.py': 'text/x-python',
      '.pyw': 'text/x-python',
      '.pyc': 'application/x-python-code',
      '.pyi': 'text/x-python',
      '.pyx': 'text/x-cython',
      '.java': 'text/x-java',
      '.class': 'application/java-vm',
      '.jar': 'application/java-archive',
      '.scala': 'text/x-scala',
      '.kt': 'text/x-kotlin',
      '.kts': 'text/x-kotlin',
      '.cs': 'text/x-csharp',
      '.vb': 'text/x-vb',
      '.fs': 'text/x-fsharp',
      '.fsx': 'text/x-fsharp',
      '.fsi': 'text/x-fsharp',
      '.rs': 'text/x-rust',
      '.go': 'text/x-go',
      '.mod': 'text/x-go-mod',
      '.sum': 'text/plain',
      '.rb': 'text/x-ruby',
      '.rbw': 'text/x-ruby',
      '.gem': 'application/x-gem',
      '.rake': 'text/x-ruby',
      '.php': 'text/x-php',
      '.php3': 'text/x-php',
      '.php4': 'text/x-php',
      '.php5': 'text/x-php',
      '.phtml': 'text/x-php',
      '.pl': 'text/x-perl',
      '.pm': 'text/x-perl',
      '.t': 'text/x-perl',
      '.pod': 'text/x-pod',
      '.swift': 'text/x-swift',
      '.m': 'text/x-objc',
      '.mm': 'text/x-objc++',
      '.r': 'text/x-r',
      '.R': 'text/x-r',
      '.rmd': 'text/x-r-markdown',
      '.rnw': 'text/x-r-sweave',
      '.jl': 'text/x-julia',
      '.julia': 'text/x-julia',
      '.dart': 'text/x-dart',
      '.flutter': 'text/x-dart',
      '.lua': 'text/x-lua',
      '.luac': 'application/x-lua-bytecode',

      // Shell scripts
      '.sh': 'text/x-shellscript',
      '.bash': 'text/x-shellscript',
      '.zsh': 'text/x-shellscript',
      '.fish': 'text/x-shellscript',
      '.csh': 'text/x-shellscript',
      '.tcsh': 'text/x-shellscript',
      '.ps1': 'text/x-powershell',
      '.psm1': 'text/x-powershell',
      '.psd1': 'text/x-powershell',
      '.bat': 'text/x-msdos-batch',
      '.cmd': 'text/x-msdos-batch',

      // Assembly and low-level languages
      '.asm': 'text/x-asm',
      '.s': 'text/x-asm',
      '.S': 'text/x-asm',

      // Databases
      '.sql': 'text/x-sql',
      '.mysql': 'text/x-mysql',
      '.pgsql': 'text/x-pgsql',
      '.sqlite': 'text/x-sqlite',

      // Containerization
      '.dockerfile': 'text/x-dockerfile',
      '.containerfile': 'text/x-dockerfile',

      // Config files
      '.env': 'text/x-dotenv',
      '.envrc': 'text/x-dotenv',
      '.editorconfig': 'text/x-editorconfig',
      '.gitignore': 'text/x-gitignore',
      '.gitattributes': 'text/x-gitattributes',
      '.eslintrc': 'application/json',
      '.prettierrc': 'application/json',
      '.babelrc': 'application/json',
      '.npmrc': 'text/x-npmrc',
      '.yarnrc': 'text/x-yarnrc',
      '.tsconfig': 'application/json',
      '.jsconfig': 'application/json',
      '.webpack': 'text/javascript',
      '.rollup': 'text/javascript',
      '.vite': 'text/javascript',
      '.makefile': 'text/x-makefile',
      '.cmake': 'text/x-cmake',
      '.gradle': 'text/x-gradle',
      '.maven': 'text/x-maven',
      '.ant': 'text/x-ant',
      '.properties': 'text/x-java-properties',
      '.lock': 'text/plain',

      // Documentation and markup languages
      '.tex': 'text/x-latex',
      '.latex': 'text/x-latex',
      '.bib': 'text/x-bibtex',
      '.cls': 'text/x-latex',
      '.sty': 'text/x-latex',
      '.org': 'text/x-org',
      '.adoc': 'text/x-asciidoc',
      '.asciidoc': 'text/x-asciidoc',
      '.wiki': 'text/x-wiki',
      '.mediawiki': 'text/x-mediawiki',

      // Data formats
      '.csv': 'text/csv',
      '.tsv': 'text/tab-separated-values',
      '.psv': 'text/plain',
      '.dsv': 'text/plain',
      '.log': 'text/x-log',
      '.out': 'text/plain',
      '.err': 'text/plain',
      '.trace': 'text/x-log',

      // Other formats
      '.patch': 'text/x-patch',
      '.diff': 'text/x-diff',
      '.rej': 'text/x-reject',
      '.spec': 'text/x-rpm-spec',
      '.rpm': 'application/x-rpm',
      '.deb': 'application/x-deb',
      '.pem': 'text/x-pem-file',
      '.crt': 'text/x-x509-ca-cert',
      '.key': 'text/plain',
      '.pub': 'text/plain'
    };

    for (const [ext, mime] of Object.entries(mimeMap)) {
      if (fileName.endsWith(ext)) {
        return mime;
      }
    }

    return 'text/plain'; // Default
  }
}
// ===== Content Conversion Utilities =====

export class ContentConverter {
  /**
   * Build an image attachment from a `File`.
   *
   * 自动压缩(超阈值)+ 量取尺寸 + base64 编码 + 走 Domain Attachment 形态。
   */
  static async fileToImageContent(file: File): Promise<Attachment> {
    if (!FileProcessor.isImageFile(file)) {
      throw new Error(`Unsupported image format: ${file.type}`);
    }
    if (!FileProcessor.isFileSizeValid(file)) {
      throw new Error(`File size exceeds limit: ${file.size} bytes`);
    }

    let processedFile = file;
    try {
      const needsCompression = await shouldCompressImageAdvanced(file);
      if (needsCompression) {
        const compressionResult = await smartCompressImage(file);
        processedFile = compressionResult.compressedFile;
      }
    } catch {
      // 压缩失败 → 用原文件继续
      processedFile = file;
    }

    const dataUrl = await FileProcessor.fileToDataURL(processedFile);
    let width: number | undefined;
    let height: number | undefined;
    try {
      const dimensions = await getImageDimensions(processedFile);
      width = dimensions.width;
      height = dimensions.height;
    } catch {
      // ignore — token 估算 fallback
    }

    return makeImageAttachment({
      dataUrl,
      fileName: file.name,
      fileSize: processedFile.size,
      mimeType: FileProcessor.getMimeType(processedFile),
      width,
      height,
      detail: 'auto',
    });
  }

  /**
   * 草稿态图片附件 —— 只持有元数据,`source.data` 留空占位。
   *
   * 「内联 vs 落 sandbox」的判别已搬到 main(发送时 `processImage` IPC 算一次),
   * 所以 attach 阶段不再压缩、不再决定形态,也不读 dataUrl(预览用 objectURL)。
   * 不做 5MB 大小校验:大图本就该落 sandbox(原图),旧流程的 opaque 路径也从不校验。
   */
  static imageDraftContent(file: File): Attachment {
    if (!FileProcessor.isImageFile(file)) {
      throw new Error(`Unsupported image format: ${file.type}`);
    }
    return {
      kind: 'image',
      fileName: file.name,
      fileSize: file.size,
      mimeType: FileProcessor.getMimeType(file),
      source: { kind: 'dataUrl', data: '' },
      detail: 'auto',
    };
  }

  /**
   * 由 main `processImage` 的 inline 判别结果重建终态内联图片附件。base64 是原始
   * 字节(< 256KB 解码,无需压缩);mimeType / width / height 取 main 用 sharp 测得的值。
   */
  static imageFromInline(input: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    base64: string;
    width?: number;
    height?: number;
  }): Attachment {
    return {
      kind: 'image',
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      source: { kind: 'dataUrl', data: input.base64 },
      width: input.width,
      height: input.height,
      detail: 'auto',
    };
  }

  /**
   * 由 main `processImage` 的 sandbox 判别结果重建终态「落盘图片」附件。
   * 大图(解码 ≥ 阈值)原图已落 session sandbox,这里**保持 `kind:'image'`**,
   * 只把 source 设成 `fileRef` 指向 `local://uploads/<name>` —— 不再降级成 opaque。
   *
   * egress(messageBridge)对 fileRef image 不内联,改走文件注解让模型按需 `read`;
   * renderer(AttachmentList)按 fileRef 异步读盘出缩略图。mimeType / width / height
   * 取 main 用 sharp 测得的值。
   */
  static imageFromFileRef(input: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    uri: FileUri;
    width?: number;
    height?: number;
  }): Attachment {
    return {
      kind: 'image',
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      source: { kind: 'fileRef', uri: input.uri },
      width: input.width,
      height: input.height,
      detail: 'auto',
    };
  }

  /**
   * Build a text-file attachment. `fileUri` 必须是已物化进 sandbox 的
   * `local://` / `knowledge://` URI;物化时机由调用方掌控
   * (现行流程:`Attachments` atom 的 `createMessage` 在发送时才物化)。
   * 草稿态(尚未物化)传空串占位,渲染层据此禁用预览,发送时再以真 URI 重建。
   */
  static async fileToFileContent(file: File, fileUri: FileUri): Promise<Attachment> {
    if (!FileProcessor.isTextFile(file)) {
      throw new Error(`Unsupported file format: ${file.type}`);
    }
    return makeFileAttachment({
      fileName: file.name,
      fileUri,
      fileSize: file.size,
      mimeType: FileProcessor.getMimeType(file),
      lastModified: file.lastModified,
      detail: 'auto',
    });
  }

  static async fileToOthersContent(file: File, fileUri: FileUri): Promise<Attachment> {
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
    return makeOpaqueAttachment({
      fileName: file.name,
      fileUri,
      fileSize: file.size,
      mimeType: FileProcessor.getMimeType(file),
      fileExtension,
      description: `Other file type: ${file.name} (${fileExtension.toUpperCase()})`,
    });
  }

  static async fileToOfficeContent(file: File, fileUri: FileUri): Promise<Attachment> {
    if (!FileProcessor.isOfficeFile(file)) {
      throw new Error(`Unsupported Office file format: ${file.type || file.name}`);
    }
    return makeOfficeAttachment({
      fileName: file.name,
      fileUri,
      fileSize: file.size,
      mimeType: FileProcessor.getMimeType(file),
      lastModified: file.lastModified,
      detail: 'auto',
    });
  }
}

// ===== Content Statistics Utilities =====

export class ContentAnalyzer {
  /**
   * 统计 Domain Attachment[] 各类附件数量与总字节,顺带给出粗 token 估算。
   * 不再包含 text 部分 —— Domain UserMessage.content 是单串,文字 token 由调用方
   * 自行算。
   */
  static analyzeContent(attachments: Attachment[]): {
    imageCount: number;
    fileCount: number;
    officeCount: number;
    othersCount: number;
    totalSize: number;
    estimatedTokens: number;
  } {
    let imageCount = 0;
    let fileCount = 0;
    let officeCount = 0;
    let othersCount = 0;
    let totalSize = 0;

    for (const att of attachments) {
      totalSize += att.fileSize;
      switch (att.kind) {
        case 'image':
          imageCount++;
          break;
        case 'text':
          fileCount++;
          break;
        case 'office':
          officeCount++;
          break;
        case 'opaque':
          othersCount++;
          break;
      }
    }

    const estimatedTokens =
      imageCount * 100 + fileCount * 50 + officeCount * 60 + othersCount * 10;

    return { imageCount, fileCount, officeCount, othersCount, totalSize, estimatedTokens };
  }

  static checkLimits(attachments: Attachment[]): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const analysis = this.analyzeContent(attachments);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (analysis.totalSize > FILE_ATTACHMENT_LIMITS.MAX_FILE_SIZE_BYTES * 5) {
      errors.push(`Total file size exceeds limit: ${analysis.totalSize} bytes`);
    }
    if (analysis.estimatedTokens > FILE_ATTACHMENT_LIMITS.MAX_TOKEN_BUDGET * 10) {
      warnings.push(`Estimated token count is high: ${analysis.estimatedTokens}`);
    }
    if (analysis.imageCount > 10) {
      warnings.push(`Large number of images: ${analysis.imageCount}`);
    }
    const totalDocumentCount = analysis.fileCount + analysis.officeCount;
    if (totalDocumentCount > 20) {
      warnings.push(`Large number of files: ${totalDocumentCount}`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}

// ===== Utility Function Exports =====

// Generate a unique ID
export const generateId = (prefix = 'content'): string => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
};

// Format file size
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Format line count
export const formatLineCount = (lines: number): string => {
  if (lines === 1) return '1 line';
  return `${lines.toLocaleString()} lines`;
};

// Get file icon class name (for UI display)
export const getFileIconClass = (mimeType: string, fileName: string): string => {
  if (mimeType.startsWith('image/')) return 'icon-image';
  if (mimeType.startsWith('text/')) return 'icon-text';

  const ext = fileName.toLowerCase().split('.').pop();
  const iconMap: Record<string, string> = {
    // Web technologies
    'js': 'icon-js',
    'ts': 'icon-ts',
    'jsx': 'icon-jsx',
    'tsx': 'icon-tsx',
    'mjs': 'icon-js',
    'cjs': 'icon-js',
    'css': 'icon-css',
    'scss': 'icon-css',
    'sass': 'icon-css',
    'less': 'icon-css',
    'stylus': 'icon-css',
    'html': 'icon-html',
    'htm': 'icon-html',
    'xhtml': 'icon-html',
    'vue': 'icon-vue',
    'svelte': 'icon-svelte',
    'json': 'icon-json',
    'json5': 'icon-json',
    'jsonc': 'icon-json',
    'xml': 'icon-xml',
    'svg': 'icon-svg',
    'yaml': 'icon-yaml',
    'yml': 'icon-yaml',
    'toml': 'icon-config',
    'ini': 'icon-config',
    'cfg': 'icon-config',
    'conf': 'icon-config',

    // Documents and markup
    'md': 'icon-markdown',
    'rst': 'icon-markdown',
    'txt': 'icon-text',
    'doc': 'icon-text',
    'rtf': 'icon-text',
    'tex': 'icon-latex',
    'latex': 'icon-latex',
    'bib': 'icon-latex',
    'org': 'icon-text',
    'adoc': 'icon-markdown',
    'asciidoc': 'icon-markdown',
    'wiki': 'icon-text',
    'mediawiki': 'icon-text',

    // Programming languages — C/C++ family
    'c': 'icon-c',
    'cc': 'icon-cpp',
    'cpp': 'icon-cpp',
    'cxx': 'icon-cpp',
    'c++': 'icon-cpp',
    'h': 'icon-h',
    'hpp': 'icon-h',
    'hxx': 'icon-h',
    'h++': 'icon-h',

    // Programming languages — mainstream
    'py': 'icon-python',
    'pyw': 'icon-python',
    'pyi': 'icon-python',
    'pyx': 'icon-python',
    'java': 'icon-java',
    'class': 'icon-java',
    'jar': 'icon-java',
    'scala': 'icon-scala',
    'kt': 'icon-kotlin',
    'kts': 'icon-kotlin',
    'cs': 'icon-csharp',
    'vb': 'icon-vb',
    'fs': 'icon-fsharp',
    'fsx': 'icon-fsharp',
    'fsi': 'icon-fsharp',
    'rs': 'icon-rust',
    'go': 'icon-go',
    'mod': 'icon-go',
    'rb': 'icon-ruby',
    'rbw': 'icon-ruby',
    'rake': 'icon-ruby',
    'php': 'icon-php',
    'php3': 'icon-php',
    'php4': 'icon-php',
    'php5': 'icon-php',
    'phtml': 'icon-php',
    'pl': 'icon-perl',
    'pm': 'icon-perl',
    't': 'icon-perl',
    'pod': 'icon-perl',
    'swift': 'icon-swift',
    'm': 'icon-objc',
    'mm': 'icon-objc',
    'r': 'icon-r',
    'R': 'icon-r',
    'rmd': 'icon-r',
    'rnw': 'icon-r',
    'jl': 'icon-julia',
    'julia': 'icon-julia',
    'dart': 'icon-dart',
    'flutter': 'icon-dart',
    'lua': 'icon-lua',

    // Shell and scripts
    'sh': 'icon-shell',
    'bash': 'icon-shell',
    'zsh': 'icon-shell',
    'fish': 'icon-shell',
    'csh': 'icon-shell',
    'tcsh': 'icon-shell',
    'ps1': 'icon-powershell',
    'psm1': 'icon-powershell',
    'psd1': 'icon-powershell',
    'bat': 'icon-batch',
    'cmd': 'icon-batch',

    // Assembly and system
    'asm': 'icon-assembly',
    's': 'icon-assembly',
    'S': 'icon-assembly',

    // Databases
    'sql': 'icon-database',
    'mysql': 'icon-database',
    'pgsql': 'icon-database',
    'sqlite': 'icon-database',

    // Containers and deployment
    'dockerfile': 'icon-docker',
    'containerfile': 'icon-docker',

    // Config files
    'env': 'icon-config',
    'envrc': 'icon-config',
    'editorconfig': 'icon-config',
    'gitignore': 'icon-git',
    'gitattributes': 'icon-git',
    'eslintrc': 'icon-eslint',
    'prettierrc': 'icon-prettier',
    'babelrc': 'icon-babel',
    'npmrc': 'icon-npm',
    'yarnrc': 'icon-yarn',
    'tsconfig': 'icon-typescript',
    'jsconfig': 'icon-javascript',
    'webpack': 'icon-webpack',
    'rollup': 'icon-rollup',
    'vite': 'icon-vite',
    'makefile': 'icon-makefile',
    'cmake': 'icon-cmake',
    'gradle': 'icon-gradle',
    'maven': 'icon-maven',
    'ant': 'icon-ant',
    'properties': 'icon-properties',
    'lock': 'icon-lock',

    // Data formats
    'csv': 'icon-csv',
    'tsv': 'icon-csv',
    'psv': 'icon-csv',
    'dsv': 'icon-csv',
    'log': 'icon-log',
    'out': 'icon-log',
    'err': 'icon-log',
    'trace': 'icon-log',

    // Other formats
    'patch': 'icon-diff',
    'diff': 'icon-diff',
    'rej': 'icon-diff',
    'spec': 'icon-rpm',
    'rpm': 'icon-rpm',
    'deb': 'icon-deb',
    'pem': 'icon-certificate',
    'crt': 'icon-certificate',
    'key': 'icon-key',
    'pub': 'icon-key'
  };

  return iconMap[ext || ''] || 'icon-file';
};