/**
 * Workspace explorer 共享常量与小工具。
 * 从 FileExplorerSection 抽出，供 hook / 子组件复用。
 */

/** 文件树扫描时忽略的目录名 */
export const IGNORE_PATTERNS = [
  'node_modules', '.git', 'dist', 'build', '.next',
  'out', 'coverage', '.vscode', '.idea',
];

/** 文件监听时额外忽略的条目（含 IGNORE_PATTERNS 之外的系统文件） */
export const WATCH_EXCLUDES = [
  ...IGNORE_PATTERNS, '.DS_Store', 'Thumbs.db',
];

/** 视为图片的扩展名查表 */
const IMAGE_EXTENSIONS: Record<string, true> = {
  png: true, jpg: true, jpeg: true, gif: true, svg: true,
  bmp: true, webp: true, ico: true, tiff: true, tif: true,
};

/** 根据文件名判断是否为图片 */
export const isImageFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return ext in IMAGE_EXTENSIONS;
};
