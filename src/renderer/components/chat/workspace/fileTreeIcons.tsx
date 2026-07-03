import React from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileJson,
  FileType,
  Palette,
  Globe,
  Image as ImageIcon,
} from 'lucide-react';
import { FileTreeNode } from '../../../lib/chat/workspaceOps';

/** 扩展名 → 图标组件 的静态查表。 */
const ICON_BY_EXT: Record<string, React.ReactNode> = {
  ts: <FileCode size={15} strokeWidth={1.75} />,
  tsx: <FileCode size={15} strokeWidth={1.75} />,
  js: <FileCode size={15} strokeWidth={1.75} />,
  jsx: <FileCode size={15} strokeWidth={1.75} />,
  json: <FileJson size={15} strokeWidth={1.75} />,
  md: <FileType size={15} strokeWidth={1.75} />,
  css: <Palette size={15} strokeWidth={1.75} />,
  scss: <Palette size={15} strokeWidth={1.75} />,
  html: <Globe size={15} strokeWidth={1.75} />,
  png: <ImageIcon size={15} strokeWidth={1.75} />,
  jpg: <ImageIcon size={15} strokeWidth={1.75} />,
  jpeg: <ImageIcon size={15} strokeWidth={1.75} />,
  gif: <ImageIcon size={15} strokeWidth={1.75} />,
  svg: <ImageIcon size={15} strokeWidth={1.75} />,
  webp: <ImageIcon size={15} strokeWidth={1.75} />,
};

const getExt = (name: string): string => name.split('.').pop()?.toLowerCase() || '';

/**
 * 文件树节点图标（纯图标，零渲染开销 —— 不加载文件字节，不显缩略图）。
 * - 目录：区分展开态的文件夹图标，中性次级灰。
 * - 文件：按扩展名查表，未命中回退通用文本图标，沉稳三级灰。
 *
 * 同类文件共用同一图标是刻意为之（对齐 Finder 列表视图）；差异化交给文件名与缩进层级。
 */
export const FileTreeIcon: React.FC<{ node: FileTreeNode; isExpanded: boolean }> = ({ node, isExpanded }) => {
  if (node.type === 'directory') {
    return isExpanded
      ? <FolderOpen size={15} strokeWidth={1.75} className="text-content-secondary" />
      : <Folder size={15} strokeWidth={1.75} className="text-content-secondary" />;
  }
  return <span className="text-content-tertiary">{ICON_BY_EXT[getExt(node.name)] ?? <FileText size={15} strokeWidth={1.75} />}</span>;
};
