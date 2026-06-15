/**
 * `search`:文件内容(非文件名)的多模式搜索。
 *
 * 命名史:LLM-visible name 从 `search_file_contents` 简化到 `search`
 * (Phase 8a),文件名 / 内部 type / 变量名同步对齐到 `search` / `SearchTool*`
 * / `searchInternal`(Phase 8b)—— 与 PI 范式对齐。
 *
 * Key features:
 *  - workspaceRoot(required)用于全局扫描或解析相对路径。
 *  - 支持 literal(大小写不敏感)与 `/regex/` 模式(自动追加 `i` flag)。
 *  - 简单 glob 过滤:`*`, `*.ext`, `**\/*.ext`(不做复杂 wildcard 解析)。
 *  - 上下文 0–2 行;聚合输出 "match blocks"(命中行以 `>` 前缀标记)。
 *  - 资源限制:files ≤ 80,fileSize ≤ 512 KB,matchBlocks/file ≤ 5,
 *    totalMatchLines ≤ 300,timeout 4 s。
 *  - 忽略目录:`.git`, `node_modules`, `dist`, `build`, `coverage`, `.cache`, `out`。
 */

import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';

import { resolveWorkspaceRootArg } from './util/workspaceRoot';

import { jsonSchema } from './schema';
import type { LocalTool, ToolResult } from './types';

// Limit constants
const MAX_FILES = 80;                   // Maximum files to traverse per search
const MAX_FILE_SIZE_KB = 512;           // Maximum size per file allowed for scanning (KB)
const MAX_MATCHES_PER_FILE = 5;         // Maximum match blocks returned per file
const MAX_TOTAL_MATCHES = 300;          // Global match line limit
const TIMEOUT_MS = 4000;                // Search timeout (milliseconds)
const LINE_TRUNCATE = 500;              // Per-line truncation length to avoid excessive output
const MAX_INPUT_PATHS = 10;             // Maximum number of paths allowed in the paths parameter
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', 'out']); // Directories skipped during traversal

export interface SearchToolArgs {
  patterns: string[];     // Required: substrings or /regex/ collection (searched serially)
  workspaceRoot: string;  // Required: search root directory (absolute path), for global scanning or resolving relative paths
  description?: string;   // Optional: Operation description for UI display
  path?: string;          // Optional: single file/directory (relative to workspaceRoot)
  paths?: string[];       // Optional: multiple paths (relative to workspaceRoot; takes priority over path)
  fileGlob?: string;      // Optional: *  | *.ext | **/*.ext
  context?: number;       // Optional: 0–2, default 1
}

export interface SearchMatchBlock {
  startLine: number;     // First line of the match block (including context)
  endLine: number;       // Last line of the match block (including context)
  lines: string[];       // Each formatted result line; '>' marks a hit line, ' ' marks a context line, e.g. "> 0012: matched" / "  0011: context"
  matchCount: number;    // Number of actual hit lines in this block
}

export interface SearchFileResult {
  file: string;                  // Relative to root or absolute (if no root)
  matches: SearchMatchBlock[];
}

export interface SearchPatternResult {
  pattern: string;               // The pattern currently being executed
  results: SearchFileResult[]; // List of files with matches
  filesScanned: number;          // Number of files traversed for this pattern
  totalMatches: number;          // Total number of hit lines for this pattern
  durationMs: number;            // Execution time for a single pattern
  warnings?: string[];           // Non-fatal warnings at the pattern level
}

export interface SearchToolResult {
  success: boolean;               // Whether a fatal error was encountered
  patterns: string[];             // Actual patterns used for searching
  paths: string[] | null;         // Final paths included in the search: relative to root; null if global scan
  fileGlob?: string;              // Active simple glob filter (undefined if validation failed)
  patternResults: SearchPatternResult[]; // Search results divided by pattern
  errors?: string[];              // Non-fatal global-level warnings/informational messages
  timestamp: string;              // Execution completion time (ISO string)
}

interface ResolvedTarget {
  abs: string;
  rel: string;
  isFile: boolean;
}

interface PatternWalkCounters {
  totalMatchesRef: () => number;
  incMatches: (count: number) => void;
  filesScannedRef: () => number;
  incFiles: () => void;
}

interface PatternWalkControl {
  timeoutAt: number;
  fileGlob?: string;
}

interface PatternWalkCtx {
  isRegex: boolean;
  regex: RegExp | null;
  literal: string | null;
  context: number;
  results: SearchFileResult[];
  errors: string[];
  visitedFiles: Set<string>;
  counters: PatternWalkCounters;
  control: PatternWalkControl;
}

const DESCRIPTION =
  'Search text content INSIDE files (not filenames or paths) for one or more literal (case-insensitive) or /regex/ patterns. REQUIRES workspaceRoot — accepts (a) an absolute filesystem path or (b) an internal URI: `local://` (current session sandbox root), `local://<sub/dir>` (sub-path), `knowledge://` (current agent KB root), `knowledge://<sub/dir>`. Optional path/paths specify subdirectories/files (relative to workspaceRoot). Omit path/paths to scan entire workspace. URI sandbox not yet materialized → empty result without error. Supported globs: *, *.ext, **/*.ext. Limits: files=80 fileSize<=512KB matchesPerFile=5 totalMatches=300 timeout=4s. context=0-2 (default 1).';

const PARAMETERS = jsonSchema({
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: 'A brief description of what is being searched (for UI display). E.g., "Finding error handlers", "Searching for API endpoints"',
    },
    patterns: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      description: 'List of search patterns. Use /regex/ for regex entries; otherwise literal substring (case-insensitive).',
    },
    workspaceRoot: {
      type: 'string',
      description: 'REQUIRED: Workspace root. Accepts (a) an absolute filesystem path or (b) an internal URI (`local://[sub]`, `knowledge://[sub]`). Defines search scope. If path/paths omitted, scans entire workspace.',
    },
    path: {
      type: 'string',
      description: 'Optional single file or directory (relative to workspaceRoot). Ignored if paths provided.',
    },
    paths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional multiple files/dirs (relative to workspaceRoot). Max 10. Takes priority over path.',
    },
    fileGlob: {
      type: 'string',
      description: 'Optional simple glob (*, *.ext, **/*.ext) applied only to directory traversal.',
    },
    context: {
      type: 'number',
      minimum: 0,
      maximum: 2,
      description: 'Context lines before/after match (0-2, default 1).',
    },
  },
  required: ['description', 'patterns', 'workspaceRoot'],
});

/** 工具本体逻辑;签名供测试 / dev 调用。 */
export async function searchInternal(
  args: SearchToolArgs,
  _opts?: { signal?: AbortSignal },
): Promise<SearchToolResult> {

  // 1. Validate arguments
  const validation = validateArgs(args);
  if (!validation.isValid) {
    throw new Error(validation.error || 'Invalid arguments provided');
  }

  const normalizedPatterns = validation.normalizedPatterns || [];

  // Pre-extract caller arguments into semantic variable names for later use
  const {
    context: inputContext,
    workspaceRoot: inputWorkspaceRoot,
    fileGlob,
    path: singlePath,
    paths: multiplePaths,
  } = {
    context: args.context,
    workspaceRoot: args.workspaceRoot,
    fileGlob: args.fileGlob,
    path: args.path,
    paths: args.paths,
  };

  const errors: string[] = [];
  const start = Date.now();

  if (validation.removedEntries && validation.removedEntries > 0) {
    errors.push('patterns list contained invalid or duplicate entries that were removed');
  }

  let context = 1; // Default context: 1 line
  if (inputContext !== undefined) {
    if (!Number.isInteger(inputContext) || inputContext < 0) {
      errors.push('context invalid, defaulted to 1');
    } else if (inputContext > 2) {
      errors.push('context >2 capped to 2');
      context = 2;
    } else {
      context = inputContext;
    }
  }

  // 2. Resolve paths
  // Normalize workspaceRoot: null if empty, otherwise resolve to absolute path
  let workspaceRoot: string | null = null;
  if (typeof inputWorkspaceRoot === 'string' && inputWorkspaceRoot.trim()) {
    workspaceRoot = path.resolve(inputWorkspaceRoot.trim());
  }

  // Resolve path/paths -> absolute path set; error if both missing and no workspaceRoot
  const resolvedTargets = await resolveTargets({ ...args, path: singlePath, paths: multiplePaths }, workspaceRoot, errors);
  if (resolvedTargets.length === 0 && !workspaceRoot) {
    throw new Error('Provide workspaceRoot for global/relative search or specify at least one absolute path');
  }

  // Simple glob support: limited to controlled patterns; warn if not matched
  let normalizedGlob: string | undefined;
  if (fileGlob) {
    const trimmedGlob = fileGlob.trim();
    if (isSupportedSimpleGlob(trimmedGlob)) normalizedGlob = trimmedGlob;
    else errors.push(`Unsupported fileGlob ignored: ${fileGlob}`);
  }

  try {
    const effectiveRoots = resolvedTargets.length > 0 ? resolvedTargets : (workspaceRoot ? [{ abs: workspaceRoot, rel: '', isFile: false }] : []);
    const patternResults: SearchPatternResult[] = [];

    // Search each pattern serially and append results
    for (const pattern of normalizedPatterns) {
      const patternStart = Date.now();
      const patternWarnings: string[] = [];
      // 3. Build matcher - supports literal and regex patterns
      const { isRegex, regex, literal } = buildMatcher(pattern);

      const patternResultsForFiles: SearchFileResult[] = [];
      let totalMatches = 0;
      let filesScanned = 0;
      const visitedFiles = new Set<string>();
      const timeoutAt = patternStart + TIMEOUT_MS;

      const walkCtx: PatternWalkCtx = {
        isRegex, regex, literal, context, results: patternResultsForFiles, errors: patternWarnings, visitedFiles,
        counters: {
          totalMatchesRef: () => totalMatches,
          incMatches: (c: number) => { totalMatches += c; },
          filesScannedRef: () => filesScanned,
          incFiles: () => { filesScanned++; },
        },
        control: { timeoutAt, fileGlob: normalizedGlob },
      };

      // 4. Traverse targets - apply resource limits and glob filter
      for (const target of effectiveRoots) {
        if (Date.now() > timeoutAt) { patternWarnings.push('Search timeout reached'); break; }
        if (target.isFile) {
          await processFile(target.abs, target.rel || path.basename(target.abs), workspaceRoot, walkCtx);
          if (totalMatches >= MAX_TOTAL_MATCHES) { patternWarnings.push('Global match limit reached'); break; }
        } else {
          await walkDirectory(target.abs, target.rel, workspaceRoot, walkCtx);
          if (totalMatches >= MAX_TOTAL_MATCHES) { patternWarnings.push('Global match limit reached'); break; }
        }
      }

      patternResults.push({
        pattern,
        results: patternResultsForFiles,
        filesScanned,
        totalMatches,
        durationMs: Date.now() - patternStart,
        warnings: patternWarnings.length > 0 ? patternWarnings : undefined,
      });

    }

    // 5. Process search results - assemble output structure
    const output: SearchToolResult = {
      success: true,
      patterns: normalizedPatterns,
      paths: resolvedTargets.length > 0 ? resolvedTargets.map(t => t.rel || (workspaceRoot ? '.' : t.abs)) : (workspaceRoot ? null : []),
      fileGlob: normalizedGlob,
      patternResults,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    };


    return output;
  } catch (error) {
    throw new Error(`search execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Resolve path/paths arguments into a deduplicated set of absolute paths
 */
async function resolveTargets(args: SearchToolArgs, workspaceRoot: string | null, errors: string[]): Promise<ResolvedTarget[]> {
  // Resolve path/paths -> absolute paths. paths takes priority; relative paths require workspaceRoot; use a Set for deduplication
  let rawList: string[] = [];
  if (Array.isArray(args.paths) && args.paths.length > 0) {
    rawList = args.paths.slice(0, MAX_INPUT_PATHS);
    if (args.paths.length > MAX_INPUT_PATHS) errors.push(`paths truncated to first ${MAX_INPUT_PATHS}`);
    if (args.path) errors.push('path ignored because paths provided');
  } else if (args.path) {
    rawList = [args.path];
  }

  const results: ResolvedTarget[] = [];
  const seen = new Set<string>();

  for (const pItem of rawList) {
    const trimmed = pItem.trim();
    if (!trimmed) continue;
    // Normalize to absolute path: use as-is if already absolute; resolve relative paths with workspaceRoot
    let abs: string;
    if (path.isAbsolute(trimmed)) {
      abs = path.normalize(trimmed);
    } else {
      if (!workspaceRoot) {
        errors.push(`Relative path without workspaceRoot skipped: ${pItem}`);
        continue;
      }
      abs = path.resolve(workspaceRoot, trimmed);
    }
    // If workspaceRoot is set, ensure the target is still inside it
    if (workspaceRoot) {
      const normRoot = path.resolve(workspaceRoot) + path.sep;
      const normAbs = path.resolve(abs) + path.sep;
      if (!normAbs.startsWith(normRoot)) { errors.push(`Path outside workspace skipped: ${pItem}`); continue; }
    }
    try {
      // Read file info to distinguish file/directory, and generate deduplication key
      const st = await fs.stat(abs);
      const rel = workspaceRoot ? path.relative(workspaceRoot, abs).replace(/\\/g, '/') : abs.replace(/\\/g, '/');
      const key = abs + '|' + (st.isFile() ? 'f' : 'd');
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ abs, rel, isFile: st.isFile() });
    } catch {
      errors.push(`Path not found skipped: ${pItem}`);
    }
  }
  return results;
}

/**
 * Check whether a glob is a supported simple pattern
 */
function isSupportedSimpleGlob(glob: string): boolean {
  // Validate whether it is a supported simple glob (controlled performance, no complex pattern expansion)
  if (glob === '*') return true;
  if (/^\*\.[A-Za-z0-9_]+$/.test(glob)) return true;
  if (/^\*\*[\\\/]\*\.[A-Za-z0-9_]+$/.test(glob)) return true;
  return false;
}

/**
 * Build a regex or literal matcher from a pattern
 */
function buildMatcher(pattern: string): { isRegex: boolean; regex: RegExp | null; literal: string | null } {
  // Parse pattern: /xxx/ -> RegExp(i); otherwise treat as literal in lowerCase; on failure, fall back to literal
  const trimmed = pattern.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('/') && trimmed.endsWith('/')) {
    const inner = trimmed.slice(1, -1);
    try { return { isRegex: true, regex: new RegExp(inner, 'i'), literal: null }; }
    catch { return { isRegex: false, regex: null, literal: trimmed.toLowerCase() }; }
  }
  return { isRegex: false, regex: null, literal: trimmed.toLowerCase() };
}

/**
 * Recursively walk a directory and run search on matching files
 */
async function walkDirectory(dirAbs: string, rel: string, workspaceRoot: string | null, ctx: PatternWalkCtx): Promise<void> {
  // Directory recursion: skip ignored dirs -> deep traversal -> early exit (file count/match count/timeout) -> call processFile for files
  const { errors, counters, control } = ctx;
  if (Date.now() > control.timeoutAt) { errors.push('Search timeout reached'); return; }
  let entries: Dirent[] = [];
  try { entries = await fs.readdir(dirAbs, { withFileTypes: true }); }
  catch { errors.push(`Cannot read directory: ${rel || '.'}`); return; }

  for (const ent of entries) {
    if (Date.now() > control.timeoutAt) { errors.push('Search timeout reached'); return; }
    const name = ent.name;
    if (ent.isDirectory()) {
      if (IGNORED_DIRS.has(name)) continue;
      const subAbs = path.join(dirAbs, name);
      const subRel = workspaceRoot ? path.relative(workspaceRoot, subAbs).replace(/\\/g, '/') : subAbs.replace(/\\/g, '/');
      await walkDirectory(subAbs, subRel, workspaceRoot, ctx);
      if (counters.filesScannedRef() >= MAX_FILES) { errors.push('File scan limit reached'); return; }
      if (counters.totalMatchesRef() >= MAX_TOTAL_MATCHES) return;
    } else if (ent.isFile()) {
      if (counters.filesScannedRef() >= MAX_FILES) { errors.push('File scan limit reached'); return; }
      const fileAbs = path.join(dirAbs, name);
      const fileRel = workspaceRoot ? path.relative(workspaceRoot, fileAbs).replace(/\\/g, '/') : fileAbs.replace(/\\/g, '/');
      if (shouldSkipByGlob(fileRel, ctx.control.fileGlob)) continue;
      await processFile(fileAbs, fileRel, workspaceRoot, ctx);
      if (counters.totalMatchesRef() >= MAX_TOTAL_MATCHES) return;
    }
  }
}

/**
 * Determine whether a file should be skipped based on a simple glob
 */
function shouldSkipByGlob(relFile: string, glob?: string | null): boolean {
  // Simple glob filter: return true (skip) when not matching
  if (!glob) return false;
  if (glob === '*') return false;
  if (/^\*\.[A-Za-z0-9_]+$/.test(glob)) { const ext = glob.slice(1); return !relFile.endsWith(ext); }
  if (/^\*\*[\\\/]\*\.[A-Za-z0-9_]+$/.test(glob)) { const ext = glob.substring(glob.lastIndexOf('.')); return !relFile.endsWith(ext); }
  return false;
}

/**
 * Run matching against a single file and produce result blocks
 */
async function processFile(abs: string, rel: string, _workspaceRoot: string | null, ctx: PatternWalkCtx): Promise<void> {
  // Single file: size/binary/timeout filter -> line matching -> block aggregation -> update counters
  const { isRegex, regex, literal, context, results, errors, visitedFiles, counters, control } = ctx;
  if (visitedFiles.has(abs)) return;
  visitedFiles.add(abs);
  if (Date.now() > control.timeoutAt) { errors.push('Search timeout reached'); return; }
  counters.incFiles();
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return;
    if (stat.size > MAX_FILE_SIZE_KB * 1024) return;
  } catch { return; }

  let content: string;
  try { content = await fs.readFile(abs, 'utf8'); }
  catch { errors.push(`Cannot read file: ${rel}`); return; }
  if (content.includes('\0')) return; // Simple binary detection

  const lines = content.split(/\r?\n/);
  const matchLineNumbers: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (Date.now() > control.timeoutAt) { errors.push('Search timeout reached'); break; }
    const raw = lines[i];
    let isMatch = false;
    if (isRegex && regex) { regex.lastIndex = 0; isMatch = regex.test(raw); }
    else if (literal) { isMatch = raw.toLowerCase().includes(literal); }
    if (isMatch) matchLineNumbers.push(i + 1);
    if (matchLineNumbers.length + counters.totalMatchesRef() >= MAX_TOTAL_MATCHES) break;
  }
  if (matchLineNumbers.length === 0) return;

  const blocks: SearchMatchBlock[] = [];
  let current: number[] = [];
  for (let idx = 0; idx < matchLineNumbers.length; idx++) {
    const lineNo = matchLineNumbers[idx];
    if (current.length === 0) current.push(lineNo);
    else {
      const prev = current[current.length - 1];
      if (lineNo <= prev + 1) current.push(lineNo);
      else {
        blocks.push(buildBlock(current, lines, context));
        if (blocks.length >= MAX_MATCHES_PER_FILE) break;
        current = [lineNo];
      }
    }
  }
  if (current.length > 0 && blocks.length < MAX_MATCHES_PER_FILE) blocks.push(buildBlock(current, lines, context));
  if (blocks.length === 0) return;

  let fileMatches = 0; blocks.forEach(b => { fileMatches += b.matchCount; });
  counters.incMatches(fileMatches);
  results.push({ file: rel.replace(/\\/g, '/'), matches: blocks });
}

/**
 * Assemble consecutive hit lines into a result block with context
 */
function buildBlock(lineNumbers: number[], allLines: string[], context: number): SearchMatchBlock {
  // Build match block: expand context -> truncate long lines -> add prefix/line number
  const start = Math.max(1, lineNumbers[0] - context);
  const end = Math.min(allLines.length, lineNumbers[lineNumbers.length - 1] + context);
  const matchSet = new Set(lineNumbers);
  const formatted: string[] = [];
  for (let ln = start; ln <= end; ln++) {
    let text = allLines[ln - 1] ?? '';
    if (text.length > LINE_TRUNCATE) text = text.slice(0, LINE_TRUNCATE) + ' [truncated...]';
    const prefix = matchSet.has(ln) ? '>' : ' ';
    const lineNoStr = ln.toString().padStart(4, ' ');
    formatted.push(`${prefix} ${lineNoStr}: ${text}`);
  }
  return { startLine: start, endLine: end, lines: formatted, matchCount: lineNumbers.length };
}

/**
 * Validate and normalize arguments; return trimmed patterns, context lines, and workspaceRoot
 */
function validateArgs(args: SearchToolArgs): { isValid: boolean; error?: string; normalizedPatterns?: string[]; removedEntries?: number } {
  // Defensive check: ensure the argument object exists
  if (!args || typeof args !== 'object') {
    return { isValid: false, error: 'Arguments object required' };
  }

  // patterns is a required string array
  if (!Array.isArray(args.patterns)) {
    return { isValid: false, error: 'patterns is required and must be an array' };
  }

  // workspaceRoot is a required non-empty string
  if (typeof args.workspaceRoot !== 'string' || !args.workspaceRoot.trim()) {
    return { isValid: false, error: 'workspaceRoot is required and must be a non-empty string' };
  }

  const normalizedPatterns = Array.from(new Set(
    args.patterns
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(item => item.length > 0)
  ));

  if (normalizedPatterns.length === 0) {
    return { isValid: false, error: 'patterns must contain at least one non-empty string' };
  }

  // context, when present, must be a non-negative integer
  if (args.context !== undefined && (!Number.isInteger(args.context) || args.context < 0)) {
    return { isValid: false, error: 'context must be an integer >= 0 when provided' };
  }

  const removedEntries = args.patterns.length - normalizedPatterns.length;

  return {
    isValid: true,
    normalizedPatterns,
    removedEntries: removedEntries > 0 ? removedEntries : undefined,
  };
}


function emptySearchResult(
  args: SearchToolArgs,
  notes: readonly string[],
): SearchToolResult {
  return {
    success: true,
    patterns: args.patterns.filter((p) => typeof p === 'string' && p.trim().length > 0),
    paths: null,
    fileGlob: undefined,
    patternResults: [],
    errors: notes.length > 0 ? [...notes] : undefined,
    timestamp: new Date().toISOString(),
  };
}

export const search: LocalTool = {
  spec: {
    name: 'search',
    description: DESCRIPTION,
    parameters: PARAMETERS,
  },
  async handler(args, ctx): Promise<ToolResult> {
    const rawArgs = args as SearchToolArgs;
    const originalRoot = typeof rawArgs.workspaceRoot === 'string' ? rawArgs.workspaceRoot : '';
    const resolved = await resolveWorkspaceRootArg(originalRoot, ctx, 'search');
    if (resolved.isUri && !resolved.exists) {
      return {
        ok: true,
        content: JSON.stringify(
          emptySearchResult(rawArgs, ['workspaceRoot sandbox not yet materialized']),
        ),
      };
    }

    const internalArgs: SearchToolArgs = resolved.isUri
      ? { ...rawArgs, workspaceRoot: resolved.abs }
      : rawArgs;
    const result = await searchInternal(internalArgs, { signal: ctx.signal });
    // LLM 视角下 workspaceRoot 始终保持 URI 形态(internal 用 abs 跑出结果后还原)。
    // 注:SearchToolResult 没有 workspaceRoot 字段(`paths` 是相对路径列表),
    // 故无需后处理 —— `find` 那边有 workspaceRoot 字段所以才还原。
    return { ok: true, content: JSON.stringify(result) };
  },
};
