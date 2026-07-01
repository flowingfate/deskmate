/**
 * `web download` 内核 —— 从 HTTP/HTTPS URL 下载文件落盘。
 *
 * 业务逻辑由 `pi/tools/download.ts` 的 `downloadFileInternal` 平移而来,去掉
 * 原文件尾部的 `LocalTool` spec / JSON Schema 描述(`web download` AppCommand
 * 取代之,参数走 shell flag)。
 *
 * 设计要点:
 * - **失败不抛**:HTTP 失败 / 超限 / AbortError 等都收敛进 `DownloadResult`
 *   的 `{ success: false, error }`,caller(CLI)据此打印人话 / `(exit 1)`。
 * - **ctx 类型收窄为 `ResolveContext`**:内核只需要 profile/agent/session 三件
 *   套解析 URI sandbox,不依赖完整 `ToolContext`。AppCmdContext 在 call site
 *   现拼一个 `ResolveContext` 传入。
 * - `saveDirectory` 接受 `local://` / `knowledge://` URI 或 homedir 内绝对路径;
 *   `fileUri` 镜像入参形态(URI 进 → URI 出,abs 进 → abs 出)。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { InternalUrlRouter, isInternalUrlInput, type ResolveContext } from '@main/pi/internal-urls';

export interface DownloadArgs {
  url: string; // Download URL, HTTP/HTTPS only
  filename: string; // Filename to save as, including extension
  saveDirectory?: string; // local://, knowledge://, or absolute path. Default `local://` (current session sandbox).
  maxSizeBytes?: number; // Maximum file size, default 100MB
  timeout?: number; // Request timeout in ms, default 30 seconds
  overwrite?: boolean; // Whether to overwrite existing files, default false
  createDirectory?: boolean; // Whether to auto-create directory, default true
}

export interface DownloadResult {
  success: boolean;
  fileUri: string; // URI when saveDirectory is URI form (e.g. local://foo.png), absolute path otherwise.
  fileSize: number; // File size in bytes
  mimeType?: string; // File MIME type
  downloadTime: number; // Download duration in milliseconds
  error?: string; // Error message
  timestamp: string; // Operation timestamp
}

/**
 * Validate whether a URL is a valid HTTP/HTTPS link
 */
function validateUrl(url: string): { isValid: boolean; error?: string } {
  try {
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { isValid: false, error: 'Only HTTP and HTTPS protocols are supported' };
    }
    return { isValid: true };
  } catch {
    return { isValid: false, error: 'Invalid URL format' };
  }
}

/**
 * Validate that a filename is safe (prevents path traversal attacks)
 */
function validateFilename(filename: string): { isValid: boolean; error?: string } {
  // Check whether the filename contains path separators
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return { isValid: false, error: 'Filename cannot contain path separators or relative paths' };
  }

  // Check whether the filename is empty or contains only whitespace
  if (!filename.trim()) {
    return { isValid: false, error: 'Filename cannot be empty' };
  }

  // Check for characters not allowed on Windows/Linux
  const invalidChars = /[<>:"|?*\x00-\x1f]/;
  if (invalidChars.test(filename)) {
    return { isValid: false, error: 'Filename contains invalid characters' };
  }

  // Check length limit
  if (filename.length > 255) {
    return { isValid: false, error: 'Filename too long (max 255 characters)' };
  }

  return { isValid: true };
}

/**
 * 把 `saveDirectory` 解析成最终落盘的绝对路径,同时记录 LLM-visible 形态。
 *
 * URI 路径(`local://[<sub>]` / `knowledge://[<sub>]`):
 *  - 走 `router.resolveToPath` 拿到 sandbox 内绝对路径。`..` 越界由 handler 把守。
 *  - `createDirectory=true` 时按需 mkdir(handler 的 `resolveToPath` 不读 I/O)。
 *  - `uriBase` 保留原始 URI(去尾斜杠),给 result 拼回 LLM 可见的 `local://...`。
 *
 * 绝对路径(legacy):
 *  - `path.resolve` 标准化,**仍要求落在 homedir 内** —— LLM 拿到 abs path 时本就
 *    出离 sandbox,homedir 限制是最后一道防 `/etc` / `/System` 写入的闸。
 */
async function resolveSaveDirectory(
  saveDirectory: string,
  createDirectory: boolean,
  ctx: ResolveContext | undefined,
): Promise<
  | { isValid: true; abs: string; isUri: boolean; uriBase?: string }
  | { isValid: false; error: string }
> {
  const trimmed = saveDirectory.trim();
  if (isInternalUrlInput(trimmed)) {
    if (!ctx) {
      return { isValid: false, error: 'URI saveDirectory requires a tool context (profileId/agentId/sessionId).' };
    }
    try {
      const router = InternalUrlRouter.get();
      const abs = await router.resolveToPath(trimmed, ctx);
      // resolveToPath 不读 I/O —— 落盘前自己 ensure 目录;父目录(sessionDir 等)
      // 通常已经存在,但 sandbox 子路径(`local://reports/`)需要按需 mkdir。
      if (!fs.existsSync(abs)) {
        if (!createDirectory) {
          return { isValid: false, error: 'Save directory does not exist and createDirectory is false' };
        }
        try {
          fs.mkdirSync(abs, { recursive: true });
        } catch (error) {
          return { isValid: false, error: `Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
      } else {
        const stats = fs.statSync(abs);
        if (!stats.isDirectory()) {
          return { isValid: false, error: 'Save path exists but is not a directory' };
        }
      }
      // 保留完整 trimmed URI(含 `://`)给 joinInternalUri 解析 —— 自己 strip 尾斜杠
      // 会误伤 `local://` 的双斜杠协议分隔符,联合 helper 安全。
      return { isValid: true, abs, isUri: true, uriBase: trimmed };
    } catch (error) {
      return { isValid: false, error: `Failed to resolve URI saveDirectory: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  try {
    const normalizedPath = path.resolve(trimmed);
    const userHome = os.homedir();
    if (!normalizedPath.startsWith(userHome)) {
      return { isValid: false, error: 'Save directory must be within user home directory for security reasons' };
    }
    if (fs.existsSync(normalizedPath)) {
      const stats = fs.statSync(normalizedPath);
      if (!stats.isDirectory()) {
        return { isValid: false, error: 'Save path exists but is not a directory' };
      }
    } else if (createDirectory) {
      try {
        fs.mkdirSync(normalizedPath, { recursive: true });
      } catch (error) {
        return { isValid: false, error: `Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}` };
      }
    } else {
      return { isValid: false, error: 'Save directory does not exist and createDirectory is false' };
    }
    return { isValid: true, abs: normalizedPath, isUri: false };
  } catch (error) {
    return { isValid: false, error: `Invalid save directory: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

/**
 * 把 URI base + filename 合成 LLM 可见的完整 URI:
 *  - `local://` + `foo.png` → `local://foo.png`
 *  - `local://sub` + `foo.png` → `local://sub/foo.png`
 *  - `local://sub/` + `foo.png` → `local://sub/foo.png`
 *
 * 关键:`scheme://` 整段保留(不能被 trailing-slash strip 误伤);path 部分独立
 * 处理(strip 尾部 `/`,空 path 直接拼 filename)。
 */
function joinInternalUri(base: string, filename: string): string {
  const m = base.match(/^([a-z][a-z0-9+.-]*:\/\/)(.*)$/i);
  if (!m) return `${base}/${filename}`; // 理论不可达 —— caller 保证 base 是合法 URI
  const [, scheme, pathPart] = m;
  const cleanPath = pathPart.replace(/\/+$/, '');
  if (!cleanPath) return `${scheme}${filename}`;
  return `${scheme}${cleanPath}/${filename}`;
}

/**
 * Get common file extension for a given MIME type
 */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
  'application/json': '.json',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'application/zip': '.zip',
  'application/x-rar-compressed': '.rar',
  'video/mp4': '.mp4',
  'audio/mpeg': '.mp3',
};

/**
 * Validate arguments
 */
function validateArgs(args: DownloadArgs): { isValid: boolean; error?: string } {
  // Validate URL
  if (!args.url || typeof args.url !== 'string') {
    return { isValid: false, error: 'url is required and must be a string' };
  }

  const urlValidation = validateUrl(args.url);
  if (!urlValidation.isValid) {
    return { isValid: false, error: `Invalid URL: ${urlValidation.error}` };
  }

  // Validate filename
  if (!args.filename || typeof args.filename !== 'string') {
    return { isValid: false, error: 'filename is required and must be a string' };
  }

  const filenameValidation = validateFilename(args.filename);
  if (!filenameValidation.isValid) {
    return { isValid: false, error: `Invalid filename: ${filenameValidation.error}` };
  }

  // Validate maxSizeBytes
  if (args.maxSizeBytes !== undefined) {
    if (!Number.isInteger(args.maxSizeBytes) || args.maxSizeBytes < 1 || args.maxSizeBytes > 1073741824) {
      return { isValid: false, error: 'maxSizeBytes must be an integer between 1 and 1073741824 (1GB)' };
    }
  }

  // Validate timeout
  if (args.timeout !== undefined) {
    if (!Number.isInteger(args.timeout) || args.timeout < 1000 || args.timeout > 300000) {
      return { isValid: false, error: 'timeout must be an integer between 1000 and 300000 milliseconds' };
    }
  }

  // Validate saveDirectory
  if (args.saveDirectory !== undefined) {
    if (typeof args.saveDirectory !== 'string' || !args.saveDirectory.trim()) {
      return { isValid: false, error: 'saveDirectory must be a non-empty string' };
    }
  }

  return { isValid: true };
}

/**
 * 工具本体逻辑。失败路径不抛错,而是返回 `{ success: false, error }` —— HTTP
 * 失败、文件大小超限、AbortError 等都收敛到结果体,LLM 可读到原因。
 */
export async function downloadFileInternal(
  args: DownloadArgs,
  opts?: { signal?: AbortSignal; ctx?: ResolveContext },
): Promise<DownloadResult> {
  const startTime = Date.now();

  // 1. Validate arguments
  const validation = validateArgs(args);
  if (!validation.isValid) {
    throw new Error(`Invalid arguments: ${validation.error}`);
  }

  const {
    url,
    filename,
    saveDirectory = 'local://',
    maxSizeBytes = 100 * 1024 * 1024, // 100MB
    timeout = 30000, // 30 seconds
    overwrite = false,
    createDirectory = true,
  } = args;

  let displayFileUri = '';
  let fullFilePath = '';
  try {
    // 2. Resolve save directory (URI or absolute path)
    const resolved = await resolveSaveDirectory(saveDirectory, createDirectory, opts?.ctx);
    if (!resolved.isValid) {
      throw new Error(resolved.error);
    }

    fullFilePath = path.join(resolved.abs, filename);
    // LLM-visible 形态:URI 进 → URI 出;abs 进 → abs 出。统一规则保证 LLM 拿到的
    // fileUri 能直接喂给后续 read 等工具。
    displayFileUri = resolved.isUri
      ? joinInternalUri(resolved.uriBase!, filename)
      : fullFilePath;

    // 3. Check whether the file already exists
    if (fs.existsSync(fullFilePath) && !overwrite) {
      throw new Error(`File already exists: ${fullFilePath}. Set overwrite=true to replace it.`);
    }

    // 4. Initiate the download request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const externalSignal = opts?.signal;
    const fetchSignal = externalSignal
      ? AbortSignal.any([externalSignal, controller.signal])
      : controller.signal;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      signal: fetchSignal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // 5. Check file size
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > maxSizeBytes) {
      throw new Error(`File too large: ${contentLength} bytes exceeds limit of ${maxSizeBytes} bytes`);
    }

    // 6. Get MIME type
    const mimeType = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';

    // 7. Validate that file extension matches MIME type (warn but don't block)
    const expectedExt = MIME_TO_EXT[mimeType.toLowerCase()] || '';
    const actualExt = path.extname(filename).toLowerCase();
    if (expectedExt && actualExt !== expectedExt) {
      // expected vs actual 不一致:保持沉默(只写盘),原实现行为。
    }

    // 8. Download file content
    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const fileStream = fs.createWriteStream(fullFilePath);
    let downloadedBytes = 0;

    // Monitor download progress and enforce size limit
    for await (const chunk of response.body) {
      downloadedBytes += chunk.length;
      if (downloadedBytes > maxSizeBytes) {
        fileStream.close();
        fs.unlinkSync(fullFilePath); // Delete partially downloaded file
        throw new Error(`File too large: Downloaded ${downloadedBytes} bytes exceeds limit of ${maxSizeBytes} bytes`);
      }
      fileStream.write(chunk);
    }

    fileStream.end();

    // 9. Wait for file write to complete
    await new Promise<void>((resolve, reject) => {
      fileStream.on('finish', () => resolve());
      fileStream.on('error', reject);
    });

    const downloadTime = Date.now() - startTime;

    return {
      success: true,
      fileUri: displayFileUri,
      fileSize: downloadedBytes,
      mimeType,
      downloadTime,
      timestamp: new Date().toISOString(),
    };

  } catch (error) {
    const downloadTime = Date.now() - startTime;

    let errorMsg: string;
    if (error instanceof Error && error.name === 'AbortError') {
      errorMsg = opts?.signal?.aborted ? 'Download cancelled by user' : 'Download timed out';
    } else {
      errorMsg = error instanceof Error ? error.message : String(error);
    }

    return {
      success: false,
      fileUri: '',
      fileSize: 0,
      downloadTime,
      error: errorMsg,
      timestamp: new Date().toISOString(),
    };
  }
}
