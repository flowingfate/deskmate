import { connectRenderToMain } from './base';
import type {
  DeletePathsResult,
  ListDirResult,
  FileAccessResult,
  ReadFileResult,
  WriteFileOptions,
  WriteFileResult,
  StatResult,
  SelectFileOptions,
  SelectFileResult,
  SelectFilesOptions,
  SelectFilesResult,
  GetFileMetadataResult,
  DownloadFileResult,
} from '../types/fsTypes';

export type {
  ImportConflictResolution,
  DeletePathResult,
  DeletePathsResult,
  DirEntry,
  ListDirResult,
  FileAccessResult,
  ReadFileResult,
  WriteFileOptions,
  WriteFileResult,
  FileStatInfo,
  StatResult,
  DialogFileFilter,
  SelectFileOptions,
  SelectFileResult,
  SelectFilesOptions,
  SelectFilesResult,
  FileMetadata,
  GetFileMetadataResult,
  DownloadFileResult,
} from '../types/fsTypes';

type RenderToMain = {
  deletePaths: { call: [paths: string[]]; return: DeletePathsResult };
  exists: { call: [filePath: string]; return: boolean };
  listDir: { call: [dirPath: string]; return: ListDirResult };
  access: { call: [filePath: string]; return: FileAccessResult };
  readFile: { call: [filePath: string, encoding?: BufferEncoding | 'base64']; return: ReadFileResult };
  writeFile: { call: [filePath: string, content: string, encoding?: BufferEncoding, options?: WriteFileOptions]; return: WriteFileResult };
  stat: { call: [filePath: string]; return: StatResult };
  expandPath: { call: [filePath: string]; return: string };
  selectFile: { call: [options?: SelectFileOptions]; return: SelectFileResult };
  getFileMetadata: { call: [filePath: string]; return: GetFileMetadataResult };
  downloadFile: { call: [url: string, destPath: string]; return: DownloadFileResult };
  selectFiles: { call: [options?: SelectFilesOptions]; return: SelectFilesResult };
};

export const renderToMain = connectRenderToMain<RenderToMain>('fs');
