import { BrowserWindow, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

import { log } from '@main/log';
import type { ImportConflictResolution } from '@shared/types/fsTypes';
import { collectImportConflicts, planImportTargets, promptImportConflictResolution } from './shared';
import { getWorkspaceWatcher } from "../../lib/workspace/WorkspaceWatcher";
import { renderToMain, mainToRender } from '@shared/ipc/workspace';

export default function() {
  const handle = renderToMain.bindMain(ipcMain);

  // ===============================
  // Workspace related IPC handlers
  // ===============================

  // Select workspace folder
  handle.selectFolder(async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        return {
          success: false,
          error: 'No main window available'
        };
      }

      const dialogOptions: Electron.OpenDialogOptions = {
        title: 'Select Workspace Folder',
        properties: ['openDirectory'],
        buttonLabel: 'Select Folder'
      };

      const result = await dialog.showOpenDialog(win, dialogOptions);

      // Handle the result properly
      if (Array.isArray(result)) {
        // Old API format (just file paths array)
        if (result.length === 0) {
          return {
            success: false,
            error: 'Folder selection canceled'
          };
        }
        return {
          success: true,
          folderPath: result[0]
        };
      } else {
        // New API format (object with canceled and filePaths)
        const dialogResult = result as any;
        if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
          return {
            success: false,
            error: 'Folder selection canceled'
          };
        }
        return {
          success: true,
          folderPath: dialogResult.filePaths[0]
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Get file tree structure - using ripgrep-based high-performance implementation
  handle.getFileTree(async (_event, workspacePath, options?) => {
    try {
      // 🔥 Fix: normalize path separators to prevent startsWith check failures caused by mixed slashes on Windows
      workspacePath = path.normalize(workspacePath);
      if (!workspacePath || !fs.existsSync(workspacePath)) {
        return {
          success: false,
          error: 'Invalid workspace path'
        };
      }


      // Use FileTreeService (ripgrep-based)
      const watcher = getWorkspaceWatcher();

      // Convert ignorePatterns to excludePattern
      const excludePattern = options?.ignorePatterns?.join(',');

      const result = await watcher.getFileTree({
        folder: workspacePath,
        maxDepth: options?.maxDepth, // Do not set default value, allow undefined to enable unlimited depth
        excludePattern,
        includeHidden: true,
        useGitignore: true
      });

      // Convert to frontend-expected format (with path safety validation and absolute path conversion)
      const convertNodeFormat = (node: any, workspacePath: string): any => {
        if (!node) return null;

        // 🔥 Critical fix: ensure all paths are absolute paths
        let safePath = node.path;

        // Detailed debug log

        // 🔥 Force convert to absolute path
        if (!path.isAbsolute(safePath)) {
          // Relative path: join to workspace
          safePath = path.join(workspacePath, safePath);
        }

        // Normalize path
        safePath = path.normalize(safePath);

        // 🔥 Strict validation: ensure path is within workspace
        if (!safePath.startsWith(workspacePath)) {
          return null;
        }

        const converted: any = {
          name: node.name,
          path: safePath,
          type: node.isDirectory ? 'directory' : 'file'
        };

        // Add size information for file nodes
        if (!node.isDirectory) {
          try {
            const stats = fs.statSync(safePath);
            converted.size = stats.size;
          } catch (err) {
            converted.size = 0;
          }
        }

        // Directory nodes need to include children property, even for empty directories
        if (node.isDirectory) {
          const validChildren = node.children && node.children.length > 0
            ? node.children.map((child: any) => convertNodeFormat(child, workspacePath)).filter(Boolean)
            : [];
          converted.children = validChildren;
          converted.isExpanded = false;

        }

        return converted;
      };

      const tree = result.root.children?.map((child: any) => convertNodeFormat(child, workspacePath)).filter(Boolean) || [];


      return {
        success: true,
        data: {
          workspacePath,
          workspaceName: path.basename(workspacePath),
          tree
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Clear file tree cache - for refresh functionality
  handle.clearFileTreeCache(async (_event, workspacePath?) => {
    try {

      const watcher = getWorkspaceWatcher();

      // Clear specified path or all cache
      watcher.clearFileTreeCache(workspacePath);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Get direct children of directory (lazy-loaded file tree) - returns single level only, no recursion
  handle.getDirectoryChildren(async (_event, dirPath, options?) => {
    try {
      dirPath = path.normalize(dirPath);
      if (!dirPath || !fs.existsSync(dirPath)) {
        return { success: false, error: 'Invalid directory path' };
      }

      const ignoreSet = new Set(options?.ignorePatterns || [
        'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.vscode', '.idea'
      ]);

      // Use fs.readdir directly to get immediate children - ripgrep --files only
      // returns files and misses directories that contain no files at depth 1.
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      const children: any[] = [];
      for (const entry of entries) {
        // Skip ignored patterns
        if (ignoreSet.has(entry.name)) continue;

        const childPath = path.join(dirPath, entry.name);
        const isDirectory = entry.isDirectory() || entry.isSymbolicLink() && (() => {
          try { return fs.statSync(childPath).isDirectory(); } catch { return false; }
        })();

        const item: any = {
          name: entry.name,
          path: childPath,
          type: isDirectory ? 'directory' : 'file',
        };

        if (!isDirectory) {
          try { item.size = fs.statSync(childPath).size; } catch { item.size = 0; }
        }

        children.push(item);
      }

      // Sort: directories first, then files, both alphabetically
      children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { success: true, data: { dirPath, children } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Listen for workspace file changes - using real file system monitoring
  handle.startWatch(async (event, workspacePath, options?) => {
    try {

      const watcher = getWorkspaceWatcher();
      const send = mainToRender.bindWebContents(event.sender);

      // Set up event listeners (if not already set)
      if (!watcher.listenerCount('fileChanged')) {
        watcher.on('fileChanged', (changes) => {
          // Send file change events to renderer process (check if webContents is still valid)
          try {
            if (!event.sender.isDestroyed()) {
              send.fileChanged(changes);
            }
          } catch (error) {
            // Ignore send failure errors (window may have been closed)
          }
        });

        watcher.on('watchError', (error) => {
          // Send error events to renderer process (check if webContents is still valid)
          try {
            if (!event.sender.isDestroyed()) {
              send.watchError(error);
            }
          } catch (err) {
            // Ignore send failure errors (window may have been closed)
          }
        });
      }

      // Start file monitoring
      await watcher.startFileWatch(workspacePath, options);

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Stop watching workspace
  handle.stopWatch(async () => {
    try {

      const watcher = getWorkspaceWatcher();

      await watcher.stopFileWatch();

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Get file watcher statistics
  handle.getWatcherStats(async () => {
    try {
      const watcher = getWorkspaceWatcher();

      const stats = watcher.getWatcherStats();

      return {
        success: true,
        data: stats
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Search workspace files
  handle.searchFiles(async (_event, query) => {
    try {

      // Validate folder parameter
      if (!query.folder) {
        const errorMsg = 'Workspace folder path is required for file search. Please provide a valid workspace path.';
        return {
          success: false,
          error: errorMsg
        };
      }

      const watcher = getWorkspaceWatcher();

      // Call search service
      const result = await watcher.searchFiles(query as any);


      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Copy file or directory to target path
  const copyPathRecursive = (srcPath: string, finalTargetPath: string) => {
    const sourceStats = fs.statSync(srcPath);

    if (sourceStats.isDirectory()) {
      fs.mkdirSync(finalTargetPath, { recursive: true });
      const entries = fs.readdirSync(srcPath);
      for (const entry of entries) {
        const childSourcePath = path.join(srcPath, entry);
        const childTargetPath = path.join(finalTargetPath, entry);
        copyPathRecursive(childSourcePath, childTargetPath);
      }
      return sourceStats;
    }

    fs.mkdirSync(path.dirname(finalTargetPath), { recursive: true });
    fs.copyFileSync(srcPath, finalTargetPath, fs.constants.COPYFILE_FICLONE);
    return sourceStats;
  };

  const executeWorkspaceCopy = async (
    event: Electron.IpcMainInvokeEvent,
    sourcePaths: string[],
    destPath: string,
    options?: { conflictResolution?: ImportConflictResolution },
  ) => {
    const logger = log;
    logger.info({ msg: '[workspace:copyPaths] Copy requested', mod: 'workspace:copyPaths', sourcePaths, destPath, options });

    const strategy = options?.conflictResolution || 'reject';
    const results: Array<{ sourcePath: string; targetPath?: string; success: boolean; skipped?: boolean; renamed?: boolean; replaced?: boolean; error?: string }> = [];

    const validSourcePaths = sourcePaths.filter(Boolean);
    const missingSourcePaths = validSourcePaths.filter((sourcePath) => !fs.existsSync(sourcePath));
    for (const missingSourcePath of missingSourcePaths) {
      results.push({
        sourcePath: missingSourcePath,
        success: false,
        error: 'Source path does not exist',
      });
    }

    const plannedCandidates = validSourcePaths
      .filter((sourcePath) => fs.existsSync(sourcePath))
      .map((sourcePath, index) => ({
        id: String(index),
        sourcePath,
        sourceName: path.basename(sourcePath),
        desiredPath: path.join(destPath, path.basename(sourcePath)),
      }));

    const conflicts = collectImportConflicts(
      plannedCandidates.map((candidate) => ({
        id: candidate.id,
        displayName: candidate.sourceName,
        desiredPath: candidate.desiredPath,
      })),
    );

    let effectiveStrategy = strategy;
    if (strategy === 'prompt' && conflicts.length > 0) {
      const decision = await promptImportConflictResolution(event, 'add files', conflicts);
      if (decision === 'cancel') {
        return {
          success: false,
          canceled: true,
          error: 'User canceled conflict resolution',
          data: {
            results,
            successCount: 0,
            failCount: results.length,
            skippedCount: 0,
            renamedCount: 0,
          },
        };
      }
      effectiveStrategy = decision;
    }

    if (effectiveStrategy === 'reject' && conflicts.length > 0) {
      return {
        success: false,
        error: `Target path already exists: ${conflicts[0].displayName}`,
        data: {
          results,
          successCount: 0,
          failCount: results.length,
          skippedCount: 0,
          renamedCount: 0,
        },
      };
    }

    const plans = planImportTargets(plannedCandidates, effectiveStrategy as Exclude<ImportConflictResolution, 'prompt' | 'reject'>);
    const planById = new Map(plans.map((plan) => [plan.id, plan]));

    for (const candidate of plannedCandidates) {
      try {
        const plan = planById.get(candidate.id);
        if (!plan) {
          results.push({
            sourcePath: candidate.sourcePath,
            success: false,
            error: 'Missing import plan',
          });
          continue;
        }

        if (plan.skipped) {
          results.push({
            sourcePath: candidate.sourcePath,
            success: true,
            skipped: true,
          });
          continue;
        }

        const finalTargetPath = plan.finalPath!;
        if (plan.replaceExisting && fs.existsSync(finalTargetPath)) {
          fs.rmSync(finalTargetPath, { recursive: true, force: true });
        }

        const sourceStats = copyPathRecursive(candidate.sourcePath, finalTargetPath);
        results.push({
          sourcePath: candidate.sourcePath,
          targetPath: finalTargetPath,
          success: true,
          renamed: !!plan.renamed,
          replaced: !!plan.replaceExisting,
        });
        logger.info({ msg: '[workspace:copyPaths] Copy completed successfully', mod: 'workspace:copyPaths', sourcePath: candidate.sourcePath, finalTargetPath, isDirectory: sourceStats.isDirectory() });
      } catch (error) {
        logger.error({ msg: '[workspace:copyPaths] Copy failed', mod: 'workspace:copyPaths', sourcePath: candidate.sourcePath, destPath, err: error });
        results.push({
          sourcePath: candidate.sourcePath,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter((result) => result.success && !result.skipped).length;
    const skippedCount = results.filter((result) => result.skipped).length;
    const failCount = results.filter((result) => !result.success).length;
    const renamedCount = results.filter((result) => result.renamed).length;

    return {
      success: true,
      data: {
        results,
        successCount,
        failCount,
        skippedCount,
        renamedCount,
      },
    };
  };

  handle.copyPaths(async (event, sourcePaths, destPath, options?) => {
    return executeWorkspaceCopy(event, sourcePaths, destPath, options);
  });

  handle.copyPath(async (event, sourcePath, destPath, options?) => {
    const logger = log;
    logger.info({ msg: '[workspace:copyPath] Copy requested', mod: 'workspace:copyPath', sourcePath, destPath });
    try {
      return executeWorkspaceCopy(event, [sourcePath], destPath, options);
    } catch (error) {
      logger.error({ msg: '[workspace:copyPath] Copy failed', mod: 'workspace:copyPath', sourcePath, destPath, err: error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });


  // Open file or directory (with system default program)
  handle.openPath(async (_event, targetPath) => {
    try {

      // Validate path exists
      if (!fs.existsSync(targetPath)) {
        return {
          success: false,
          error: 'Path does not exist'
        };
      }

      // Use shell.openPath to open file or directory
      const result = await shell.openPath(targetPath);

      if (result) {
        // If a non-empty string is returned, it indicates an error
        return {
          success: false,
          error: result
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Show file or directory in file manager
  handle.showInFolder(async (_event, targetPath) => {
    try {

      // Validate path exists
      if (!fs.existsSync(targetPath)) {
        return {
          success: false,
          error: 'Path does not exist'
        };
      }

      // Use shell.showItemInFolder to show in file manager
      shell.showItemInFolder(targetPath);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });
}
