import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import JSZip from 'jszip';
import { flushLogs } from '@main/log';
import { crashCaptureManager } from '@main/lib/crash/CrashCaptureManager';
import { getDebugInfoEntries } from '@main/lib/utilities/debugInfoEntries';
import { buildDebugInfoManifest } from '@main/lib/utilities/debugInfoManifest';
import { createRedactor, isTextFile, redactFileContent } from '@main/lib/utilities/redact';
import { getAppDataPath } from "@main/persist/lib/path";

import { mainToRender as appMainToRender } from '@shared/ipc/app';
import { APP_VERSION } from '@shared/constants/branding';


async function addPathToZip(zip: JSZip, sourcePath: string, zipPrefix: string, redact?: (s: string) => string): Promise<void> {
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  const stats = await fs.promises.stat(sourcePath);
  if (stats.isDirectory()) {
    const entries = await fs.promises.readdir(sourcePath, { withFileTypes: true });
    if (entries.length === 0) {
      zip.folder(zipPrefix);
      return;
    }

    await Promise.all(entries.map(async (entry) => {
      const childSourcePath = path.join(sourcePath, entry.name);
      const childZipPath = `${zipPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await addPathToZip(zip, childSourcePath, childZipPath, redact);
        return;
      }

      if (entry.isFile()) {
        if (redact && isTextFile(entry.name)) {
          const text = await fs.promises.readFile(childSourcePath, 'utf-8');
          zip.file(childZipPath, redactFileContent(text, childZipPath, redact));
        } else {
          const content = await fs.promises.readFile(childSourcePath);
          zip.file(childZipPath, content);
        }
      }
    }));
    return;
  }

  if (stats.isFile()) {
    if (redact && isTextFile(sourcePath)) {
      const text = await fs.promises.readFile(sourcePath, 'utf-8');
      zip.file(zipPrefix, redactFileContent(text, zipPrefix, redact));
    } else {
      const content = await fs.promises.readFile(sourcePath);
      zip.file(zipPrefix, content);
    }
  }
}


function getDebugInfoTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

export async function exportDebugInfo(profileId: string | null): Promise<{ success: boolean; filePath?: string; fileName?: string; error?: string }> {
  try {
    // flushLogs 等 worker 把缓冲全部 INSERT 进 sqlite，否则导出包会漏最后一批日志。
    await flushLogs();

    const downloadsDir = app.getPath('downloads');
    const timestamp = getDebugInfoTimestamp();
    let fileName = `debug-${timestamp}.zip`;
    let filePath = path.join(downloadsDir, fileName);
    let suffix = 1;

    while (fs.existsSync(filePath)) {
      fileName = `debug-${timestamp}-${suffix}.zip`;
      filePath = path.join(downloadsDir, fileName);
      suffix += 1;
    }

    const zip = new JSZip();
    const redact = createRedactor({ profileId });
    const exportedAt = new Date().toISOString();
    const crashStatus = crashCaptureManager.getStatus();
    const crashBundleNames = fs.existsSync(crashStatus.crashRootDir)
      ? fs.readdirSync(crashStatus.crashRootDir).filter((entry) => {
        try {
          return fs.statSync(path.join(crashStatus.crashRootDir, entry)).isDirectory();
        } catch {
          return false;
        }
      })
      : [];

    const manifestJson = JSON.stringify(buildDebugInfoManifest({
      appName: app.getName(),
      appVersion: APP_VERSION,
      exportedAt,
      platform: process.platform,
      arch: process.arch,
      crashStatus,
      crashBundleNames,
    }), null, 2);
    zip.file('manifest.json', redact(manifestJson));

    for (const entry of getDebugInfoEntries(
      getAppDataPath(),
      app.getPath('crashDumps'),
      profileId,
    )) {
      await addPathToZip(zip, entry.sourcePath, entry.zipPath, redact);
    }

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    await fs.promises.writeFile(filePath, buffer);

    return {
      success: true,
      filePath,
      fileName,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to export debug info',
    };
  }
}

export function notifyDebugInfoDownload(
  targetWindow: BrowserWindow | undefined,
  result: { success: boolean; filePath?: string; fileName?: string; error?: string },
): void {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  appMainToRender.bindWebContents(targetWindow.webContents).debugInfoDownloaded(result);
}
