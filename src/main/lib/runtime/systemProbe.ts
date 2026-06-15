import { log } from '@main/log';
import { getTerminalManager } from '../terminalManager';
import type {
  GitVersionInfo,
  SystemRuntimeProbe,
  SystemRuntimeStatus,
} from '@shared/types/runtimeTypes';

const logger = log;

/**
 * Check if Git is installed in the system PATH and return its version.
 *
 * Returns `{ installed: false, version: null, path: null }` for any failure
 * (no PATH match, exec error, non-zero exit). Path lookup is best-effort —
 * the version is still reported even if `which` / `where` fails.
 */
export async function checkGitVersion(): Promise<GitVersionInfo> {
  const terminalManager = getTerminalManager();

  try {
    // Try to get git version
    const versionResult = await terminalManager.executeCommand({
      command: 'git',
      args: ['--version'],
      cwd: process.cwd(),
      type: 'command',
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
      const pathResult = await terminalManager.executeCommand({
        command: whereCommand,
        args: ['git'],
        cwd: process.cwd(),
        type: 'command',
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

const SYSTEM_PROBE_TARGETS: ReadonlyArray<keyof SystemRuntimeStatus> = ['node', 'npm', 'python', 'pip', 'uv'];

/**
 * Probe the user's system PATH for the runtime-adjacent commands the app
 * relies on when `mode === 'system'`. Each probe runs `<cmd> --version` with
 * a tight timeout so a hung interpreter can't stall the settings panel, then
 * resolves the path via `which` / `where.exe`.
 *
 * The PATH used here is intentionally the user's untouched PATH (not the
 * internal-bin PATH from `getEnvWithInternalPath`), since this answers "what
 * will the system-mode spawn actually invoke?".
 */
export async function checkSystemRuntimeStatus(): Promise<SystemRuntimeStatus> {
  const probes = await Promise.all(SYSTEM_PROBE_TARGETS.map((cmd) => probeSystemCommand(cmd)));
  const result = {} as SystemRuntimeStatus;
  for (let i = 0; i < SYSTEM_PROBE_TARGETS.length; i++) {
    result[SYSTEM_PROBE_TARGETS[i]] = probes[i];
  }
  return result;
}

async function probeSystemCommand(cmd: string): Promise<SystemRuntimeProbe> {
  const terminalManager = getTerminalManager();
  const whereCommand = process.platform === 'win32' ? 'where.exe' : 'which';

  // Probe both `--version` and `which` / `where.exe` in parallel. The `which` lookup is
  // best-effort, so its result is only used if `--version` succeeds — we eat one extra
  // spawn when the command is missing in exchange for halving wall time when it isn't.
  const [versionResult, pathResult] = await Promise.allSettled([
    terminalManager.executeCommand({
      command: cmd,
      args: ['--version'],
      cwd: process.cwd(),
      type: 'command',
      timeoutMs: 5000,
    }),
    terminalManager.executeCommand({
      command: whereCommand,
      args: [cmd],
      cwd: process.cwd(),
      type: 'command',
      timeoutMs: 5000,
    }),
  ]);

  if (versionResult.status === 'rejected') {
    logger.debug({ msg: `[Runtime] system probe failed for ${cmd}`, mod: 'RuntimeManager', cmd, err: versionResult.reason });
    return { installed: false, version: null, path: null };
  }
  if (versionResult.value.exitCode !== 0) {
    return { installed: false, version: null, path: null };
  }

  const raw = `${versionResult.value.stdout}\n${versionResult.value.stderr}`.trim();
  // Python writes to stderr on older versions; npm/uv/node print to stdout.
  // Pick the first semver-ish token we recognise.
  const match = raw.match(/(\d+\.\d+\.\d+)/);
  const version = match ? match[1] : raw.split('\n')[0] || null;

  const resolvedPath = pathResult.status === 'fulfilled' && pathResult.value.exitCode === 0
    ? pathResult.value.stdout.trim().split('\n')[0] || null
    : null;

  return { installed: true, version, path: resolvedPath };
}
