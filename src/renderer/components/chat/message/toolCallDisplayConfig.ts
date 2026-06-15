// src/renderer/components/chat/toolCallDisplayConfig.ts
// Tool Call display configuration file, mapping tool names to descriptive text and icons

import { LucideIcon, Globe, FileText, FileSearch, FolderOpen, Terminal, Brain, Code, Wrench, FilePlus, FileEdit, Database, MessageSquare, Eye, Zap, Settings, Book, Image, Mail, Calendar, Link, Download, Upload, Play } from 'lucide-react';

/**
 * Tool icon type
 */
export type ToolIconType =
  | 'globe'       // Web/search
  | 'file'        // File read
  | 'file-plus'   // File create
  | 'file-edit'   // File edit
  | 'file-search' // File search
  | 'folder'      // Folder/directory
  | 'terminal'    // Command execution
  | 'code'        // Code execution
  | 'brain'       // Memory/AI
  | 'database'    // Database
  | 'message'     // Message/conversation
  | 'image'       // Image
  | 'mail'        // Email
  | 'calendar'    // Calendar
  | 'link'        // Link
  | 'download'    // Download
  | 'upload'      // Upload
  | 'play'        // Execute/play
  | 'settings'    // Settings
  | 'book'        // Documentation
  | 'eye'         // View
  | 'zap'         // Quick action
  | 'wrench';     // Default tool

/**
 * Mapping from icon type to Lucide component
 */
export const iconTypeToComponent: Record<ToolIconType, LucideIcon> = {
  'globe': Globe,
  'file': FileText,
  'file-plus': FilePlus,
  'file-edit': FileEdit,
  'file-search': FileSearch,
  'folder': FolderOpen,
  'terminal': Terminal,
  'code': Code,
  'brain': Brain,
  'database': Database,
  'message': MessageSquare,
  'image': Image,
  'mail': Mail,
  'calendar': Calendar,
  'link': Link,
  'download': Download,
  'upload': Upload,
  'play': Play,
  'settings': Settings,
  'book': Book,
  'eye': Eye,
  'zap': Zap,
  'wrench': Wrench,
};

/**
 * Domain ToolCall.args 已是结构化对象;保留 helper 以便未来需要时收紧 union。
 */
const normalizeArgs = (toolArgs?: Record<string, unknown>): Record<string, unknown> | null => {
  return toolArgs && typeof toolArgs === 'object' ? toolArgs : null;
};

/**
 * Get the description from arguments
 */
const getDescriptionFromArgs = (args: Record<string, unknown> | null): string | null => {
  if (!args) return null;
  if (args.description && typeof args.description === 'string' && args.description.trim()) {
    return args.description.trim();
  }
  return null;
};

// ===== Fallback display text generator functions for each tool =====

const getShellDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.command && typeof args.command === 'string' && args.command.trim()) {
    return `Executed command: ${args.command.trim()}`;
  }
  return 'Executed command';
};


const getWriteDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.fileUri && typeof args.fileUri === 'string' && args.fileUri.trim()) {
    const fileUri = args.fileUri.trim();
    const fileName = fileUri.split(/[/\\]/).pop() || fileUri;
    return `Wrote file: ${fileName}`;
  }
  return 'Wrote file';
};

const getPresentDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.description && typeof args.description === 'string' && args.description.trim()) {
    return args.description.trim();
  }
  if (args?.fileUris && Array.isArray(args.fileUris) && args.fileUris.length > 0) {
    const count = args.fileUris.length;
    return count === 1 ? 'Presented 1 file' : `Presented ${count} files`;
  }
  return 'Presented deliverable';
};


/**
 * 统一 `read` 工具。args 是 `{ path: string }`,path 可能是:
 * - 本地路径 + 可选 selector(`src/foo.ts:50-200`)
 * - Internal URL(`skill://my-skill` / `agent://abc`)
 *
 * 显示策略:剥掉 selector 后取最后一段非空 segment 作为显示名;internal URL
 * 保留 scheme 让用户一眼看出资源类型。
 */
const getReadDisplayText = (args: Record<string, unknown> | null): string => {
  if (!args?.path || typeof args.path !== 'string' || !args.path.trim()) {
    return 'Read';
  }
  const raw = args.path.trim();
  // 剥掉 `:<sel>`(简化版:只看最后一段是不是数字/range/raw,不重复 main 进程的 splitter 逻辑)。
  const selectorRe = /:(?:raw|\d+(?:[-+]\d+)?|\d+-)(?::raw|:\d+(?:[-+]\d+)?|:\d+-)?$/i;
  const pathOnly = raw.replace(selectorRe, '');
  // internal URL:`skill://foo` / `agent://abc/x.md`
  const schemeMatch = pathOnly.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (schemeMatch) {
    return `Read ${pathOnly}`;
  }
  const fileName = pathOnly.split(/[/\\]/).pop() || pathOnly;
  return `Read: ${fileName}`;
};

const getFindDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.pattern && typeof args.pattern === 'string' && args.pattern.trim()) {
    return `Searched files: ${args.pattern.trim()}`;
  }
  return 'Searched files';
};

const getSearchDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.patterns && Array.isArray(args.patterns) && args.patterns.length > 0) {
    const patternsStr = args.patterns.slice(0, 2).join(', ');
    const suffix = args.patterns.length > 2 ? '...' : '';
    return `Searched text: ${patternsStr}${suffix}`;
  }
  return 'Searched text in files';
};

/**
 * Get the display text for a Tool Call
 * @param toolName - tool name
 * @param toolArgs - structured args object (Domain ToolCall.args)
 * @returns display text
 */
export const getToolCallDisplayText = (
  toolName: string,
  toolArgs?: Record<string, unknown>,
  toolResultText?: string,
): string => {
  const args = normalizeArgs(toolArgs);

  // Return description first (if available)
  const description = getDescriptionFromArgs(args);
  if (description) {
    return description;
  }

  // Return display text based on tool name
  switch (toolName) {
    // ===== Command execution tools =====
    case 'shell':
      return getShellDisplayText(args);

    // ===== File write tools =====
    case 'write':
      return getWriteDisplayText(args);

    // ===== File read tools =====
    case 'read':
      return getReadDisplayText(args);

    // ===== File search tools =====
    case 'find':
      return getFindDisplayText(args);
    case 'search':
      return getSearchDisplayText(args);

    // ===== Download tools =====
    case 'download_file':
      return 'Downloaded file';


    // ===== Present tools =====
    case 'present_deliverables':
      return getPresentDisplayText(args);

    // ===== Default =====
    default:
      return `Used ${toolName}`;
  }
};

/**
 * Get the summary display text for a Tool Calls Section
 * @param count - number of tool calls
 * @returns summary display text
 */
export const getToolCallsSummaryText = (count: number): string => {
  if (count === 1) {
    return 'Used 1 tool';
  }
  return `Used ${count} tools`;
};

/**
 * Get the icon type for a Tool Call
 * @param toolName - tool name (function.name)
 * @returns icon type
 */
export const getToolCallIconType = (toolName: string): ToolIconType => {
  switch (toolName) {
    // ===== Command execution tools =====
    case 'shell':
      return 'terminal';


    // ===== File write tools =====
    case 'write':
      return 'file-edit';

    // ===== File read tools =====
    case 'read':
      return 'file';


    // ===== File search tools =====
    case 'find':
    case 'search':
      return 'file-search';

    // ===== Download tools =====
    case 'download_file':
      return 'download';

    // ===== Present tools =====
    case 'present_deliverables':
      return 'eye';

    // ===== Default: infer from tool name pattern =====
    default:
      return inferIconTypeFromName(toolName);
  }
};

/**
 * Infer icon type from tool name pattern
 */
const inferIconTypeFromName = (toolName: string): ToolIconType => {
  const lowerName = toolName.toLowerCase();

  if (lowerName.includes('search') || lowerName.includes('web') || lowerName.includes('fetch')) {
    return 'globe';
  }
  if (lowerName.includes('create') || lowerName.includes('new')) {
    return 'file-plus';
  }
  if (lowerName.includes('write') || lowerName.includes('edit') || lowerName.includes('update') || lowerName.includes('modify')) {
    return 'file-edit';
  }
  if (lowerName.includes('read') || lowerName.includes('get') || lowerName.includes('view')) {
    return 'file';
  }
  if (lowerName.includes('find') || lowerName.includes('grep') || lowerName.includes('glob')) {
    return 'file-search';
  }
  if (lowerName.includes('list') || lowerName.includes('dir') || lowerName.includes('folder')) {
    return 'folder';
  }
  if (lowerName.includes('command') || lowerName.includes('exec') || lowerName.includes('run') || lowerName.includes('shell') || lowerName.includes('bash') || lowerName.includes('terminal')) {
    return 'terminal';
  }
  if (lowerName.includes('code') || lowerName.includes('python') || lowerName.includes('script')) {
    return 'code';
  }
  if (lowerName.includes('memory') || lowerName.includes('remember')) {
    return 'brain';
  }
  if (lowerName.includes('database') || lowerName.includes('sql') || lowerName.includes('query')) {
    return 'database';
  }
  if (lowerName.includes('image') || lowerName.includes('photo') || lowerName.includes('picture')) {
    return 'image';
  }
  if (lowerName.includes('message') || lowerName.includes('chat') || lowerName.includes('send')) {
    return 'message';
  }
  if (lowerName.includes('download')) {
    return 'download';
  }
  if (lowerName.includes('upload')) {
    return 'upload';
  }

  return 'wrench';
};

/**
 * Get the icon component for a Tool Call
 * @param toolName - tool name (function.name)
 * @returns Lucide icon component
 */
export const getToolCallIcon = (toolName: string): LucideIcon => {
  const iconType = getToolCallIconType(toolName);
  return iconTypeToComponent[iconType];
};
