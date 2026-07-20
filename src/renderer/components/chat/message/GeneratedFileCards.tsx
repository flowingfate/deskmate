import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { MoreHorizontal, FolderOpen, Folder, Eye, Download, BookPlus, Copy } from 'lucide-react';
import { fsApi } from '@/ipc/fs';
import { workspaceApi } from '@/ipc/workspace';

import FileTypeIcon from '../../ui/FileTypeIcon';
import { Button } from '@/shadcn/button';
import { Badge } from '@/shadcn/badge';
import { useToast } from '../../ui/ToastProvider';
import { addFileToKnowledgeBase, shouldShowAddToKnowledgeBaseOption } from '../../../lib/chat/addToKnowledgeBase';
import { tryResolveUriToPath } from '@/lib/internalUrls';
import { ChatStatus } from '../../../lib/chat/agentSessionCacheManager';
import { toImageDisplaySrc, type MediaUrlContext } from '@/lib/mediaUrl';
import { isInstallableSkillArtifact } from '../../../lib/skills/installableSkillArtifacts';
import { log } from '@/log';
import { ApplySkillDialogAtom } from '../../skills/ApplySkillToAgentsDialog';
import { SkillFolderRefreshAtom } from '../../skills/skillCommands.atom';
import { skillsApi } from '@/ipc/skill';
import { ImageViewerAtom } from '../../ui/OverlayImageViewer';
import { useOpenFilePreview } from '../../filePreview/filePreviewScope';
import type { FilePreviewDescriptor } from '../../filePreview/FilePreviewPanel';
const logger = log.child({ mod: 'GeneratedFileCards' });

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'avif']);

/** portal 下拉菜单项:shadcn ghost Button 上覆盖为左对齐行 + hover 高亮。 */
const MENU_ITEM =
  'flex items-center text-left gap-2 px-3 py-2 w-full min-h-9 rounded-md border-0 bg-transparent cursor-pointer transition-colors hover:bg-black/5 active:bg-black/[0.08]';
const MENU_ITEM_ICON = 'flex items-center justify-center w-5 h-5 text-base';
const MENU_ITEM_TEXT = 'not-italic font-[410] text-sm leading-5 text-[#272320] flex-1 truncate';

export interface GeneratedFileCardItem {
  fileUri: string;
  exists?: boolean;
}

export interface GeneratedFileCardsProps {
  agentId: string;
  sessionId: string;
  items: GeneratedFileCardItem[];
  chatStatus?: ChatStatus;
}


function getFileName(filePath: string): string {
  if (filePath.includes('/')) {
    return filePath.split('/').pop() || filePath;
  }
  if (filePath.includes('\\')) {
    return filePath.split('\\').pop() || filePath;
  }
  return filePath;
}

function isImageFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
}

function previewGeneratedFile(
  filePath: string,
  ctx: MediaUrlContext,
  openImage: (images: { id: string; url: string; alt?: string }[], index: number) => void,
  openFile: (file: FilePreviewDescriptor) => void,
): void {
  const fileName = getFileName(filePath);
  if (isImageFile(filePath)) {
    // `local://` / `knowledge://` → `media://`(同步直供);裸绝对路径 → `file://`。
    const src = toImageDisplaySrc(filePath, ctx);
    openImage([{ id: `generated-file-${filePath}`, url: src, alt: fileName }], 0);
    return;
  }

  openFile({ name: fileName, url: filePath });
}

export const GeneratedFileCards: React.FC<GeneratedFileCardsProps> = ({ agentId, sessionId, items, chatStatus }) => {
  const [fileMenuOpen, setFileMenuOpen] = useState<Record<string, boolean>>({});
  const [fileMenuPosition, setFileMenuPosition] = useState<Record<string, { top: number; left: number }>>({});
  const [fileExistsCache, setFileExistsCache] = useState<Record<string, boolean>>(() => {
    const initialState: Record<string, boolean> = {};
    items.forEach((item) => {
      if (typeof item.exists === 'boolean') {
        initialState[item.fileUri] = item.exists;
      }
    });
    return initialState;
  });

  const checkedPathsRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);
  const { showToast } = useToast();
  // media:// 直供需要的 ctx(agent + session)。
  const mediaCtx: MediaUrlContext = { agentId, sessionId };
  const allFilePaths = useMemo(() => items.map(item => item.fileUri), [items]);
  const allFilePathsKey = useMemo(() => allFilePaths.join('\0'), [allFilePaths]);
  const installSkillActions = ApplySkillDialogAtom.useChange();
  const imageViewer = ImageViewerAtom.useChange();
  const openFilePreview = useOpenFilePreview();
  const refreshFolder = SkillFolderRefreshAtom.useChange().refresh;

  // groupLabel 字段连带分组渲染随 `present_deliverables` 工具一起下线 —— 现在
  // items 直接就是平铺的文件卡片列表,没有 description / 标题分组。
  const isSessionIdle = !chatStatus || chatStatus === 'idle';

  useEffect(() => {
    const initialState: Record<string, boolean> = {};
    items.forEach((item) => {
      if (typeof item.exists === 'boolean') {
        initialState[item.fileUri] = item.exists;
      }
    });
    setFileExistsCache(prev => ({ ...prev, ...initialState }));
  }, [items]);

  // `fsApi.exists` 是 URI-aware,wrapper 内部 resolve `local://` / `knowledge://`
  // 形态。URI 解析失败(KB 未配置 / session 还没建好)→ wrapper 抛错,这里
  // catch 收成 not exists,显示 deleted badge。
  useEffect(() => {
    if (allFilePaths.length === 0) {
      return;
    }

    const uncheckedPaths = allFilePaths.filter(filePath => !checkedPathsRef.current.has(filePath));
    if (uncheckedPaths.length === 0) {
      return;
    }

    uncheckedPaths.forEach(filePath => checkedPathsRef.current.add(filePath));

    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const checkExists = async (filePath: string): Promise<boolean> => {
      try {
        return await fsApi.exists(filePath);
      } catch {
        return false;
      }
    };

    (async () => {
      const results: Record<string, boolean> = {};
      await Promise.all(
        uncheckedPaths.map(async (filePath) => {
          results[filePath] = await checkExists(filePath);
        }),
      );

      if (!isMountedRef.current) {
        return;
      }
      setFileExistsCache(prev => ({ ...prev, ...results }));

      const missingPaths = Object.entries(results)
        .filter(([_, exists]) => !exists)
        .map(([filePath]) => filePath);

      if (missingPaths.length > 0) {
        retryTimer = setTimeout(async () => {
          const retryResults: Record<string, boolean> = {};
          await Promise.all(
            missingPaths.map(async (filePath) => {
              retryResults[filePath] = await checkExists(filePath);
            }),
          );

          if (isMountedRef.current && Object.keys(retryResults).length > 0) {
            setFileExistsCache(prev => ({ ...prev, ...retryResults }));
          }
        }, 2000);
      }
    })();

    return () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
    // Depend only on the stable string key. allFilePaths reference changes every
    // parent render, and including fileExistsCache would re-trigger this effect
    // on every check result, causing cleanup-races that discarded async results
    // before they could write to the cache.
  }, [allFilePathsKey, agentId]);

  useEffect(() => {
    const handleClickOutside = () => {
      setFileMenuOpen({});
    };

    if (Object.values(fileMenuOpen).some(Boolean)) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [fileMenuOpen]);

  if (items.length === 0) {
    return null;
  }

  const handleFileMenuToggle = (filePath: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const isCurrentlyOpen = fileMenuOpen[filePath];

    setFileMenuOpen({ [filePath]: !isCurrentlyOpen });

    if (!isCurrentlyOpen) {
      setFileMenuPosition(prev => ({
        ...prev,
        [filePath]: {
          top: rect.bottom + 4,
          left: rect.left,
        },
      }));
    }
  };

  // workspaceApi.openPath / showInFolder 仍要绝对路径 —— URI 在调前展开。
  const handleOpenWithDefaultApp = async (filePath: string) => {
    try {
      const absPath = await tryResolveUriToPath(filePath, { agentId });
      if (!absPath) {
        showToast('Unable to resolve file path', 'error');
        return;
      }
      const result = await workspaceApi.openPath(absPath);
      if (result?.success) {
        setFileMenuOpen({});
      } else {
        showToast(result?.error || 'Unable to open file', 'error');
      }
    } catch (error) {
      logger.error({ msg: "Failed to open file:", err: error });
      showToast('Unable to open file', 'error');
    }
  };

  const handleShowInFolder = async (filePath: string) => {
    try {
      const absPath = await tryResolveUriToPath(filePath, { agentId });
      if (!absPath) {
        showToast('Unable to resolve file path', 'error');
        return;
      }
      const result = await workspaceApi.showInFolder(absPath);
      if (result?.success) {
        setFileMenuOpen({});
      } else {
        showToast(result?.error || 'Unable to open folder', 'error');
      }
    } catch (error) {
      logger.error({ msg: "Failed to show in folder:", err: error });
      showToast('Unable to open folder', 'error');
    }
  };

  // `addFileToKnowledgeBase` 只接 source URI/path,KB 目标内部用
  // `knowledge://` 自解析(不再从 atom 读 KB 绝对路径)。
  const handleAddToKnowledge = async (filePath: string) => {
    try {
      setFileMenuOpen({});
      const result = await addFileToKnowledgeBase(filePath);
      if (result?.success) {
        showToast('File added to knowledge base', 'success', 5000, {
          actions: [
            {
              label: 'Open Knowledge Base',
              onClick: async () => {
                try {
                  const kbAbs = await tryResolveUriToPath('knowledge://', { agentId });
                  if (!kbAbs) {
                    showToast('Unable to open knowledge base', 'error');
                    return;
                  }
                  const openResult = await workspaceApi.openPath(kbAbs);
                  if (!openResult?.success) {
                    showToast(openResult?.error || 'Unable to open knowledge base', 'error');
                  }
                } catch (error) {
                  logger.error({ msg: "Failed to open knowledge base:", err: error });
                  showToast('Unable to open knowledge base', 'error');
                }
              },
            },
          ],
        });
      } else if (result?.error !== 'User cancelled replacement') {
        showToast(result?.error || 'Failed to add file to knowledge base', 'error');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showToast(`Failed to add to knowledge base: ${errorMessage}`, 'error');
    }
  };

  const handleInstallSkill = async (filePath: string) => {
    try {
      if (!skillsApi?.installSkillFromFilePath) {
        showToast('Install skill API not available', 'error');
        return;
      }

      const result = await skillsApi.installSkillFromFilePath(filePath, {
        agentId,
        applyToCurrentAgent: true,
        requestSource: 'generated-file',
      });

      if (result.success) {
        showToast(result.message || `Skill "${result.skillName}" installed successfully`, 'success');

        if (result.skillName) {
          const refreshedSkillName = result.skillName;
          setTimeout(() => {
            refreshFolder(refreshedSkillName);
          }, 600);
        }

        if (result.skillName && result.resolution === 'installed_but_needs_target_selection') {
          installSkillActions.setSkill(result.skillName);
        }
      } else if (result.error && result.error !== 'User cancelled the operation') {
        showToast(result.error, 'error', undefined, { persistent: true });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showToast(`Failed to install skill: ${errorMessage}`, 'error');
    }
  };

  const renderGeneratedFileItem = (item: GeneratedFileCardItem, index: number) => {
    const filePath = item.fileUri;
    const fileName = getFileName(filePath);
    const fileExists = fileExistsCache[filePath] ?? item.exists ?? true;
    const isAvailable = fileExists;
    const responsiveCardStyle: React.CSSProperties = {
      width: 'min(100%, 400px)',
      maxWidth: '100%',
      minWidth: 0,
    };

    return (
      <div
        key={`${filePath}-${index}`}
        className="box-border flex text-[13px] items-center gap-1 p-2 w-full min-w-0 bg-white border border-[#EFEAE7] rounded transition-all cursor-pointer relative hover:bg-[#FAFAFA] hover:border-[#E0DBD8] hover:translate-x-0.5 hover:shadow-[0_2px_4px_rgba(0,0,0,0.05)] active:translate-x-px active:bg-[#F5F5F5]"
        onClick={() => isAvailable && previewGeneratedFile(filePath, mediaCtx, imageViewer.open, openFilePreview)}
        title={!fileExists ? `File deleted: ${filePath}` : `Click to open: ${filePath}`}
        style={
          !isAvailable
            ? { ...responsiveCardStyle, opacity: 0.6, cursor: 'not-allowed' }
            : responsiveCardStyle
        }
      >
        <span className="flex items-center justify-center w-6 h-6 shrink-0">
          <FileTypeIcon fileName={fileName} size={16} />
        </span>
        <span className="font-[410] text-[#322D29] truncate flex-1 min-w-0" title={filePath}>
          {fileName}
        </span>
        {!fileExists && (
          <Badge variant="destructive" className="text-[11px] px-1.5 py-0 ml-1.5">
            deleted
          </Badge>
        )}
        {isAvailable && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="flex flex-col items-center justify-center p-1 w-6 h-6 border-0 bg-transparent cursor-pointer rounded transition-colors shrink-0 hover:bg-black/8 active:scale-95"
            onClick={(event) => handleFileMenuToggle(filePath, event)}
            title="More options"
          >
            <MoreHorizontal size={12} strokeWidth={2} />
          </Button>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="mt-0 mb-0 w-full">
        <div className="flex flex-col gap-2 w-full">
          {items.map(renderGeneratedFileItem)}
        </div>
      </div>

      {Object.entries(fileMenuOpen).map(([filePath, isOpen]) => {
        if (!isOpen || fileExistsCache[filePath] === false) {
          return null;
        }

        const menuPos = fileMenuPosition[filePath];
        if (!menuPos) {
          return null;
        }

        return ReactDOM.createPortal(
          <div
            key={filePath}
            className="fixed z-1000 flex flex-col items-start p-1 gap-0.5 min-w-50 bg-white border border-black/10 rounded-lg shadow-[0px_2px_8px_rgba(0,0,0,0.15),0px_0px_1px_rgba(0,0,0,0.1)] animate-[dropdownFadeIn_0.15s_ease-out]"
            style={{
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`,
            }}
          >
            <Button
              variant="ghost"
              size="icon"
              className={MENU_ITEM}
              onClick={() => {
                setFileMenuOpen({});
                previewGeneratedFile(filePath, mediaCtx, imageViewer.open, openFilePreview);
              }}
            >
              <span className={MENU_ITEM_ICON}>
                <Eye size={16} strokeWidth={2} />
              </span>
              <span className={MENU_ITEM_TEXT}>Preview file</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={MENU_ITEM}
              onClick={() => handleOpenWithDefaultApp(filePath)}
            >
              <span className={MENU_ITEM_ICON}>
                <FolderOpen size={16} strokeWidth={2} />
              </span>
              <span className={MENU_ITEM_TEXT}>Open file with default app</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={MENU_ITEM}
              onClick={() => handleShowInFolder(filePath)}
            >
              <span className={MENU_ITEM_ICON}>
                <Folder size={16} strokeWidth={2} />
              </span>
              <span className={MENU_ITEM_TEXT}>Open file in folder</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={MENU_ITEM}
              onClick={() => {
                navigator.clipboard.writeText(filePath);
                setFileMenuOpen({});
              }}
            >
              <span className={MENU_ITEM_ICON}>
                <Copy size={16} strokeWidth={2} />
              </span>
              <span className={MENU_ITEM_TEXT}>Copy file path</span>
            </Button>
            {isInstallableSkillArtifact(filePath) && (
              <Button
                variant="ghost"
                size="icon"
                className={MENU_ITEM}
                onClick={() => {
                  setFileMenuOpen({});
                  handleInstallSkill(filePath);
                }}
              >
                <span className={MENU_ITEM_ICON}>
                  <Download size={16} strokeWidth={2} />
                </span>
                <span className={MENU_ITEM_TEXT}>Install skill</span>
              </Button>
            )}
            {shouldShowAddToKnowledgeBaseOption(filePath, isSessionIdle) && (
              <Button
                variant="ghost"
                size="icon"
                className={MENU_ITEM}
                onClick={() => handleAddToKnowledge(filePath)}
              >
                <span className={MENU_ITEM_ICON}>
                  <BookPlus size={16} strokeWidth={2} />
                </span>
                <span className={MENU_ITEM_TEXT}>Add to Knowledge Base</span>
              </Button>
            )}
          </div>,
          document.body,
        );
      })}
    </>
  );
};

export default GeneratedFileCards;