'use client'

import React, { useState, useCallback } from 'react'
import { BookMarked } from 'lucide-react'
import { SkillConfig } from '../../lib/userData/types'
import { skillsApi } from '@/ipc/skill'
import SkillFolderExplorer from './SkillFolderExplorer'
import SkillFileViewer from './SkillFileViewer'
import { SkillFolderRefreshAtom } from './skillCommands.atom'
import { log } from '@/log';
const logger = log.child({ mod: 'SkillViewPanel' });

interface SkillViewPanelProps {
  skill: SkillConfig | null
}

// View state type
type ViewMode = 'folder' | 'file'

export interface FileInfo {
  fileName: string
  path: string
  extension: string
  content: string | null
  isSupported: boolean
  size: number
  modifiedTime: string
}

const SkillViewPanel: React.FC<SkillViewPanelProps> = ({
  skill
}) => {
  // View mode: folder (directory browsing) or file (file viewing)
  const [viewMode, setViewMode] = useState<ViewMode>('folder')
  // Currently selected file info
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)

  // Handle file click - switch to file viewing mode
  const handleFileSelect = useCallback((fileInfo: FileInfo) => {
    setSelectedFile(fileInfo)
    setViewMode('file')
  }, [])

  // Handle back to folder browsing
  const handleBackToFolder = useCallback(() => {
    setViewMode('folder')
    setSelectedFile(null)
  }, [])

  // When skill changes, reset to folder browsing mode
  React.useEffect(() => {
    setViewMode('folder')
    setSelectedFile(null)
  }, [skill?.name])

  // Subscribe to the folder-refresh signal. In file mode, reload the open file's content;
  // folder mode refresh is owned by SkillFolderExplorer. Nonce ref avoids reacting to
  // its own state churn (viewMode / selectedFile changes).
  const [{ skillName: refreshSkillName, nonce: refreshNonce }] = SkillFolderRefreshAtom.use();
  const lastRefreshNonce = React.useRef(refreshNonce);
  React.useEffect(() => {
    if (refreshNonce === lastRefreshNonce.current) return;
    lastRefreshNonce.current = refreshNonce;
    if (!skill || refreshSkillName !== skill.name) return;
    if (viewMode === 'file' && selectedFile) {
      void (async () => {
        try {
          const result = await skillsApi.getSkillFileContent(skill.name, selectedFile.path);
          if (result?.success && result.data) {
            setSelectedFile(result.data);
          }
        } catch (error) {
          logger.error({ msg: "Error refreshing file content:", err: error });
        }
      })();
    }
  }, [refreshNonce, refreshSkillName, skill, viewMode, selectedFile]);

  if (!skill) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-sc-muted text-sc-muted-foreground">
          <BookMarked className="size-6" />
        </span>
        <p className="text-sm text-sc-muted-foreground">Select a skill to view its files</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {viewMode === 'folder' ? (
        <SkillFolderExplorer
          skill={skill}
          onFileSelect={handleFileSelect}
        />
      ) : (
        <SkillFileViewer
          skill={skill}
          fileInfo={selectedFile}
          onBack={handleBackToFolder}
        />
      )}
    </div>
  )
}

export default SkillViewPanel