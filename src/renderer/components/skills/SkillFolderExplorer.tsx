'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { skillsApi } from '@/ipc/skill'
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  FileText,
  FileCode,
  FileJson,
  FileType,
  Palette,
  Globe,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utilities/utils'
import { Button } from '@/shadcn/button'
import { ScrollArea } from '@/shadcn/scroll-area'
import { SkillConfig } from '../../lib/userData/types'
import { FileInfo } from './SkillViewPanel'
import { log } from '@/log';
const logger = log.child({ mod: 'SkillFolderExplorer' });

interface DirectoryItem {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  size: number
  modifiedTime: string
  extension: string | null
}

interface DirectoryContents {
  currentPath: string
  parentPath: string | null
  items: DirectoryItem[]
}

interface SkillFolderExplorerProps {
  skill: SkillConfig
  onFileSelect: (fileInfo: FileInfo) => void
}

// File icon by extension — consistent with FileTreeExplorer
const FileIcon: React.FC<{ extension: string | null }> = ({ extension }) => {
  const ext = extension?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return <FileCode size={16} />
    case 'json':
      return <FileJson size={16} />
    case 'md':
      return <FileType size={16} />
    case 'css':
    case 'scss':
      return <Palette size={16} />
    case 'html':
      return <Globe size={16} />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return <ImageIcon size={16} />
    default:
      return <FileText size={16} />
  }
}

const SkillFolderExplorer: React.FC<SkillFolderExplorerProps> = ({
  skill,
  onFileSelect
}) => {
  const [currentPath, setCurrentPath] = useState<string>('')
  const [directoryContents, setDirectoryContents] = useState<DirectoryContents | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pathHistory, setPathHistory] = useState<string[]>([])

  // Load directory contents
  const loadDirectory = useCallback(async (relativePath: string = '') => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await skillsApi.getSkillDirectoryContents(skill.name, relativePath)

      if (result?.success && result.data) {
        setDirectoryContents(result.data)
        setCurrentPath(relativePath)
      } else {
        setError(result?.error || 'Failed to load directory contents')
        setDirectoryContents(null)
      }
    } catch (err) {
      logger.error({ msg: "Error loading directory:", err: err })
      setError(err instanceof Error ? err.message : 'Failed to load directory contents')
      setDirectoryContents(null)
    } finally {
      setIsLoading(false)
    }
  }, [skill.name])

  // Load root directory initially
  useEffect(() => {
    loadDirectory('')
    setPathHistory([])
  }, [skill.name, loadDirectory])

  // Listen for skill-folder-explorer refresh events
  useEffect(() => {
    const handleRefreshFolderExplorer = (event: CustomEvent) => {
      const { skillName } = event.detail;
      // Only refresh when the refreshed skill is the currently displayed skill
      if (skillName === skill.name) {
        loadDirectory(currentPath);
      }
    };

    window.addEventListener(
      'skills:refreshFolderExplorer',
      handleRefreshFolderExplorer as EventListener
    );

    return () => {
      window.removeEventListener(
        'skills:refreshFolderExplorer',
        handleRefreshFolderExplorer as EventListener
      );
    };
  }, [skill.name, currentPath, loadDirectory]);

  // Handle directory click
  const handleDirectoryClick = useCallback((item: DirectoryItem) => {
    setPathHistory(prev => [...prev, currentPath])
    loadDirectory(item.path)
  }, [currentPath, loadDirectory])

  // Handle file click
  const handleFileClick = useCallback(async (item: DirectoryItem) => {
    try {
      const result = await skillsApi.getSkillFileContent(skill.name, item.path)

      if (result?.success && result.data) {
        onFileSelect(result.data)
      } else {
        logger.error({ msg: "Failed to load file:", err: result?.error })
      }
    } catch (err) {
      logger.error({ msg: "Error loading file:", err: err })
    }
  }, [skill.name, onFileSelect])

  // Handle back button
  const handleBack = useCallback(() => {
    if (pathHistory.length > 0) {
      const previousPath = pathHistory[pathHistory.length - 1]
      setPathHistory(prev => prev.slice(0, -1))
      loadDirectory(previousPath)
    }
  }, [pathHistory, loadDirectory])

  // Build breadcrumb path
  const getBreadcrumbParts = () => {
    const parts = [{ name: skill.name, path: '' }]
    if (currentPath) {
      const pathParts = currentPath.split(/[/\\]/).filter(Boolean)
      let accumulatedPath = ''
      pathParts.forEach(part => {
        accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part
        parts.push({ name: part, path: accumulatedPath })
      })
    }
    return parts
  }

  // Handle breadcrumb click
  const handleBreadcrumbClick = useCallback((targetPath: string) => {
    if (targetPath === currentPath) {
      return
    }

    const pathParts = targetPath ? targetPath.split(/[/\\]/).filter(Boolean) : []
    const newHistory: string[] = ['']
    let accumulatedPath = ''
    for (const part of pathParts) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part
      if (accumulatedPath !== targetPath) {
        newHistory.push(accumulatedPath)
      }
    }
    if (targetPath !== '') {
      setPathHistory(newHistory.slice(1))
    } else {
      setPathHistory([])
    }
    loadDirectory(targetPath)
  }, [loadDirectory, currentPath])

  const breadcrumbParts = getBreadcrumbParts()

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: breadcrumb navigation */}
      <div className="flex shrink-0 items-center gap-1 border-b border-sc-border px-3 py-2.5">
        {pathHistory.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={handleBack}
            title="Go back"
          >
            <ChevronLeft size={16} />
          </Button>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-0.5">
          {breadcrumbParts.map((part, index, arr) => {
            const isLast = index === arr.length - 1
            return (
              <React.Fragment key={part.path}>
                <button
                  type="button"
                  onClick={() => handleBreadcrumbClick(part.path)}
                  disabled={isLast}
                  className={cn(
                    'max-w-[12rem] truncate rounded px-1.5 py-0.5 text-sm transition-colors',
                    isLast
                      ? 'font-semibold text-sc-foreground'
                      : 'text-sc-muted-foreground hover:bg-sc-accent hover:text-sc-foreground',
                  )}
                >
                  {part.name}
                </button>
                {!isLast && (
                  <span className="text-sm text-sc-muted-foreground/60">/</span>
                )}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Content: file and directory list */}
      {isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sc-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm">Loading directory...</p>
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-red-500">
          <p>{error}</p>
        </div>
      ) : directoryContents && directoryContents.items.length > 0 ? (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-1.5 p-3">
            {directoryContents.items.map((item) => (
              <li key={item.path}>
                <button
                  type="button"
                  onClick={() => item.isDirectory ? handleDirectoryClick(item) : handleFileClick(item)}
                  className={cn(
                    'group flex w-full items-center gap-3 rounded-lg border border-sc-border bg-sc-card px-3 py-2.5 text-left transition-colors',
                    'hover:border-indigo-300 hover:bg-sc-accent/60 dark:hover:border-indigo-500/40',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                      item.isDirectory
                        ? 'bg-indigo-50 text-indigo-500 group-hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-400 dark:group-hover:bg-indigo-500/25'
                        : 'bg-sc-muted text-sc-muted-foreground',
                    )}
                  >
                    {item.isDirectory ? <Folder size={16} /> : <FileIcon extension={item.extension} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-sc-foreground">
                    {item.name}
                  </span>
                  {item.isFile && (
                    <span className="shrink-0 text-xs tabular-nums text-sc-muted-foreground">
                      {formatFileSize(item.size)}
                    </span>
                  )}
                  {item.isDirectory && (
                    <ChevronRight
                      size={16}
                      className="shrink-0 text-sc-muted-foreground opacity-0 transition-opacity group-hover:opacity-60"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sm text-sc-muted-foreground">
          <Folder className="size-10 opacity-40" />
          <p>This directory is empty</p>
        </div>
      )}
    </div>
  )
}

// Format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default SkillFolderExplorer
