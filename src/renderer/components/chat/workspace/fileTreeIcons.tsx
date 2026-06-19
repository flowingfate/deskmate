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

/** 扩展名 → 图标组件 的静态查表 */
const ICON_BY_EXT: Record<string, React.ReactNode> = {
  ts: <FileCode size={16} />,
  tsx: <FileCode size={16} />,
  js: <FileCode size={16} />,
  jsx: <FileCode size={16} />,
  json: <FileJson size={16} />,
  md: <FileType size={16} />,
  css: <Palette size={16} />,
  scss: <Palette size={16} />,
  html: <Globe size={16} />,
  png: <ImageIcon size={16} />,
  jpg: <ImageIcon size={16} />,
  jpeg: <ImageIcon size={16} />,
  gif: <ImageIcon size={16} />,
  svg: <ImageIcon size={16} />,
  webp: <ImageIcon size={16} />,
};

/**
 * 依据节点类型 / 文件扩展名返回对应图标。
 * 目录区分展开态，文件按扩展名查表，未命中回退到通用文本图标。
 * 统一沉稳中性灰，颜色由消费方 span 控制；目录略深以体现层级主次。
 */
export const getFileTreeIcon = (node: FileTreeNode, isExpanded: boolean): React.ReactNode => {
  if (node.type === 'directory') {
    return isExpanded
      ? <FolderOpen size={16} className="text-content-secondary" />
      : <Folder size={16} className="text-content-secondary" />;
  }
  const ext = node.name.split('.').pop()?.toLowerCase() || '';
  return ICON_BY_EXT[ext] ?? <FileText size={16} />;
};
