/**
 * Phase 5 后的 chatTypes —— 只剩文件 / 图片相关常量与 LLM API 凭据形态。
 *
 * 历史:这里曾经承载 `Message` / `ContentPart` / `MessageHelper` / `ToolCall`
 * 等全套 Chat 形态。`ai.prompt/message.md` 重构把 Domain / Persisted Message
 * 一并沉到 `@shared/persist/types`，`fullModeCompressor` 算法整体迁到 Domain
 * 形态后,本文件只留下不带 Message 语义的工具常量(渲染端文件附件校验、LLM API 凭据)。
 *
 * 新代码不要往这里加 Message 相关定义。
 */

export interface LlmApiSettings {
  apiKey: string;
  endpoint: string;
  deploymentName: string;
  apiVersion: string;
}

// ===== Image support definitions - used by file processing tools =====
export enum ChatImageMimeType {
  PNG = 'image/png',
  JPEG = 'image/jpeg',
  GIF = 'image/gif',
  WEBP = 'image/webp',
  BMP = 'image/bmp',
}

// Image format validation - supported formats
export const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
] as const;

export const validateImageFile = (file: File): boolean => {
  return SUPPORTED_IMAGE_TYPES.includes(file.type as (typeof SUPPORTED_IMAGE_TYPES)[number]);
};

// ===== Renderer-side legacy file reference shapes =====
//
// `ChatReferenceFileData` + `FileReference` 仍被 renderer/lib/utilities/fileUtils.ts
// (FileAttachmentProcessor) 使用,服务"用户拖入文件 → 解析 → 上抛 Domain
// Attachment"路径上的中间形态。Domain `Attachment` 完成后这两条本可一并下线,
// 但目前 fileUtils 自带一些 metadata 抽取仍在用,留作单独议题。

export interface ChatReferenceFileData {
  readonly mimeType: string;
  data(): Promise<Uint8Array | string>;
  readonly reference?: string;
  readonly size?: number;
  readonly isText?: boolean;
  readonly fileName?: string;
  readonly text?: string;
  readonly fileReference?: FileReference;
}

export interface FileReference {
  filePath: string;
  fileName: string;
  fileSize: number;
  fileType?: string;
  mimeType?: string;
  startLine?: number;
  lineCount?: number;
  lastModified?: number;
  isTextFile?: boolean;
}

// Supported text file types
export const SUPPORTED_TEXT_TYPES = [
  'text/plain',
  'text/markdown',
  'text/javascript',
  'text/typescript',
  'text/css',
  'text/html',
  'text/json',
  'application/json',
  'text/xml',
  'application/xml',
  'text/yaml',
  'text/x-python',
  'text/x-java',
  'text/x-csharp',
  'text/x-cpp',
  'text/x-rust',
] as const;

// File attachment limits
export const FILE_ATTACHMENT_LIMITS = {
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5MB
  /**
   * 图片内联阈值,比较对象是【解码后像素大小】(width×height×4),不是编码字节 ——
   * PNG 对 UI 截图压得极好,编码字节是糟糕的代理(1064×768 截图编码仅 ~119KB)。
   * 解码大小 < 此值的小图(≈256×256)以 base64 dataUrl 随消息内联;≥ 此值的图改存进
   * session sandbox(opaque 附件),由 LLM 按需 `read` 查看(read backend 按 OpenAI
   * vision 指南压缩后回 base64),避免大图全尺寸 base64 每轮占满上下文。
   *
   * 判别点在 **main 进程**(`startup/ipc/attachment.ts` 的 `processImageAttachment`,
   * sharp 读尺寸),由 renderer 在发送时经 `processImage` IPC 触发、只算一次。
   */
  IMAGE_INLINE_MAX_BYTES: 256 * 1024, // 256KB
  MAX_TEXT_LINES: 2000,
  MAX_TOKEN_BUDGET: 600,
  SUPPORTED_TEXT_EXTENSIONS: [
    // Basic text files
    '.txt', '.md', '.rst', '.doc', '.rtf', '.pdf', '.docx', '.docm', '.pptx', '.pptm',
    // Web technologies
    '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
    '.css', '.scss', '.sass', '.less', '.stylus',
    '.html', '.htm', '.xhtml', '.vue', '.svelte',
    '.json', '.json5', '.jsonc', '.xml', '.svg',
    '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    // Programming languages - C/C++ family
    '.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hpp', '.hxx', '.h++',
    // Programming languages - others
    '.py', '.pyw', '.pyc', '.pyi', '.pyx',
    '.java', '.class', '.jar', '.scala', '.kt', '.kts',
    '.cs', '.vb', '.fs', '.fsx', '.fsi',
    '.rs', '.go', '.mod', '.sum',
    '.rb', '.rbw', '.gem', '.rake',
    '.php', '.php3', '.php4', '.php5', '.phtml',
    '.pl', '.pm', '.t', '.pod',
    '.swift', '.m', '.mm', '.h',
    '.r', '.R', '.rmd', '.rnw',
    '.jl', '.julia',
    '.dart', '.flutter',
    '.lua', '.luac',
    '.sh', '.bash', '.zsh', '.fish', '.csh', '.tcsh',
    '.ps1', '.psm1', '.psd1',
    '.bat', '.cmd',
    '.asm', '.s', '.S',
    '.sql', '.mysql', '.pgsql', '.sqlite',
    '.dockerfile', '.containerfile',
    // Configuration and data files
    '.env', '.envrc', '.editorconfig', '.gitignore', '.gitattributes',
    '.eslintrc', '.prettierrc', '.babelrc', '.npmrc', '.yarnrc',
    '.tsconfig', '.jsconfig', '.webpack', '.rollup', '.vite',
    '.makefile', '.cmake', '.gradle', '.maven', '.ant',
    '.properties', '.lock', '.sum', '.mod',
    // Markup languages and documents
    '.tex', '.latex', '.bib', '.cls', '.sty',
    '.org', '.adoc', '.asciidoc',
    '.wiki', '.mediawiki',
    // Data formats
    '.csv', '.tsv', '.psv', '.dsv',
    '.log', '.out', '.err', '.trace',
    // Other text formats
    '.patch', '.diff', '.rej',
    '.spec', '.rpm', '.deb',
    '.pem', '.crt', '.key', '.pub',
  ],
} as const;
