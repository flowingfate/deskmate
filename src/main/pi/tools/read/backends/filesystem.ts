/**
 * `read` 工具的本地文件系统 backend。
 *
 * 业务:流式分页读 + 三重安全限制(byte / line / line-length)。代码 9b 从旧
 * `pi/tools/readFile.ts` 整段搬过来 —— 旧 LocalTool wrapper 已下线,业务函
 * 数(readFilesystem / probeFile / detectFileType / detectMinified)就近内
 * 化到 backend,不再 export 给外部消费。
 *
 * 设计要点:
 * 1. createReadStream + readline,避免一次性把全文件吃进内存
 * 2. probe 阶段只读首 8KB,做 fileTypeHint + minified 检测
 * 3. 流式阶段三重限制:max_lines / max_bytes / max_line_length
 * 4. 二进制文件 probe 直接判出并拒绝;HTML / minified / json 类型只是 hint
 *
 * `ctx.signal` 暂未消费 —— readline + `for await` 在 stream 关闭时自然中止,
 * 接入 signal 也只在两次 await 之间生效。保留参数对齐 backend 契约。
 */
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as nodePath from 'path';
import * as readline from 'readline';

import type { ReadSelector } from '../path-utils';

// ============ Safety limit constants ============
export const READ_FILE_LIMITS = {
  MAX_BYTES_PER_CALL: 128 * 1024,    // 128KB - maximum bytes per call
  MAX_LINES_PER_CALL: 500,            // maximum lines returned per call
  MAX_LINE_LENGTH: 8 * 1024,          // 8KB - maximum length per line
  PROBE_SIZE: 8 * 1024,               // 8KB - bytes read in the probe phase
  HIGH_WATER_MARK: 64 * 1024,         // 64KB - stream buffer
} as const;

// ============ Type definitions ============
export type TruncationReason =
  | 'max_lines'
  | 'max_bytes'
  | 'max_line_length'
  | 'file_end'
  | 'none';

export type FileTypeHint =
  | 'text'
  | 'html'
  | 'json'
  | 'minified'
  | 'binary'
  | 'unknown';

/**
 * filesystem backend 的返回值。LLM 看到的是这个对象 JSON.stringify 后的字符串
 * —— 字段名与 `fullModeCompressor.buildReadPreview` 消费的形状对齐
 * (`startLine` / `endLine` / `totalLines` 等用于结构化预压缩)。
 */
export interface FilesystemReadResult {
  content: string;
  fileName: string;
  startLine: number;
  endLine: number;
  totalLines?: number;            // best-effort, may not be exact
  totalLinesEstimated?: boolean;
  size: number;
  truncated: boolean;
  truncationReason?: TruncationReason;
  fileTypeHint: FileTypeHint;
  fileSizeBytes: number;
  bytesRead: number;
}

export interface FilesystemBackendArgs {
  /** 已剥离 selector 的本地路径(相对或绝对)。 */
  readonly path: string;
  readonly selector: ReadSelector;
  readonly signal?: AbortSignal;
}

/**
 * 读本地文件。Selector → 内部 startLine/endLine 翻译:
 * - selector.ranges[0].startLine / endLine 直接对应
 * - selector.raw 当前不改行为(MVP);后续可用来跳过 minified hint / 不截 long line
 * - selector.pages 在 filesystem backend 无意义,直接忽略
 */
export async function readFilesystem(
  args: FilesystemBackendArgs,
): Promise<FilesystemReadResult> {
  if (!args.path) {
    throw new Error('No file path provided.');
  }
  const [range] = args.selector.ranges;
  const startLine = range?.startLine ?? 1;
  const endLine = range?.endLine; // 未指定 = open-ended (走 MAX_LINES_PER_CALL)

  validateBounds(startLine, endLine);

  try {
    return await readFileWithStreamPagination({
      path: args.path,
      startLine,
      endLine,
    });
  } catch (error) {
    throw new Error(
      `File read failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

// ============ Validation ============
function validateBounds(startLine: number, endLine: number | undefined): void {
  if (!Number.isInteger(startLine) || startLine < 1) {
    throw new Error('startLine must be a positive integer');
  }
  if (endLine !== undefined) {
    if (!Number.isInteger(endLine) || endLine < 1) {
      throw new Error('endLine must be a positive integer');
    }
    if (startLine > endLine) {
      throw new Error('startLine cannot be greater than endLine');
    }
  }
}

// ============ Phase 1: Probe (lightweight probing) ============
/**
 * Probe file type and characteristics; reads only the first 8KB so we can
 * decide fileTypeHint + minified-ness without slurping the whole file.
 */
async function probeFile(path: string): Promise<{
  fileSize: number;
  fileTypeHint: FileTypeHint;
  isMinified: boolean;
}> {
  const stat = await fsPromises.stat(path);
  const fileSize = stat.size;
  // Read the first PROBE_SIZE bytes for probing
  const probeBuffer = Buffer.alloc(READ_FILE_LIMITS.PROBE_SIZE);
  const fd = await fsPromises.open(path, 'r');
  try {
    const { bytesRead } = await fd.read(probeBuffer, 0, READ_FILE_LIMITS.PROBE_SIZE, 0);
    const probeContent = probeBuffer.subarray(0, bytesRead).toString('utf8');
    return {
      fileSize,
      fileTypeHint: detectFileType(probeContent),
      isMinified: detectMinified(probeContent),
    };
  } finally {
    await fd.close();
  }
}

/** Detect file type from probe content. */
function detectFileType(content: string): FileTypeHint {
  // Binary detection: contains null characters
  if (content.includes('\0')) return 'binary';
  // HTML detection: well-known root/structural tags
  if (/<(!DOCTYPE|html|head|body|div|span)/i.test(content)) return 'html';
  // JSON detection: starts with `[` or `{` (after optional whitespace)
  if (/^\s*[\[{]/.test(content)) return 'json';
  return 'text';
}

/**
 * Detect whether the file is machine-generated / minified by probe content.
 *
 * Two heuristics OR'd:
 * - 平均行长 > 500 字符:正常代码/文本几乎不会到这个值;minified JS/CSS 把
 *   整段塞进一行
 * - 1KB+ 内容只有 <5 行:同样指向"没换行"形态(整段 base64 / minified)
 *
 * 阈值是经验值,不是 spec;调阈值前先扫一遍 fixture,避免误报正常长文档。
 */
function detectMinified(content: string): boolean {
  const lines = content.split('\n');
  const avgLineLength = content.length / Math.max(lines.length, 1);
  return avgLineLength > 500 || (content.length > 1000 && lines.length < 5);
}

// ============ Phase 2: Streaming read with triple safety limits ============
/**
 * Stream-read the file with three hard caps: line count, byte count,
 * per-line length. Never loads the full file into memory.
 */
async function readFileWithStreamPagination(args: {
  path: string;
  startLine: number;
  endLine: number | undefined;
}): Promise<FilesystemReadResult> {
  const { path, startLine, endLine } = args;

  // Phase 1: Probe — cheap front-of-file inspection
  const { fileSize, fileTypeHint, isMinified } = await probeFile(path);

  // Extract file name from path
  const fileName = nodePath.basename(path);

  // Reject binary files immediately — caller should use a binary-aware tool
  if (fileTypeHint === 'binary') {
    return {
      content: '[Binary file detected - use appropriate tool for binary files]',
      fileName,
      startLine,
      endLine: startLine,
      truncated: true,
      truncationReason: 'max_bytes',
      fileTypeHint,
      fileSizeBytes: fileSize,
      bytesRead: 0,
      size: 0,
    };
  }

  // Phase 2: Stream read via readline
  const stream = fs.createReadStream(path, {
    encoding: 'utf8',
    highWaterMark: READ_FILE_LIMITS.HIGH_WATER_MARK,
  });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const resultLines: string[] = [];
  let currentLine = 0;
  let totalBytes = 0;
  let truncated = false;
  let truncationReason: TruncationReason = 'none';
  let hasLongLines = false;

  // Calculate the effective maximum number of lines:
  // explicit endLine wins, otherwise fall back to the MAX_LINES_PER_CALL cap.
  const requestedLines = endLine !== undefined
    ? endLine - startLine + 1
    : READ_FILE_LIMITS.MAX_LINES_PER_CALL;
  const effectiveMaxLines = Math.min(requestedLines, READ_FILE_LIMITS.MAX_LINES_PER_CALL);

  try {
    for await (const line of rl) {
      currentLine++;
      // Skip lines before startLine
      if (currentLine < startLine) continue;

      // Check endLine limit — we've passed the caller's requested range
      if (endLine !== undefined && currentLine > endLine) {
        truncationReason = 'file_end';
        break;
      }
      // Check line count limit
      if (resultLines.length >= effectiveMaxLines) {
        truncated = true;
        truncationReason = 'max_lines';
        break;
      }

      // Handle excessively long lines — truncate and mark as minified hint
      let processedLine = line;
      if (line.length > READ_FILE_LIMITS.MAX_LINE_LENGTH) {
        hasLongLines = true;
        processedLine =
          line.slice(0, READ_FILE_LIMITS.MAX_LINE_LENGTH) +
          `\n[... ${line.length - READ_FILE_LIMITS.MAX_LINE_LENGTH} chars truncated ...]`;
      }

      // Check byte limit
      if (totalBytes + processedLine.length > READ_FILE_LIMITS.MAX_BYTES_PER_CALL) {
        truncated = true;
        truncationReason = 'max_bytes';
        break;
      }
      totalBytes += processedLine.length + 1; // +1 for newline
      resultLines.push(processedLine);
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  // If not truncated by a limit, we reached the end of the file
  if (!truncated && truncationReason === 'none') truncationReason = 'file_end';

  // Adjust fileTypeHint — overly long lines also count as minified
  const finalFileTypeHint: FileTypeHint = isMinified || hasLongLines ? 'minified' : fileTypeHint;
  const resultContent = resultLines.join('\n');
  const actualEndLine = startLine + resultLines.length - 1;

  return {
    content: resultContent,
    fileName,
    startLine,
    endLine: Math.max(actualEndLine, startLine),
    // totalLines is only precise when the entire file was read
    totalLines: !truncated && startLine === 1 ? currentLine : undefined,
    totalLinesEstimated: truncated || startLine > 1,
    size: resultContent.length,
    truncated,
    truncationReason: truncated ? truncationReason : undefined,
    fileTypeHint: finalFileTypeHint,
    fileSizeBytes: fileSize,
    bytesRead: totalBytes,
  };
}
