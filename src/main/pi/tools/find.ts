/**
 * `find`:按文件名/路径搜索(非内容)。
 *
 * 命名史:LLM-visible name 从 `search_files` 简化到 `find`(Phase 8a),
 * 文件名 / 内部 type / 变量名同步对齐到 `find` / `FindTool*` / `findInternal`
 * (Phase 8b)—— 与 unix `find` 对齐。
 *
 * Key features:
 *  - 使用 ripgrep 做高性能文件/目录搜索(委派 WorkspaceWatcher.searchFiles)。
 *  - pattern 支持:简单子串(大小写不敏感)、glob (`*.ts`, `**\/*.tsx`)。
 *  - 支持 fuzzy 匹配(字符按序匹配,默认开)与精确匹配。
 *  - 搜索目标可选 files / folders / both。
 *  - 结果按 fuzzy score 排序。
 *  - `workspaceRoot`(required)定义搜索根;**不自动复用 agentId workspace**。
 *  - 资源限制:`maxResults` 默认 50,上限 200;timeout 10s。
 */
import * as fs from 'fs';
import * as path from 'path';

import { resolveWorkspaceRootArg } from './util/workspaceRoot';
import type { IFileSearchQuery } from '@main/lib/workspace/SearchService';
import { getWorkspaceWatcher } from '@main/lib/workspace/WorkspaceWatcher';

import { jsonSchema } from './schema';
import type { LocalTool, ToolResult } from './types';


// Limit constants
const DEFAULT_MAX_RESULTS = 50;     // Default maximum number of results
const MAX_RESULTS_LIMIT = 200;      // Upper limit for maximum results
const SEARCH_TIMEOUT_MS = 10000;    // Search timeout (10 seconds)

export interface FindToolArgs {
  pattern: string;              // Required: search pattern (filename/path fragment, supports glob: *.ts, **/*.tsx)
  workspaceRoot: string;        // Required: workspace root directory (absolute path), search scope is controlled by this parameter
  description?: string;         // Optional: Operation description for UI display
  searchTarget?: 'files' | 'folders' | 'both';  // Optional: search target (default 'both')
  maxResults?: number;          // Optional: maximum number of results (default 50, max 200)
  fuzzy?: boolean;              // Optional: enable fuzzy matching (default true)
  includePattern?: string;      // Optional: include pattern (comma-separated)
  excludePattern?: string;      // Optional: exclude pattern (comma-separated)
}

export interface FindFileResult {
  path: string;                 // Path relative to workspaceRoot
  score?: number;               // Match score (used for sorting)
  isDirectory?: boolean;        // Whether it is a directory
}

export interface FindToolResult {
  success: boolean;             // Whether successful
  pattern: string;              // Search pattern
  workspaceRoot: string;        // Workspace root directory
  searchTarget: 'files' | 'folders' | 'both';  // Search target
  results: FindFileResult[];  // Search results
  limitHit: boolean;            // Whether the result count limit was reached
  stats?: {
    duration: number;           // Search duration (milliseconds)
    filesScanned: number;       // Number of files scanned
    cacheHit: boolean;          // Whether the cache was hit
  };
  errors?: string[];            // Non-fatal warnings/informational messages
  timestamp: string;            // Execution completion time (ISO string)
}

const DESCRIPTION =
  'Search for files and directories by filename or path (NOT file content). Uses ripgrep for high-performance search. Pattern supports: simple text (case-insensitive), glob patterns (*.ts, **/*.tsx). Fuzzy matching enabled by default (matches chars in order). Returns relative paths sorted by relevance. workspaceRoot is REQUIRED and defines search scope. Accepts either an absolute filesystem path or an internal URI (local://, knowledge://) for sandbox/KB scope — does NOT auto-use agentId workspace. When the URI sandbox has not yet been materialized (no files written), returns empty results without error. Supports filtering by file/folder type. Limits: maxResults=50 (max 200), timeout=10s.';

const PARAMETERS = jsonSchema({
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: 'A brief description of what is being searched (for UI display). E.g., "Finding config files", "Searching for components"',
    },
    pattern: {
      type: 'string',
      description: 'Search pattern (filename or path fragment). Supports: simple text (case-insensitive), glob patterns (*.ts, **/*.tsx). Examples: "readme" (fuzzy match), "src/app" (path match), "*.ts" (glob pattern for TypeScript files)',
    },
    workspaceRoot: {
      type: 'string',
      description: 'REQUIRED: Workspace root. Accepts (a) an absolute filesystem path or (b) an internal URI: `local://` (current session sandbox root), `local://<sub/dir>` (sub-path within sandbox), `knowledge://` (current agent KB root), `knowledge://<sub/dir>`. Defines search scope — all results are relative to this path. Does NOT auto-use agentId workspace, must be explicitly provided.',
    },
    searchTarget: {
      type: 'string',
      enum: ['files', 'folders', 'both'],
      description: 'Search target: "files" (files only), "folders" (directories only), "both" (default). Use "folders" to find directories.',
    },
    maxResults: {
      type: 'number',
      minimum: 1,
      maximum: 200,
      description: 'Maximum number of results (default 50, max 200).',
    },
    fuzzy: {
      type: 'boolean',
      description: 'Enable fuzzy matching (default true). When true, matches files/folders with characters in order.',
    },
    includePattern: {
      type: 'string',
      description: 'Optional include pattern (comma-separated). Example: "*.ts,*.tsx" to include only TypeScript files.',
    },
    excludePattern: {
      type: 'string',
      description: 'Optional exclude pattern (comma-separated). Example: "test,spec" to exclude test files. Default excludes: node_modules, .git, dist, build.',
    },
  },
  required: ['description', 'pattern', 'workspaceRoot'],
});

/** 工具本体逻辑;签名供测试 / dev 调用。 */
export async function findInternal(
  args: FindToolArgs,
  opts?: { signal?: AbortSignal },
): Promise<FindToolResult> {

  // 1. Validate arguments
  const validation = validateArgs(args);
  if (!validation.isValid) {
    throw new Error(validation.error || 'Invalid arguments provided');
  }

  const errors: string[] = [];
  const start = Date.now();

  // 2. Normalize arguments
  const pattern = args.pattern.trim();
  const workspaceRoot = args.workspaceRoot.trim();
  const searchTarget = args.searchTarget || 'both';
  const fuzzy = args.fuzzy !== false; // enable fuzzy matching by default
  let maxResults = args.maxResults || DEFAULT_MAX_RESULTS;

  // Cap max results
  if (maxResults > MAX_RESULTS_LIMIT) {
    errors.push(`maxResults capped to ${MAX_RESULTS_LIMIT}`);
    maxResults = MAX_RESULTS_LIMIT;
  }

  try {
    // 3. Build the search query
    const aborter = new AbortController();
    const abortFromCaller = () => aborter.abort();
    if (opts?.signal?.aborted) {
      aborter.abort();
    } else {
      opts?.signal?.addEventListener('abort', abortFromCaller, { once: true });
    }

    const query: IFileSearchQuery = {
      folder: workspaceRoot,
      pattern,
      maxResults,
      fuzzy,
      searchTarget,
      includePattern: args.includePattern,
      excludePattern: args.excludePattern,
      signal: aborter.signal,
    };

    // A timeout only protects the app when the search engine receives the same
    // cancellation signal and terminates its child process.
    const watcher = getWorkspaceWatcher();
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        aborter.abort();
        reject(new Error('Search timeout'));
      }, SEARCH_TIMEOUT_MS);
    });

    const searchResult = await Promise.race([
      watcher.searchFiles(query),
      timeoutPromise,
    ]).finally(() => {
      clearTimeout(timeoutId);
      opts?.signal?.removeEventListener('abort', abortFromCaller);
    });

    // 5. Process search results
    const results: FindFileResult[] = searchResult.results.map(result => ({
      path: result.path,
      score: result.score,
      isDirectory: result.isDirectory,
    }));

    const duration = Date.now() - start;

    const output: FindToolResult = {
      success: true,
      pattern,
      workspaceRoot,
      searchTarget,
      results,
      limitHit: searchResult.limitHit || false,
      stats: searchResult.stats ? {
        duration: searchResult.stats.duration,
        filesScanned: searchResult.stats.filesScanned,
        cacheHit: searchResult.stats.cacheHit,
      } : {
        duration,
        filesScanned: results.length,
        cacheHit: false,
      },
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    };

    return output;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`find execution failed: ${errorMessage}`);
  }
}

/**
 * Argument validation and normalization
 */
function validateArgs(args: FindToolArgs): { isValid: boolean; error?: string } {
  // Defensive check: ensure the argument object exists
  if (!args || typeof args !== 'object') {
    return { isValid: false, error: 'Arguments object required' };
  }

  // pattern must be a non-empty string
  if (typeof args.pattern !== 'string' || !args.pattern.trim()) {
    return { isValid: false, error: 'pattern is required and must be a non-empty string' };
  }

  // workspaceRoot must be a non-empty string
  if (typeof args.workspaceRoot !== 'string' || !args.workspaceRoot.trim()) {
    return { isValid: false, error: 'workspaceRoot is required and must be a non-empty string' };
  }

  // Validate that workspaceRoot is an absolute path
  if (!path.isAbsolute(args.workspaceRoot)) {
    return { isValid: false, error: 'workspaceRoot must be an absolute path' };
  }

  const normalizedRoot = path.resolve(args.workspaceRoot);
  if (normalizedRoot === path.parse(normalizedRoot).root) {
    return { isValid: false, error: 'workspaceRoot must not be a filesystem root' };
  }

  // Validate that workspaceRoot exists
  if (!fs.existsSync(args.workspaceRoot)) {
    return { isValid: false, error: 'workspaceRoot does not exist' };
  }

  // Validate searchTarget enum value
  if (args.searchTarget && !['files', 'folders', 'both'].includes(args.searchTarget)) {
    return { isValid: false, error: 'searchTarget must be "files", "folders", or "both"' };
  }

  // Validate maxResults range
  if (args.maxResults !== undefined) {
    if (!Number.isInteger(args.maxResults) || args.maxResults < 1) {
      return { isValid: false, error: 'maxResults must be a positive integer' };
    }
  }

  return { isValid: true };
}



function emptyResult(
  args: FindToolArgs,
  notes: readonly string[],
): FindToolResult {
  return {
    success: true,
    pattern: args.pattern.trim(),
    workspaceRoot: args.workspaceRoot,
    searchTarget: args.searchTarget || 'both',
    results: [],
    limitHit: false,
    stats: { duration: 0, filesScanned: 0, cacheHit: false },
    errors: notes.length > 0 ? [...notes] : undefined,
    timestamp: new Date().toISOString(),
  };
}

export const find: LocalTool = {
  spec: {
    name: 'find',
    description: DESCRIPTION,
    parameters: PARAMETERS,
  },
  async handler(args, ctx): Promise<ToolResult> {
    const rawArgs = args as FindToolArgs;
    const originalRoot = typeof rawArgs.workspaceRoot === 'string' ? rawArgs.workspaceRoot : '';
    const resolved = await resolveWorkspaceRootArg(originalRoot, ctx, 'find');
    if (resolved.isUri && !resolved.exists) {
      // URI 指向尚未物化的 sandbox(session 还没写过任何文件)→ 空结果。
      return {
        ok: true,
        content: JSON.stringify(emptyResult(rawArgs, ['workspaceRoot sandbox not yet materialized'])),
      };
    }

    const internalArgs: FindToolArgs = resolved.isUri
      ? { ...rawArgs, workspaceRoot: resolved.abs }
      : rawArgs;
    const result = await findInternal(internalArgs, { signal: ctx.signal });
    // 把 LLM 可见的 URI 还原到 output(internal 用 abs 跑,但 LLM 视角应见 URI)。
    if (resolved.isUri) {
      result.workspaceRoot = originalRoot;
    }
    return { ok: true, content: JSON.stringify(result) };
  },
};
