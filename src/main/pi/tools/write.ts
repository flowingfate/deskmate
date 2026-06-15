/**
 * `write`:统一的文件写入(create / overwrite / append / prepend / insert)。
 *
 * 命名史:LLM-visible name 从 `write_file` 简化到 `write`(Phase 8a),
 * 文件名 / 内部 type / 变量名同步对齐到 `write` / `WriteTool*` /
 * `writeInternal`(Phase 8b)。
 *
 * 核心能力:
 * 1. 4 种 mode:overwrite(默认)/ append / prepend / insert(by line 或 by char position)
 * 2. JSON 文件可选写前校验(`validateJson` + 后缀 `.json`)
 * 3. append 模式 session tracker —— 支持大文件分块写,5 分钟无写入自动重置
 * 4. append 模式 newline 控制(addNewlineBefore / addNewlineAfter)
 * 5. 可选写前 backup(`backupBeforeWrite` 复制到 `<path>.backup.<ts>`)
 * 6. 支持 Base64 编码 content(`isBase64=true` 走 `Buffer.from(_, 'base64')`)
 * 7. 跨平台路径 normalize(`path.normalize`)
 *
 * 安全:阻止 directory traversal(`../`)与典型系统路径(/etc /usr /bin
 * /sbin /Windows /Program Files);单次 content 10MB 上限、最终文件 100MB
 * 上限,防误把仓库塞爆。
 */

import * as fs from 'fs/promises';
import { constants as fsConstants } from 'node:fs';
import * as path from 'path';

import { log } from '@main/log';
import {
  isInternalUrlInput,
  InternalUrlRouter,
  ResourceNotFoundError,
  toResolveContext,
  toWriteContext,
} from '@main/pi/internal-urls';
import type {
  WriteToolArgs,
  WriteToolResult,
  WriteMode,
} from '@shared/types/toolCallArgs';

import { jsonSchema } from './schema';
import type { LocalTool, ToolContext, ToolResult } from './types';

// Single-call content size limit: 10MB
const MAX_CONTENT_SIZE = 10 * 1024 * 1024;

// Maximum file size limit: 100MB (increased to support large file chunk writes)
const MAX_FILE_SIZE = 100 * 1024 * 1024;

// Session tracker: records the number of writes per file (used for large file chunking in append mode)
const writeSessionTracker = new Map<string, { chunkCount: number; lastWriteTime: number }>();

// Session timeout: reset count if no writes for 5 minutes
const SESSION_TIMEOUT = 5 * 60 * 1000;

// Restricted path patterns — blocks directory traversal and typical system
// directories on both Unix and Windows.
const DANGEROUS_PATH_PATTERNS: readonly RegExp[] = [
  /\.\.\//,           // Directory traversal
  /^\/etc\//i,        // Linux system directories
  /^\/usr\//i,
  /^\/bin\//i,
  /^\/sbin\//i,
  /^C:\\Windows/i,    // Windows system directories
  /^C:\\Program Files/i,
];

const VALID_MODES: readonly WriteMode[] = ['overwrite', 'append', 'prepend', 'insert'];

const PARAMETERS = jsonSchema({
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description:
        'A brief description of what is being written (for UI display). E.g., "Creating React component", "Updating config file"',
    },
    fileUri: {
      type: 'string',
      description: 'The full path or URI of the file (local://... | knowledge://... | absolute path)',
    },
    content: {
      type: 'string',
      description: 'The content to write (no escaping needed)',
    },
    mode: {
      type: 'string',
      enum: ['overwrite', 'append', 'prepend', 'insert'],
      description: 'Write mode. Default: overwrite',
    },
    encoding: {
      type: 'string',
      enum: ['utf-8', 'utf8', 'ascii', 'utf16le', 'ucs2', 'base64', 'latin1', 'binary', 'hex'],
      description: 'File encoding (default: utf-8)',
    },
    createIfNotExists: {
      type: 'boolean',
      description: 'Create file if it does not exist (default: true)',
    },
    createDirectories: {
      type: 'boolean',
      description: 'Create parent directories if they do not exist (default: true)',
    },
    validateJson: {
      type: 'boolean',
      description: 'For .json files: validate JSON format before writing (default: false)',
    },
    insertPosition: {
      type: 'number',
      description: 'For insert mode: character position to insert at (0-based)',
    },
    insertLine: {
      type: 'number',
      description: 'For insert mode: line number to insert at (1-based)',
    },
    addNewlineBefore: {
      type: 'boolean',
      description: 'For append mode: add newline before content if file exists (default: false)',
    },
    addNewlineAfter: {
      type: 'boolean',
      description: 'For append mode: add newline after content (default: true)',
    },
    sectionId: {
      type: 'string',
      description:
        'For append mode: identifier for the chunk (e.g., "header", "section1", "footer") - useful for debugging large file builds',
    },
    isLastChunk: {
      type: 'boolean',
      description:
        'For append mode: set to true when appending the final chunk - helps with cleanup and completion tracking',
    },
    isBase64: {
      type: 'boolean',
      description: 'Whether content is Base64 encoded (default: false)',
    },
    backupBeforeWrite: {
      type: 'boolean',
      description: 'Create a backup of original file before writing (default: false)',
    },
  },
  required: ['description', 'fileUri', 'content'],
});

const DESCRIPTION = `The unified tool for all file writing operations. Creates new files, overwrites existing files, or appends content.

**Modes:**
- \`overwrite\` (default): Create new file or replace entire content
- \`append\`: Add content to the end of file (with optional newline control)
- \`prepend\`: Add content to the beginning of file
- \`insert\`: Insert content at specific position or line number

**When to use each mode:**
| Scenario | Mode | Key Options |
|----------|------|-------------|
| Create a new file | overwrite | validateJson (for .json files) |
| Replace file content | overwrite | backupBeforeWrite |
| Add to end of file | append | addNewlineAfter, sectionId |
| Build large files in chunks | append | sectionId, isLastChunk |
| Add header to file | prepend | - |
| Insert at specific line | insert | insertLine |

**For large files (>5KB):** Use multiple \`append\` calls with \`sectionId\` to track progress and \`isLastChunk: true\` on the final call.`;

/**
 * Parameter validation (preserved as a function — three+ branches, returns
 * structured `{isValid,error}` consumed by the caller's early-return pattern).
 */
function validateArgs(args: WriteToolArgs): { isValid: boolean; error?: string } {
  // Check required parameters
  if (!args.fileUri || typeof args.fileUri !== 'string') {
    return { isValid: false, error: 'fileUri is required and must be a string' };
  }

  if (args.content === undefined || args.content === null) {
    return { isValid: false, error: 'content is required' };
  }

  if (typeof args.content !== 'string') {
    return { isValid: false, error: 'content must be a string' };
  }

  // Check content size
  const contentSize = Buffer.byteLength(args.content, (args.encoding || 'utf-8') as BufferEncoding);
  if (contentSize > MAX_CONTENT_SIZE) {
    return {
      isValid: false,
      error: `Content size (${contentSize} bytes) exceeds maximum allowed (${MAX_CONTENT_SIZE} bytes). Consider splitting into smaller chunks using append mode.`,
    };
  }

  // Check write mode
  if (args.mode && !VALID_MODES.includes(args.mode)) {
    return {
      isValid: false,
      error: `Invalid mode: ${args.mode}. Valid modes: ${VALID_MODES.join(', ')}`,
    };
  }

  // In insert mode, insertPosition and insertLine cannot both be specified
  if (args.mode === 'insert' && args.insertPosition !== undefined && args.insertLine !== undefined) {
    return {
      isValid: false,
      error: 'Cannot specify both insertPosition and insertLine for insert mode',
    };
  }

  // Restricted system paths only apply to filesystem paths;internal URLs
  // (`local://` / `knowledge://` / ...)走 sandbox handler 自己做边界检查。
  if (!isInternalUrlInput(args.fileUri)) {
    for (const pattern of DANGEROUS_PATH_PATTERNS) {
      if (pattern.test(args.fileUri)) {
        return { isValid: false, error: 'File path contains restricted system directory' };
      }
    }
  }

  return { isValid: true };
}

/**
 * 工具本体:校验 → 解码 → JSON 校验 → session 推进 → 读原内容 → 计算
 * 最终 content → 写文件 → session 收尾。
 *
 * **分流**:`args.fileUri` 形如 `scheme://...` 时走 internal URL 路径
 * (`InternalUrlRouter`),否则走本地文件系统路径。两条路径共享 mode 计算
 * 与 session tracker;I/O 边界(read 原文 / 写盘 / mkdir / backup)各自处理。
 *
 * **不抛**:所有失败路径都返回 `{ success: false, error }`,LLM 在
 * `tool_result` 里看到可读错误。`options.signal` 当前不接,`fs.writeFile`
 * 不原生支持 abort —— 保留 opts 形态对齐 handler 契约。
 *
 * `options.ctx` 是 internal URL 路径的必需依赖(handler 需要 profileId /
 * agentId / sessionId)。`LocalTool.handler` 总是会传;只在测试入口可省略
 * (那种情况下若用户传了 internal URL,会拿到 "ctx required" 错误)。
 */
export async function writeInternal(
  args: WriteToolArgs,
  options?: { signal?: AbortSignal; ctx?: ToolContext },
): Promise<WriteToolResult> {
  const startTime = Date.now();
  const executionId = `write_${startTime}`;
  const mode = args.mode || 'overwrite';

  log.info({ msg: `WriteTool execution started`, mod: 'WriteTool', executionId, fileUri: args.fileUri, mode, contentLength: args.content?.length, sectionId: args.sectionId });

  try {
    // 1. Parameter validation
    const validation = validateArgs(args);
    if (!validation.isValid) {
      log.error({ msg: `Arguments validation failed: ${validation.error}`, mod: 'WriteTool', executionId, err: validation.error });
      return {
        success: false,
        fileUri: args.fileUri,
        bytesWritten: 0,
        totalSize: 0,
        mode,
        error: validation.error,
      };
    }

    // 2. Normalize parameters
    // Internal URL 不走 path.normalize —— scheme://host/path 形态被规范化会
    // 把 `://` 变成 `:/`,直接破坏。`normalizedPath` 在 URL 路径下等于 args.fileUri。
    const isInternalUrl = isInternalUrlInput(args.fileUri);
    const normalizedPath = isInternalUrl ? args.fileUri : path.normalize(args.fileUri);
    const encoding = (args.encoding || 'utf-8') as BufferEncoding;
    const createIfNotExists = args.createIfNotExists !== false;
    const createDirectories = args.createDirectories !== false;

    // 3. Decode content (if Base64)
    let content = args.content;
    if (args.isBase64) {
      try {
        content = Buffer.from(args.content, 'base64').toString(encoding);
      } catch (e) {
        return {
          success: false,
          fileUri: normalizedPath,
          bytesWritten: 0,
          totalSize: 0,
          mode,
          error: 'Failed to decode Base64 content',
        };
      }
    }

    // 4. JSON validation (if required)
    let jsonValid: boolean | undefined;
    if (args.validateJson && normalizedPath.toLowerCase().endsWith('.json')) {
      try {
        const parsed = JSON.parse(content);
        jsonValid = parsed !== null && (typeof parsed === 'object' || Array.isArray(parsed));
        if (!jsonValid) {
          log.warn({ msg: `JSON content is valid but empty or primitive`, mod: 'WriteTool', executionId });
        }
      } catch (jsonError) {
        log.error({ msg: `JSON validation failed`, mod: 'WriteTool', executionId, err: jsonError });
        return {
          success: false,
          fileUri: normalizedPath,
          bytesWritten: 0,
          totalSize: 0,
          mode,
          jsonValid: false,
          error: `Invalid JSON content: ${jsonError instanceof Error ? jsonError.message : 'Parse error'}`,
        };
      }
    }

    // 5. Update session tracking (for chunked writes in append mode)
    const sessionKey = normalizedPath.toLowerCase();
    let session = writeSessionTracker.get(sessionKey);

    if (mode === 'append') {
      if (!session || (Date.now() - session.lastWriteTime > SESSION_TIMEOUT)) {
        session = { chunkCount: 0, lastWriteTime: Date.now() };
      }
      session.chunkCount++;
      session.lastWriteTime = Date.now();
      writeSessionTracker.set(sessionKey, session);
    }

    // Internal URL 路径需要 ctx 才能解析(profile/agent/session id)。
    if (isInternalUrl && !options?.ctx) {
      return {
        success: false,
        fileUri: normalizedPath,
        bytesWritten: 0,
        totalSize: 0,
        mode,
        error: `Writing to "${args.fileUri}" requires a tool context (profileId/agentId/sessionId).`,
      };
    }

    // 6. Check whether file exists / read original.
    //    Internal URL + overwrite:跳过 router.resolve —— overwrite 不消费 original,
    //    且对 read-only scheme(`skill://`)走 resolve 会被 "not found" 噪声掩盖
    //    后续 router.write 真正想抛的 "read-only" 错。
    let fileExists = false;
    let originalContent = '';
    let currentSize = 0;
    if (isInternalUrl) {
      if (mode !== 'overwrite') {
        try {
          const router = InternalUrlRouter.get();
          const resource = await router.resolve(normalizedPath, toResolveContext(options!.ctx!));
          originalContent = resource.content;
          fileExists = true;
          currentSize = Buffer.byteLength(originalContent, encoding);
        } catch (err) {
          if (err instanceof ResourceNotFoundError) {
            fileExists = false;
          } else {
            // 其它错误(权限/binary/超限/agent context 缺失等)上抛给 outer try。
            throw err;
          }
        }
      }
    } else {
      try {
        originalContent = await fs.readFile(normalizedPath, { encoding });
        fileExists = true;
        currentSize = Buffer.byteLength(originalContent, encoding);
      } catch {
        fileExists = false;
      }
    }

    // 7. If file does not exist and creation is not allowed, return error
    //    (internal URL 总是创建,createIfNotExists 静默忽略)
    if (!isInternalUrl && !fileExists && !createIfNotExists) {
      return {
        success: false,
        fileUri: normalizedPath,
        bytesWritten: 0,
        totalSize: 0,
        mode,
        error: `File does not exist: ${normalizedPath}. Set createIfNotExists=true to create it.`,
      };
    }

    // 8. Create parent directories (if needed) —— 仅 fs 路径;handler 自管目录。
    if (!isInternalUrl && createDirectories) {
      const dirPath = path.dirname(normalizedPath);
      await fs.mkdir(dirPath, { recursive: true });
    }

    // 9. Back up original file (if needed) —— 仅 fs 路径;internal URL 无 fs 路径
    //    可 copy,backupBeforeWrite 静默忽略。
    let backupPath: string | undefined;
    if (!isInternalUrl && fileExists && args.backupBeforeWrite) {
      backupPath = `${normalizedPath}.backup.${Date.now()}`;
      await fs.copyFile(normalizedPath, backupPath, fsConstants.COPYFILE_FICLONE);
      log.debug({ msg: `File backed up`, mod: 'WriteTool', executionId, backupPath });
    }

    // 10. Calculate final content
    let finalContent: string;
    let contentToWrite = content;

    // Newline control for append mode
    if (mode === 'append') {
      const addNewlineBefore = args.addNewlineBefore === true;
      const addNewlineAfter = args.addNewlineAfter !== false; // default true

      if (addNewlineBefore && fileExists && originalContent.length > 0) {
        contentToWrite = '\n' + contentToWrite;
      }
      if (addNewlineAfter) {
        contentToWrite = contentToWrite + '\n';
      }
    }

    switch (mode) {
      case 'overwrite':
        finalContent = contentToWrite;
        break;

      case 'append':
        finalContent = originalContent + contentToWrite;
        break;

      case 'prepend':
        finalContent = contentToWrite + originalContent;
        break;

      case 'insert':
        if (args.insertLine !== undefined) {
          // Insert by line
          const lines = originalContent.split('\n');
          const lineIndex = Math.max(0, Math.min(args.insertLine - 1, lines.length));
          lines.splice(lineIndex, 0, contentToWrite);
          finalContent = lines.join('\n');
        } else if (args.insertPosition !== undefined) {
          // Insert by character position
          const pos = Math.max(0, Math.min(args.insertPosition, originalContent.length));
          finalContent = originalContent.slice(0, pos) + contentToWrite + originalContent.slice(pos);
        } else {
          // Default: append
          finalContent = originalContent + contentToWrite;
        }
        break;

      default:
        finalContent = contentToWrite;
    }

    // 11. Check final file size
    const finalSize = Buffer.byteLength(finalContent, encoding);
    if (finalSize > MAX_FILE_SIZE) {
      return {
        success: false,
        fileUri: normalizedPath,
        bytesWritten: 0,
        totalSize: currentSize,
        mode,
        chunkNumber: session?.chunkCount,
        sectionId: args.sectionId,
        error: `Resulting file size (${finalSize} bytes) would exceed maximum allowed (${MAX_FILE_SIZE} bytes)`,
      };
    }

    // 12. Write file
    let totalSize: number;
    if (isInternalUrl) {
      const router = InternalUrlRouter.get();
      await router.write(normalizedPath, finalContent, toWriteContext(options!.ctx!));
      totalSize = finalSize;
    } else {
      await fs.writeFile(normalizedPath, finalContent, { encoding });
      const stats = await fs.stat(normalizedPath);
      totalSize = stats.size;
    }

    // 13. If this is the last chunk, clean up the session
    if (mode === 'append' && args.isLastChunk && session) {
      writeSessionTracker.delete(sessionKey);
      log.info({ msg: `File write session completed`, mod: 'WriteTool', executionId, fileUri: normalizedPath, totalChunks: session.chunkCount, totalSize: finalSize });
    }

    const bytesWritten = Buffer.byteLength(contentToWrite, encoding);

    const result: WriteToolResult = {
      success: true,
      fileUri: normalizedPath,
      bytesWritten,
      totalSize,
      mode,
      backupPath,
      jsonValid,
      chunkNumber: session?.chunkCount,
      sectionId: args.sectionId,
      isComplete: args.isLastChunk === true,
    };

    log.info({ msg: `WriteTool execution completed successfully`, mod: 'WriteTool', executionId, fileUri: normalizedPath, bytesWritten, totalSize, mode, chunkNumber: session?.chunkCount, sectionId: args.sectionId, dur: Date.now() - startTime });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({ msg: `WriteTool execution failed`, mod: 'WriteTool', executionId, err: error });

    return {
      success: false,
      fileUri: args.fileUri,
      bytesWritten: 0,
      totalSize: 0,
      mode,
      error: errorMessage,
    };
  }
}

/**
 * Inspect the chunked-append session for `fileUri` (used by tests / debug
 * tooling). Module-scope `writeSessionTracker` is the single source of truth.
 */
export function getWriteSessionInfo(
  fileUri: string,
): { chunkCount: number; lastWriteTime: number } | null {
  // 与 writeInternal 的 sessionKey 派生保持一致:internal URL 不走 path.normalize。
  const normalized = isInternalUrlInput(fileUri) ? fileUri : path.normalize(fileUri);
  return writeSessionTracker.get(normalized.toLowerCase()) || null;
}

/** Reset every tracked chunked-append session (for tests). */
export function clearAllWriteSessions(): void {
  writeSessionTracker.clear();
}

export const write: LocalTool = {
  spec: {
    name: 'write',
    description: DESCRIPTION,
    parameters: PARAMETERS,
  },
  async handler(args, ctx): Promise<ToolResult> {
    const result = await writeInternal(args as WriteToolArgs, { signal: ctx.signal, ctx });
    return { ok: true, content: JSON.stringify(result) };
  },
};
