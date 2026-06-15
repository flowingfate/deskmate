import { workspaceApi } from '@/ipc/workspace';
/**
 * Workspace Search Service - Renderer side
 * Calls the main process file search functionality via IPC
 */

export type SearchTarget = 'files' | 'folders' | 'both';

export interface FileSearchQuery {
  folder?: string;
  pattern?: string;
  maxResults?: number;
  fuzzy?: boolean;
  searchTarget?: SearchTarget;  // Search target: files (files only) | folders (folders only) | both (files+folders, default)
}

export interface FileSearchResult {
  path: string;
  score?: number;
  isDirectory?: boolean;  // Whether it is a directory
}

export interface SearchComplete {
  results: FileSearchResult[];
  limitHit: boolean;
  stats?: {
    duration: number;
    filesScanned: number;
    cacheHit: boolean;
  };
}

/**
 * Search workspace files
 * @param query Search query
 * @returns Search results
 */
export async function searchWorkspaceFiles(
  query: FileSearchQuery
): Promise<SearchComplete> {
  try {
    const result = await workspaceApi.searchFiles(query);

    if (!result || !result.success) {
      throw new Error(result?.error || 'File search failed');
    }

    const data = result.data ?? { results: [], limitHit: false };
    return { ...data, limitHit: data.limitHit ?? false };
  } catch (error) {
    // Return empty results instead of throwing, to avoid interrupting the UI
    return { results: [], limitHit: false };
  }
}

/**
 * Search files by pattern
 * @param pattern Search pattern (filename or path fragment)
 * @param options Search options
 * @returns Search results
 */
export async function searchFilesByPattern(
  pattern: string,
  options?: {
    folder?: string;
    maxResults?: number;
    fuzzy?: boolean;
    searchTarget?: SearchTarget;
  }
): Promise<FileSearchResult[]> {
  const result = await searchWorkspaceFiles({
    pattern,
    folder: options?.folder,
    maxResults: options?.maxResults || 50,
    fuzzy: options?.fuzzy !== false, // Enable fuzzy search by default
    searchTarget: options?.searchTarget || 'both' // Search files+folders by default
  });

  return result.results;
}
