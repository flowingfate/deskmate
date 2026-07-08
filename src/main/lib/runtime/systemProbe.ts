import { terminalManager } from '../terminal'
import type { GitVersionInfo } from '@shared/types/runtimeTypes';

/**
 * Check if Git is installed in the system PATH and return its version.
 *
 * Returns `{ installed: false, version: null, path: null }` for any failure
 * (no PATH match, exec error, non-zero exit). Path lookup is best-effort —
 * the version is still reported even if `which` / `where` fails.
 */
export async function checkGitVersion(): Promise<GitVersionInfo> {
  try {
    // Try to get git version
    const versionResult = await terminalManager.run({
      command: 'git',
      args: ['--version'],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    if (versionResult.exitCode !== 0) {
      return { installed: false, version: null, path: null };
    }

    const versionOutput = versionResult.stdout.trim();

    // Extract version number from "git version X.XX.X..."
    const versionMatch = versionOutput.match(/git version (\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : versionOutput.replace('git version ', '');

    // Try to get git path
    let gitPath: string | null = null;
    try {
      // On Windows, use where.exe explicitly (not 'where' which is a PowerShell alias for Where-Object)
      const whereCommand = process.platform === 'win32' ? 'where.exe' : 'which';
      const pathResult = await terminalManager.run({
        command: whereCommand,
        args: ['git'],
        cwd: process.cwd(),
        timeoutMs: 5000,
      });

      if (pathResult.exitCode === 0) {
        gitPath = pathResult.stdout.trim().split('\n')[0]; // Get first result if multiple
      }
    } catch {
      // Path lookup failed, but git is still installed
    }

    return { installed: true, version, path: gitPath };
  } catch {
    return { installed: false, version: null, path: null };
  }
}
