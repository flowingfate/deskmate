import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import PasteToWorkspaceDialog from './PasteToWorkspaceDialog';
import { clearFileTreeCache } from '../../../lib/chat/workspaceOps';
import { fsApi } from '@/ipc/fs';
import { log } from '@/log';
const logger = log.child({ mod: 'PasteToWorkspaceProvider' });

/**
 * PasteToWorkspace Context interface
 */
export interface PasteToWorkspaceContextValue {
  /**
   * Open the paste dialog
   * @param workspacePath - workspace directory path
   * @param targetDir - target directory (optional, defaults to workspacePath)
   * @param onSuccess - success callback (e.g. for refreshing the file tree)
   */
  openPasteDialog: (
    workspacePath: string,
    targetDir?: string,
    onSuccess?: () => void
  ) => void;

  /**
   * Close the paste dialog
   */
  closePasteDialog: () => void;

  /**
   * Whether the dialog is open
   */
  isOpen: boolean;
}

// Create Context
const PasteToWorkspaceContext = createContext<PasteToWorkspaceContextValue | undefined>(undefined);

/**
 * Hook to use PasteToWorkspace Context
 */
export const usePasteToWorkspace = (): PasteToWorkspaceContextValue => {
  const context = useContext(PasteToWorkspaceContext);
  if (context === undefined) {
    throw new Error('usePasteToWorkspace must be used within a PasteToWorkspaceProvider');
  }
  return context;
};

/**
 * Provider Props
 */
interface PasteToWorkspaceProviderProps {
  children: ReactNode;
}

/**
 * PasteToWorkspaceProvider - Globally manages the Paste to Workspace dialog
 *
 * Wrap the app with this Provider in AgentLayout; components then call
 * openPasteDialog via usePasteToWorkspace() to open the dialog.
 */
export const PasteToWorkspaceProvider: React.FC<PasteToWorkspaceProviderProps> = ({ children }) => {
  // Dialog state
  const [isOpen, setIsOpen] = useState(false);
  const [workspacePath, setWorkspacePath] = useState<string>('');
  const [targetDir, setTargetDir] = useState<string>('');
  const [onSuccessCallback, setOnSuccessCallback] = useState<(() => void) | null>(null);

  // Open dialog
  const openPasteDialog = useCallback((
    path: string,
    target?: string,
    onSuccess?: () => void
  ) => {
    setWorkspacePath(path);
    setTargetDir(target || path);
    // Use functional form to store callback, preventing React from treating it as a state updater
    setOnSuccessCallback(() => onSuccess || null);
    setIsOpen(true);
  }, []);

  // Close dialog
  const closePasteDialog = useCallback(() => {
    setIsOpen(false);
    setWorkspacePath('');
    setTargetDir('');
    setOnSuccessCallback(null);
  }, []);

  // Handle save
  const handleSave = useCallback(async (content: string, fileName: string) => {
    if (!targetDir || !fileName) {
      throw new Error('Invalid workspace path or file name');
    }

    // Build full file path
    const separator = targetDir.includes('/') ? '/' : '\\';
    const filePath = `${targetDir}${separator}${fileName}`;

    logger.debug({ msg: "Saving pasted content to:", data: filePath });

    try {
      // Write file
      const result = await fsApi.writeFile(filePath, content, 'utf8', {
        conflictResolution: 'prompt',
      });

      if (!result?.success) {
        if (result?.canceled) {
          return { status: 'canceled' as const };
        }
        throw new Error(result?.error || 'Failed to write file');
      }

      if ('skipped' in result && result.skipped) {
        return { status: 'skipped' as const };
      }

      logger.debug({ msg: "File saved successfully" });

      // Clear file tree cache
      try {
        await clearFileTreeCache(workspacePath);
      } catch (error) {
        logger.error({ msg: "Failed to clear file tree cache:", err: error });
      }

      // Invoke success callback (refresh file tree, etc.)
      if (onSuccessCallback) {
        onSuccessCallback();
      }
      return { status: 'saved' as const };
    } catch (error) {
      logger.error({ msg: "Error saving pasted content:", err: error });
      throw error;
    }
  }, [targetDir, workspacePath, onSuccessCallback]);

  // Context value
  const value: PasteToWorkspaceContextValue = {
    openPasteDialog,
    closePasteDialog,
    isOpen,
  };

  return (
    <PasteToWorkspaceContext.Provider value={value}>
      {children}

      {/* Global PasteToWorkspaceDialog */}
      <PasteToWorkspaceDialog
        isOpen={isOpen}
        onClose={closePasteDialog}
        onSave={handleSave}
        workspacePath={workspacePath}
      />
    </PasteToWorkspaceContext.Provider>
  );
};

export default PasteToWorkspaceProvider;
