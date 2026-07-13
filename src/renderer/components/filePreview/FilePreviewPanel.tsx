/**
 * FilePreviewPanel — 通用文件预览面板（纯受控，无自有可见状态）。
 *
 * 由外层容器决定形态与定位:
 *  - 聊天页 `ChatFilePreviewOverlay` 满铺 chat-content 区(inline);
 *  - 全局 `GlobalFilePreviewOverlay` 居中弹窗(agent 编辑器 / 工作区侧栏等非聊天场景)。
 *
 * 能力:Markdown(渲染/源码)、code / JSON / text(Monaco 只读)、HTML(iframe/源码)、
 * PDF(iframe)、office / other(兜底"用默认应用打开")、就地编辑保存(Monaco)、
 * 磁盘 mtime 轮询自动刷新、原生全屏、Install Skill。
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { requestConfirmation } from '@/components/ui/ConfirmationDialog';
import {
  X,
  FileText,
  FileSpreadsheet,
  FileIcon,
  File,
  FileType,
  Globe,
  Code,
  Eye,
  BookOpen,
  Braces,
  AlertTriangle,
  Download,
  ExternalLink,
  Pencil,
  Save,
  LogOut,
  Monitor,
  Minimize,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isInstallableSkillArtifact } from '../../lib/skills/installableSkillArtifacts';
import { fsApi } from '@/ipc/fs';
import { workspaceApi } from '@/ipc/workspace';
import rehypeRaw from 'rehype-raw';
import type * as monaco from 'monaco-editor';
import { FrontMatter, parseFrontMatter } from '../../lib/utils/yamlFrontMatter';
import { useToast } from '../ui/ToastProvider';
import { Button } from '@/shadcn/button';
import { Badge } from '@/shadcn/badge';
import { log } from '@/log';
const logger = log.child({ mod: 'FilePreviewPanel' });
// 共享 Tailwind class 常量（原 SCSS .inline-preview-loading / -spinner）。
const LOADING_BOX = 'flex flex-col items-center justify-center gap-3 h-full text-[#9ca3af] text-[13px]';
const SPINNER = 'w-6 h-6 border-[2.5px] border-black/8 border-t-[#404040] rounded-full animate-spin';

// ============================================================
// Types
// ============================================================

export interface FilePreviewDescriptor {
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
  lastModified?: string;
}

export interface FilePreviewPanelProps {
  file: FilePreviewDescriptor | null;
  isOpen: boolean;
  onClose: () => void;
  onDirtyStateChange?: (isDirty: boolean) => void;
  onInstallSkill?: (filePath: string) => void;
  style?: React.CSSProperties;
}

// ============================================================
// Helpers
// ============================================================

type FileCategory = 'code' | 'text' | 'json' | 'markdown' | 'html' | 'pdf' | 'office' | 'other';
type RenderViewMode = 'render' | 'source';

const HTML_EXTENSIONS = new Set(['html', 'htm']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
const JSON_EXTENSIONS = new Set(['json']);
const CODE_EXTENSIONS = new Set([
  'js','jsx','mjs','cjs','ts','tsx','css','scss','less','sass',
  'py','rb','java','kt','kts','scala','groovy',
  'c','h','cpp','cc','cxx','hpp','hxx','cs','go','rs','swift','m',
  'sh','bash','zsh','ps1','bat','cmd','sql','graphql','gql',
  'xml','svg','yaml','yml','toml','ini',
  'dockerfile','makefile','php','pl','pm','lua','r','dart','ex','exs','hs',
]);
const TEXT_EXTENSIONS = new Set(['txt','csv','tsv','cfg','conf','env','log','gitignore']);
const PDF_EXTENSIONS = new Set(['pdf']);
const OFFICE_EXTENSIONS = new Set(['doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp']);

const MONACO_EXTENSION_LANG: Record<string, string> = {
  html:'html', htm:'html', md:'markdown', markdown:'markdown', json:'json',
  txt:'plaintext', csv:'plaintext', tsv:'plaintext', cfg:'plaintext',
  conf:'plaintext', env:'plaintext', log:'plaintext', gitignore:'plaintext',
};

const CODE_EXTENSION_LANG: Record<string, string> = {
  js:'javascript',jsx:'jsx',mjs:'javascript',cjs:'javascript',ts:'typescript',tsx:'tsx',
  css:'css',scss:'scss',less:'less',sass:'sass',py:'python',rb:'ruby',
  java:'java',kt:'kotlin',kts:'kotlin',scala:'scala',groovy:'groovy',
  c:'c',h:'c',cpp:'cpp',cc:'cpp',cxx:'cpp',hpp:'cpp',hxx:'cpp',cs:'csharp',
  go:'go',rs:'rust',swift:'swift',m:'objectivec',
  sh:'bash',bash:'bash',zsh:'bash',ps1:'powershell',bat:'batch',cmd:'batch',
  sql:'sql',graphql:'graphql',gql:'graphql',
  xml:'xml',svg:'xml',yaml:'yaml',yml:'yaml',toml:'toml',ini:'ini',
  dockerfile:'docker',makefile:'makefile',
  php:'php',pl:'perl',pm:'perl',lua:'lua',r:'r',dart:'dart',ex:'elixir',exs:'elixir',hs:'haskell',
};

const PRISM_TO_MONACO: Record<string, string> = {
  javascript:'javascript',jsx:'javascript',typescript:'typescript',tsx:'typescript',
  css:'css',scss:'scss',less:'less',sass:'scss',python:'python',ruby:'ruby',
  java:'java',kotlin:'kotlin',scala:'scala',groovy:'plaintext',
  c:'c',cpp:'cpp',csharp:'csharp',go:'go',rust:'rust',swift:'swift',objectivec:'objective-c',
  bash:'shell',powershell:'powershell',batch:'bat',sql:'sql',graphql:'graphql',
  xml:'xml',yaml:'yaml',toml:'plaintext',ini:'ini',docker:'dockerfile',makefile:'plaintext',
  php:'php',perl:'perl',lua:'lua',r:'r',dart:'dart',elixir:'plaintext',haskell:'plaintext',
};

function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

function classifyFile(file: FilePreviewDescriptor): FileCategory {
  const ext = getExtension(file.name);
  if (file.mimeType) {
    if (file.mimeType === 'application/pdf') return 'pdf';
    if (file.mimeType === 'text/html') return 'html';
    if (file.mimeType === 'text/markdown') return 'markdown';
    if (file.mimeType === 'application/json') return 'json';
    if (file.mimeType.startsWith('text/')) return 'text';
    if (file.mimeType.includes('msword') || file.mimeType.includes('spreadsheet') ||
        file.mimeType.includes('presentation') || file.mimeType.includes('officedocument')) return 'office';
  }
  if (HTML_EXTENSIONS.has(ext)) return 'html';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (JSON_EXTENSIONS.has(ext)) return 'json';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (PDF_EXTENSIONS.has(ext)) return 'pdf';
  if (OFFICE_EXTENSIONS.has(ext)) return 'office';
  return 'other';
}

function isLocalFile(url: string): boolean {
  if (url.startsWith('file://')) return true;
  if (url.startsWith('/')) return true;
  if (/^[a-zA-Z]:[/\\]/.test(url)) return true;
  return false;
}

function getLocalPath(url: string): string {
  if (url.startsWith('file://')) return decodeURIComponent(url.replace('file://', ''));
  return url;
}

function getMonacoLanguage(ext: string): string {
  if (MONACO_EXTENSION_LANG[ext]) return MONACO_EXTENSION_LANG[ext];
  const prismLang = CODE_EXTENSION_LANG[ext];
  if (!prismLang) return 'plaintext';
  return PRISM_TO_MONACO[prismLang] || 'plaintext';
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(category: FileCategory) {
  switch (category) {
    case 'code': return <Code size={14} />;
    case 'text': return <FileText size={14} />;
    case 'json': return <Braces size={14} />;
    case 'markdown': return <BookOpen size={14} />;
    case 'html': return <Globe size={14} />;
    case 'pdf': return <FileType size={14} />;
    case 'office': return <FileSpreadsheet size={14} />;
    default: return <File size={14} />;
  }
}

// ============================================================
// Read-only Monaco viewer (lazy-loaded)
// ============================================================

const ReadonlyMonacoViewer: React.FC<{ content: string; language: string }> = ({ content, language }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    import(/* webpackChunkName: "monaco-editor" */ 'monaco-editor').then((mod) => {
      if (destroyed || !containerRef.current) return;
      const editor = mod.editor.create(containerRef.current, {
        value: content, language, theme: 'vs-dark',
        automaticLayout: true, readOnly: true, domReadOnly: true,
        minimap: { enabled: false }, fontSize: 15,
        fontFamily: "'Menlo','Monaco','Courier New',monospace",
        lineHeight: 23, padding: { top: 12, bottom: 12 },
        scrollBeyondLastLine: false, wordWrap: 'off', tabSize: 2,
        renderWhitespace: 'none', overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true, overviewRulerBorder: false,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        folding: true, lineNumbers: 'on', contextmenu: false,
      });
      editorRef.current = editor;
      setIsReady(true);
    });
    return () => { destroyed = true; editorRef.current?.dispose(); editorRef.current = null; };
  }, [content, language]);

  return (
    <div className="h-full relative">
      {!isReady && <div className={LOADING_BOX}><div className={SPINNER} /><span>Loading…</span></div>}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
};

// ============================================================
// Front-matter table (for Markdown YAML header)
// ============================================================

const FrontMatterTable: React.FC<{ frontMatter: FrontMatter }> = ({ frontMatter }) => {
  const entries = Object.entries(frontMatter);
  if (entries.length === 0) return null;
  return (
    <div className="inline-preview-frontmatter">
      <table>
        <tbody>
          {entries.map(([k, v]) => <tr key={k}><td className="fm-key">{k}</td><td className="fm-val">{String(v)}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
};

// ============================================================
// Component
// ============================================================

export const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({
  file,
  isOpen,
  onClose,
  onDirtyStateChange,
  onInstallSkill,
  style,
}) => {
  const { showSuccess, showError } = useToast();
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<RenderViewMode>('render');
  const [isContentReady, setIsContentReady] = useState(false);
  const [fileSize, setFileSize] = useState<number | undefined>(undefined);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const loadedFileKeyRef = useRef<string | null>(null);
  const monacoEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const savedContentRef = useRef<string>('');

  const fileKey = file ? `${file.name}|${file.url}` : null;
  const category: FileCategory = file ? classifyFile(file) : 'other';
  const isEditable = useMemo(() => {
    if (!file) return false;
    if (!isLocalFile(file.url)) return false;
    return category === 'text' || category === 'code' || category === 'json' || category === 'markdown' || category === 'html';
  }, [file, category]);

  const htmlBlobUrl = useMemo(() => {
    if (category !== 'html' || !textContent) return null;
    return URL.createObjectURL(new Blob([textContent], { type: 'text/html;charset=utf-8' }));
  }, [category, textContent]);

  useEffect(() => { return () => { if (htmlBlobUrl) URL.revokeObjectURL(htmlBlobUrl); }; }, [htmlBlobUrl]);

  useEffect(() => {
    onDirtyStateChange?.(isDirty);
  }, [isDirty, onDirtyStateChange]);

  // Load file content
  useEffect(() => {
    if (!isOpen || !file) {
      setTextContent(null); setLoadError(null); setIsContentReady(false);
      setIsEditing(false); setIsDirty(false); setSaveError(null);
      loadedFileKeyRef.current = null;
      if (monacoEditorRef.current) {
        monacoEditorRef.current.dispose();
        monacoEditorRef.current = null;
      }
      return;
    }

    let cancelled = false;
    loadedFileKeyRef.current = null;
    setTextContent(null); setLoadError(null); setIsContentReady(false);
    setFileSize(file.size);
    setViewMode('render');
    setIsEditing(false);
    setIsDirty(false);
    setSaveError(null);

    const isText = category === 'text' || category === 'code' || category === 'json' || category === 'markdown' || category === 'html';
    if (!isText) {
      setIsLoading(false); setIsContentReady(true); loadedFileKeyRef.current = fileKey;
      return;
    }

    setIsLoading(true);
    if (isLocalFile(file.url)) {
      const localPath = getLocalPath(file.url);
      (async () => {
        try {
          const stat = await fsApi.stat(localPath);
          if (cancelled) return;
          if (stat?.success && stat.stats?.size !== undefined) setFileSize(stat.stats.size);
          if (!stat?.success) { setLoadError(`File not found: ${localPath}`); setIsLoading(false); return; }
          const result = await fsApi.readFile(localPath, 'utf-8');
          if (cancelled) return;
          if (result?.success && result.content !== undefined) {
            setTextContent(result.content); loadedFileKeyRef.current = fileKey;
          } else {
            setLoadError(!result?.success ? result?.error : 'Failed to load file');
          }
          setIsLoading(false);
        } catch {
          if (!cancelled) { setLoadError(`Cannot read: ${localPath}`); setIsLoading(false); }
        }
      })();
    } else {
      fetch(file.url)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then(text => { if (!cancelled) { setTextContent(text); loadedFileKeyRef.current = fileKey; setIsLoading(false); } })
        .catch(() => { if (!cancelled) { setLoadError('Failed to load file'); setIsLoading(false); } });
    }
    return () => { cancelled = true; };
  }, [isOpen, file, category]);

  // Auto-refresh: poll file mtime and re-read when changed on disk
  const lastMtimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isOpen || !file || !isLocalFile(file.url) || isEditing) {
      lastMtimeRef.current = null;
      return;
    }
    const isText = category === 'text' || category === 'code' || category === 'json' || category === 'markdown' || category === 'html';
    if (!isText) return;

    const localPath = getLocalPath(file.url);

    // Seed the initial mtime from the already-loaded file
    (async () => {
      try {
        const stat = await fsApi.stat(localPath);
        if (stat?.success && stat.stats?.mtime) {
          lastMtimeRef.current = stat.stats.mtime;
        }
      } catch { /* ignore */ }
    })();

    const interval = setInterval(async () => {
      try {
        const stat = await fsApi.stat(localPath);
        if (!stat?.success || !stat.stats?.mtime) return;
        const mtime = stat.stats.mtime;
        if (lastMtimeRef.current !== null && mtime !== lastMtimeRef.current) {
          // File changed on disk — re-read
          const result = await fsApi.readFile(localPath, 'utf-8');
          if (result?.success && result.content !== undefined) {
            setTextContent(result.content);
            if (stat.stats.size !== undefined) setFileSize(stat.stats.size);
          }
        }
        lastMtimeRef.current = mtime;
      } catch { /* ignore */ }
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, file, category, isEditing]);

  useEffect(() => {
    if (!isLoading && textContent !== null && !loadError) {
      const t = setTimeout(() => setIsContentReady(true), 30);
      return () => clearTimeout(t);
    }
  }, [isLoading, textContent, loadError]);

  useEffect(() => {
    if (!isEditing || !monacoContainerRef.current || textContent === null) return;

    savedContentRef.current = textContent;

    const ext = file ? getExtension(file.name) : '';
    const language = getMonacoLanguage(ext);

    let destroyed = false;
    let disposableRef: { dispose: () => void } | null = null;

    setIsEditorLoading(true);

    import(/* webpackChunkName: "monaco-editor" */ 'monaco-editor').then((mod) => {
      if (destroyed || !monacoContainerRef.current) return;

      const editor = mod.editor.create(monacoContainerRef.current, {
        value: textContent,
        language,
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 15,
        fontFamily: "'Menlo','Monaco','Courier New',monospace",
        lineHeight: 23,
        padding: { top: 12, bottom: 12 },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        tabSize: 2,
        insertSpaces: true,
        renderWhitespace: 'none',
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        readOnly: false,
        contextmenu: true,
        quickSuggestions: false,
        parameterHints: { enabled: false },
        suggestOnTriggerCharacters: false,
        acceptSuggestionOnEnter: 'off',
        tabCompletion: 'off',
        wordBasedSuggestions: 'off',
      });

      monacoEditorRef.current = editor;
      disposableRef = editor.onDidChangeModelContent(() => {
        setIsDirty(editor.getValue() !== savedContentRef.current);
      });
      editor.focus();
      setIsEditorLoading(false);
    });

    return () => {
      destroyed = true;
      disposableRef?.dispose();
      monacoEditorRef.current?.dispose();
      monacoEditorRef.current = null;
      setIsEditorLoading(false);
    };
  }, [isEditing, textContent, file]);

  const confirmDiscardChanges = useCallback(async (): Promise<boolean> => {
    if (!isDirty) return true;
    return requestConfirmation({
      title: 'Discard unsaved changes?',
      description: 'You have unsaved changes. Do you want to discard them?',
      confirmLabel: 'Discard changes',
      destructive: true,
    });
  }, [isDirty]);

  const handleEdit = useCallback(() => {
    if (!isEditable || textContent === null) return;
    setIsDirty(false);
    setIsEditing(true);
    setSaveError(null);
  }, [isEditable, textContent]);

  const handleCancelEdit = useCallback(async () => {
    if (!(await confirmDiscardChanges())) return;
    if (monacoEditorRef.current) {
      monacoEditorRef.current.dispose();
      monacoEditorRef.current = null;
    }
    setIsEditing(false);
    setIsDirty(false);
    onDirtyStateChange?.(false);
    setSaveError(null);
  }, [confirmDiscardChanges, onDirtyStateChange]);

  const handleSave = useCallback(async () => {
    if (!file || !isEditable || !isDirty) return;
    const content = monacoEditorRef.current?.getValue() ?? '';
    setIsSaving(true);
    setSaveError(null);
    try {
      const localPath = getLocalPath(file.url);
      const result = await fsApi.writeFile(localPath, content, 'utf-8', {
        conflictResolution: 'replace',
      });
      if (result?.success) {
        setTextContent(content);
        savedContentRef.current = content;
        setIsDirty(false);
        showSuccess(`Saved ${file.name}`);
      } else {
        const errorMessage = result?.error || 'Failed to save file';
        setSaveError(errorMessage);
        showError(errorMessage);
      }
    } catch {
      showError('Failed to save file');
      setSaveError('Failed to save file');
    } finally {
      setIsSaving(false);
    }
  }, [file, isEditable, isDirty, showError, showSuccess]);

  const handleDownload = useCallback(() => {
    if (!file) return;
    try {
      if (isLocalFile(file.url)) {
        const localPath = getLocalPath(file.url);
        workspaceApi.showInFolder(localPath);
      } else {
        const link = document.createElement('a');
        link.href = file.url; link.download = file.name;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
      }
    } catch (error) {
      logger.error({ msg: "Failed to download file:", err: error });
    }
  }, [file]);

  const handleOpenExternal = useCallback(() => {
    if (!file) return;
    if (isLocalFile(file.url)) {
      workspaceApi.openPath(getLocalPath(file.url));
    } else {
      window.open(file.url, '_blank');
    }
  }, [file]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement === contentRef.current) {
        await document.exitFullscreen();
      } else if (contentRef.current?.requestFullscreen) {
        await contentRef.current.requestFullscreen();
      }
    } catch (error) {
      logger.error({ msg: "Failed to toggle fullscreen:", err: error });
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleClose = useCallback(async () => {
    if (!(await confirmDiscardChanges())) return;
    onDirtyStateChange?.(false);
    onClose();
  }, [confirmDiscardChanges, onClose, onDirtyStateChange]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditing) {
          handleCancelEdit();
        } else {
          handleClose();
        }
      }

      if (isEditing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        void toggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isEditing, handleCancelEdit, handleClose, handleSave]);

  if (!isOpen || !file) return null;

  const ext = getExtension(file.name);

  const renderBody = () => {
    const isNonText = category === 'pdf' || category === 'office' || category === 'other';

    if (loadError) {
      return <div className="flex flex-col items-center justify-center gap-3 h-full text-[#9ca3af] p-6 text-center"><AlertTriangle size={32} className="text-[#f59e0b]" /><p className="text-[13px] m-0 max-w-75 wrap-break-word">{loadError}</p></div>;
    }

    if (!isNonText && (isLoading || !isContentReady || loadedFileKeyRef.current !== fileKey)) {
      return <div className={LOADING_BOX}><div className={SPINNER} /><span>Loading…</span></div>;
    }

    if (isEditing) {
      return (
        <div className="flex flex-col h-full min-h-0 relative">
          {isEditorLoading && <div className={LOADING_BOX}><div className={SPINNER} /><span>Loading editor…</span></div>}
          {saveError && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#fef2f2] border-b border-[#fecaca] text-[#dc2626] text-xs font-medium shrink-0">
              <AlertTriangle size={14} />
              <span>{saveError}</span>
            </div>
          )}
          <div ref={monacoContainerRef} className="h-full w-full" />
        </div>
      );
    }

    switch (category) {
      case 'html':
        if (viewMode === 'source') return <ReadonlyMonacoViewer content={textContent ?? ''} language="html" />;
        if (!htmlBlobUrl) return null;
        return <iframe className="w-full h-full border-none" src={htmlBlobUrl} title={file.name} sandbox="allow-scripts allow-popups" />;

      case 'json':
        return <ReadonlyMonacoViewer content={textContent ?? ''} language="json" />;

      case 'markdown': {
        if (viewMode === 'source') return <ReadonlyMonacoViewer content={textContent ?? ''} language="markdown" />;
        const { frontMatter, content: body } = parseFrontMatter(textContent ?? '');
        return (
          <div className="inline-preview-markdown px-6 py-5 text-base leading-[1.8] text-[#2b2b2b] wrap-break-word">
            {frontMatter && <FrontMatterTable frontMatter={frontMatter} />}
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}
              components={{
                a: ({ href, children, ...props }) => {
                  if (href && /^https?:\/\//.test(href)) {
                    return <a {...props} href={href} onClick={e => { e.preventDefault(); window.open(href, '_blank', 'noopener,noreferrer'); }} title={href} style={{ cursor: 'pointer' }}>{children}</a>;
                  }
                  return <a {...props} href={href}>{children}</a>;
                },
              }}
            >{body}</ReactMarkdown>
          </div>
        );
      }

      case 'code':
      case 'text':
        return <ReadonlyMonacoViewer content={textContent ?? ''} language={getMonacoLanguage(ext)} />;

      case 'pdf': {
        const src = isLocalFile(file.url) ? `file://${getLocalPath(file.url)}` : file.url;
        return <iframe className="w-full h-full border-none" src={`${src}#view=FitH`} title={file.name} />;
      }

      case 'office':
      case 'other':
      default:
        return (
          <div className="flex flex-col items-center justify-center gap-3 h-full text-[#9ca3af] p-6 text-center">
            <FileIcon size={40} />
            <p className="text-[13px] m-0">This file type cannot be previewed inline.</p>
            <Button variant="default" size="sm" className="px-4 py-2 border border-black/12 rounded-lg bg-white text-[#444444] text-[13px] hover:bg-black/4 hover:border-black/20" onClick={handleOpenExternal}>Open with Default App</Button>
          </div>
        );
    }
  };

  return (
    <div
      data-dbg="inline-file-preview-panel"
      className="inline-preview-fullscreen flex-1 flex flex-col min-w-0 h-full bg-white overflow-hidden animate-[inlinePreviewSlideIn_0.3s_cubic-bezier(0.16,1,0.3,1)] will-change-[transform,opacity]"
      ref={contentRef}
      style={style}
    >
      {/* Header */}
      <div className="inline-preview-header flex items-center justify-between px-3 py-1 border-b border-black/8 shrink-0 gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="shrink-0 text-[#6b7280] flex items-center">{getFileIcon(category)}</span>
          <div className="flex flex-col min-w-0 gap-0.5">
            <span className="text-[13px] font-medium text-[#2b2b2b] truncate" title={file.name}>{file.name}</span>
            <span className="flex items-center gap-1.5 min-w-0 text-[11px] text-[#9ca3af]">
              {ext.toUpperCase() || 'FILE'}
              {fileSize !== undefined ? ` · ${formatFileSize(fileSize)}` : ''}
              {file.lastModified ? ` · ${file.lastModified}` : ''}
              <Badge className={`inline-block text-[10px] font-semibold tracking-[0.4px] px-1.5 py-px rounded leading-[1.4] ${isEditing ? 'bg-[#fef3c7] text-[#92400e] border-[#fcd34d]' : 'bg-[#ededed] text-[#171717] border-[#cfcfcf]'}`}>
                {isEditing ? 'EDIT' : 'PREVIEW'}
              </Badge>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {isEditing ? (
            <>
              <Button variant="ghost" size="icon-sm" className={isDirty ? 'text-[#dc2626] animate-[inlinePreviewSavePulse_1.5s_ease-in-out_infinite]' : ''} onClick={handleSave} disabled={isSaving || !isDirty} title={isDirty ? 'Save (Ctrl/Cmd+S)' : 'No changes'}>
                <Save size={14} />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={handleCancelEdit} disabled={isSaving} title="Exit Edit Mode">
                <LogOut size={14} />
              </Button>
            </>
          ) : (
            <>
              {(category === 'html' || category === 'markdown') && (
                <Button variant="ghost" size="icon-sm" onClick={() => setViewMode(v => v === 'render' ? 'source' : 'render')}
                  title={viewMode === 'render' ? 'View Source' : 'View Rendered'}>
                  {viewMode === 'render' ? <Code size={14} /> : <Eye size={14} />}
                </Button>
              )}
              {isEditable && (
                <Button variant="ghost" size="icon-sm" onClick={handleEdit} title="Edit">
                  <Pencil size={14} />
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" onClick={handleOpenExternal} title="Open externally">
                <ExternalLink size={14} />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={handleDownload} title="Show in folder">
                <Download size={14} />
              </Button>
              {onInstallSkill && isLocalFile(file.url) && isInstallableSkillArtifact(getLocalPath(file.url)) && (
                <Button variant="ghost" size="icon-sm" onClick={() => onInstallSkill(getLocalPath(file.url))} title="Install Skill">
                  <Download size={14} />
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" onClick={() => { void toggleFullscreen(); }} title={isFullscreen ? 'Exit Fullscreen (Ctrl+Shift+F)' : 'Fullscreen (Ctrl+Shift+F)'}>
                {isFullscreen ? <Minimize size={14} /> : <Monitor size={14} />}
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon-sm" className="ml-1 relative before:content-[''] before:absolute before:-left-1 before:top-1 before:bottom-1 before:w-px before:bg-black/10 hover:bg-red-500/10 hover:text-[#dc2626]" onClick={handleClose} title="Close preview">
            <X size={14} />
          </Button>
        </div>
      </div>
      {/* Body */}
      <div className="flex-1 overflow-auto relative custom-scrollbar">
        {renderBody()}
      </div>
    </div>
  );
};

export default FilePreviewPanel;
