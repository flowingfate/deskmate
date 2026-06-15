export type WriteMode = 'overwrite' | 'append' | 'prepend' | 'insert';

export interface WriteToolArgs {
  fileUri: string; // LLM-visible URI string: local:// | knowledge:// | external abs path
  content: string;
  mode?: WriteMode;
  description?: string;
  encoding?: string;           // Use string instead of BufferEncoding, since renderer (target: web) cannot use Node types
  createIfNotExists?: boolean;
  createDirectories?: boolean;
  isBase64?: boolean;
  backupBeforeWrite?: boolean;
  validateJson?: boolean;
  insertPosition?: number;
  insertLine?: number;
  addNewlineBefore?: boolean;
  addNewlineAfter?: boolean;
  sectionId?: string;
  isLastChunk?: boolean;
}

export interface WriteToolResult {
  success: boolean;
  fileUri: string;
  bytesWritten: number;
  totalSize: number;
  mode: WriteMode;
  backupPath?: string;
  jsonValid?: boolean;
  chunkNumber?: number;
  sectionId?: string;
  isComplete?: boolean;
  error?: string;
}
