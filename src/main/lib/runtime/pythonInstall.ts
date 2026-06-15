import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { log } from '@main/log';
import type { PythonVersionInfo } from '@shared/types/runtimeTypes';

const logger = log;

/**
 * Get the UV Python installation directory path (cross-platform).
 *
 * UV stores managed Python installations in:
 * - Linux/macOS: ~/.local/share/uv/python/
 * - Windows: %APPDATA%\uv\python\ (Roaming, not Local!)
 */
export function getUvPythonDir(): string {
  if (process.platform === 'win32') {
    // UV uses Roaming AppData on Windows, not Local AppData
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'uv', 'python');
  }
  // Linux / macOS
  return path.join(os.homedir(), '.local', 'share', 'uv', 'python');
}

/**
 * Fast Python version discovery by directly scanning UV's Python directory.
 *
 * This is MUCH faster than `uv python list` because:
 * - No subprocess spawn overhead (~200-500ms saved)
 * - No UV startup time
 * - Pure directory scan with minimal I/O
 * - Typically completes in 1-50ms
 *
 * UV Python directory structure:
 * python/
 * ├── cpython-3.8.18-linux-x86_64
 * ├── cpython-3.9.19-macos-aarch64
 * ├── cpython-3.10.14-windows-x86_64-none
 * └── pypy-3.10.13-linux-x86_64
 *
 * The directory name itself contains: implementation-version-platform-arch
 *
 * @returns Array of installed Python versions with version, path, and status.
 */
export function listPythonVersionsFast(): PythonVersionInfo[] {
  const startTime = Date.now();
  const uvPythonDir = getUvPythonDir();

  logger.debug({ msg: `[FRE][python] Fast scanning UV Python directory: ${uvPythonDir}`, mod: 'RuntimeManager' });

  if (!fs.existsSync(uvPythonDir)) {
    logger.debug({ msg: `[FRE][python] UV Python directory does not exist`, mod: 'RuntimeManager' });
    return [];
  }

  // Regex to parse directory names like "cpython-3.10.14-macos-aarch64" or "cpython-3.12.8-windows-x86_64-none"
  const versionPattern = /^(cpython|pypy)-(\d+\.\d+\.\d+)/;

  try {
    // Use fs.readdirSync for maximum speed - avoid async overhead for small directory listing
    const entries = fs.readdirSync(uvPythonDir, { withFileTypes: true });
    const results: PythonVersionInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const match = versionPattern.exec(entry.name);
      if (match) {
        const impl = match[1];  // cpython or pypy
        const semver = match[2]; // 3.10.14
        const fullPath = path.join(uvPythonDir, entry.name);

        // Verify the Python executable exists
        const exeName = process.platform === 'win32' ? 'python.exe' : 'python';
        const exePath = process.platform === 'win32'
          ? path.join(fullPath, exeName)
          : path.join(fullPath, 'bin', exeName);

        // Only include if executable exists (quick stat check)
        if (fs.existsSync(exePath)) {
          results.push({
            version: entry.name,  // Full directory name for compatibility
            path: exePath,
            status: 'installed',
            impl,
            semver,
          });
        }
      }
    }

    const duration = Date.now() - startTime;
    logger.info({ msg: `[FRE][python] Fast scan completed in ${duration}ms, found ${results.length} Python versions`, mod: 'RuntimeManager' });

    return results;
  } catch (e) {
    logger.error({ msg: '[FRE][python] Error during fast Python scan', mod: 'RuntimeManager', err: e });
    return [];
  }
}

export interface UvSpawnContext {
  /** Absolute path to the `uv` binary in `{userData}/bin/`. */
  uvPath: string;
  /** Environment derived from `getEnvWithInternalPath()`. */
  env: NodeJS.ProcessEnv;
}

/**
 * Run `uv python install <version>` directly with logging. Caller is
 * responsible for the install lock and any LocalPythonMirror lifecycle.
 */
export async function doInstallPythonVersion(ctx: UvSpawnContext, version: string): Promise<void> {
  const startTime = Date.now();
  const uvExists = fs.existsSync(ctx.uvPath);

  // Check file stats for better diagnostics
  let fileStats: fs.Stats | null = null;
  if (uvExists) {
    try {
      fileStats = fs.statSync(ctx.uvPath);
    } catch (e) {
      logger.warn({ msg: `[FRE][python][${new Date().toISOString()}] Could not stat uv binary`, mod: 'RuntimeManager', err: e });
    }
  }

  logger.debug({ msg: `[FRE][python][${new Date().toISOString()}] uv binary path resolved`, mod: 'RuntimeManager', uvPath: ctx.uvPath, exists: uvExists, mode: fileStats?.mode?.toString(8), size: fileStats?.size, isFile: fileStats?.isFile() });

  if (!uvExists) {
    logger.error({ msg: `[FRE][python][${new Date().toISOString()}] uv binary not found at expected path`, mod: 'RuntimeManager', uvPath: ctx.uvPath });
    throw new Error(`uv binary not found at ${ctx.uvPath}`);
  }

  // Ensure executable permissions on macOS/Linux
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(ctx.uvPath, 0o755);
      logger.debug({ msg: `[FRE][python][${new Date().toISOString()}] Ensured executable permissions on uv binary`, mod: 'RuntimeManager' });
    } catch (e) {
      logger.warn({ msg: `[FRE][python][${new Date().toISOString()}] Could not set executable permissions on uv binary`, mod: 'RuntimeManager', err: e });
    }
  }

  logger.debug({ msg: `[FRE][python][${new Date().toISOString()}] Environment prepared for uv python install`, mod: 'RuntimeManager', PATH: ctx.env['PATH']?.substring(0, 200) + '...', UV_PYTHON: ctx.env['UV_PYTHON'] });

  const args = ['python', 'install', version];
  logger.info({ msg: `[FRE][python][${new Date().toISOString()}] Spawning: ${ctx.uvPath} ${args.join(' ')}`, mod: 'RuntimeManager' });

  const { promise, resolve, reject } = Promise.withResolvers<void>();

  let stdoutData = '';
  let stderrData = '';
  let hasExited = false;

  const child = spawn(ctx.uvPath, args, {
    env: ctx.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  logger.debug({ msg: `[FRE][python][${new Date().toISOString()}] Python install process spawned`, mod: 'RuntimeManager', pid: child.pid });

  child.stdout.on('data', d => {
    const msg = d.toString();
    stdoutData += msg;
    logger.debug({ msg: `[FRE][python][${new Date().toISOString()}][uv python install stdout] ${msg.trim()}`, mod: 'RuntimeManager' });
  });

  child.stderr.on('data', d => {
    const msg = d.toString();
    stderrData += msg;
    // uv usually prints progress to stderr
    logger.info({ msg: `[FRE][python][${new Date().toISOString()}][uv python install stderr] ${msg.trim()}`, mod: 'RuntimeManager' });
  });

  child.on('error', (err) => {
    if (hasExited) return;
    hasExited = true;
    const duration = Date.now() - startTime;
    logger.error({ msg: `[FRE][python][${new Date().toISOString()}] Failed to spawn uv python install process`, mod: 'RuntimeManager', err, errorCode: (err as NodeJS.ErrnoException).code, duration, version });
    reject(err);
  });

  child.on('close', (code, signal) => {
    if (hasExited) return;
    hasExited = true;
    const duration = Date.now() - startTime;
    logger.info({ msg: `[FRE][python][${new Date().toISOString()}] uv python install process exited`, mod: 'RuntimeManager', code, signal, duration, version, stdoutLength: stdoutData.length, stderrLength: stderrData.length, stdout: stdoutData.substring(0, 500), stderr: stderrData.substring(0, 500) });

    if (code === 0) {
      logger.info({ msg: `[FRE][python][${new Date().toISOString()}] Python ${version} installed successfully in ${duration}ms`, mod: 'RuntimeManager' });
      resolve();
    } else if (signal) {
      // Process was terminated by a signal (e.g., SIGTERM, SIGKILL)
      logger.error({ msg: `[FRE][python][${new Date().toISOString()}] uv python install was terminated by signal`, mod: 'RuntimeManager', signal, stdout: stdoutData.substring(0, 1000), stderr: stderrData.substring(0, 1000) });
      reject(new Error(`uv python install was terminated by signal ${signal}. stderr: ${stderrData.substring(0, 500)}`));
    } else if (code === null) {
      // code is null but no signal - this is unusual, might be a spawn issue
      logger.error({ msg: `[FRE][python][${new Date().toISOString()}] uv python install exited with null code`, mod: 'RuntimeManager', stdout: stdoutData.substring(0, 1000), stderr: stderrData.substring(0, 1000) });
      reject(new Error(`uv python install exited unexpectedly. stderr: ${stderrData.substring(0, 500)}`));
    } else {
      logger.error({ msg: `[FRE][python][${new Date().toISOString()}] uv python install failed`, mod: 'RuntimeManager', code, stdout: stdoutData.substring(0, 1000), stderr: stderrData.substring(0, 1000) });
      reject(new Error(`uv python install failed with code ${code}. stderr: ${stderrData.substring(0, 500)}`));
    }
  });

  return promise;
}

/**
 * Run `uv python uninstall <version>`. Caller is responsible for clearing the
 * pinned-Python config if the version being removed matches.
 */
export async function doUninstallPythonVersion(ctx: UvSpawnContext, version: string): Promise<void> {
  logger.info({ msg: `Uninstalling python version ${version} via uv...` });

  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const child = spawn(ctx.uvPath, ['python', 'uninstall', version], {
    env: ctx.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', d => logger.debug({ msg: `[uv python uninstall] ${d}` }));
  child.stderr.on('data', d => logger.info({ msg: `[uv python uninstall] ${d}` }));

  child.on('close', code => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(`uv python uninstall failed with code ${code}`));
    }
  });

  return promise;
}

/**
 * Run `uv cache clean`. Always resolves — even on non-zero exit / spawn error,
 * we log the failure but resolve so the user-facing flow does not block on a
 * cache-cleanup hiccup.
 */
export async function doCleanUvCache(ctx: UvSpawnContext): Promise<void> {
  const startTime = Date.now();
  logger.info({ msg: '[FRE] Cleaning uv cache to prevent environment conflicts...', mod: 'RuntimeManager', uvPath: ctx.uvPath });

  const { promise, resolve } = Promise.withResolvers<void>();

  let stdoutData = '';
  let stderrData = '';

  const child = spawn(ctx.uvPath, ['cache', 'clean'], {
    env: ctx.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  logger.debug({ msg: '[FRE] uv cache clean process spawned', mod: 'RuntimeManager', pid: child.pid });

  child.stdout.on('data', d => {
    const msg = d.toString();
    stdoutData += msg;
    logger.debug({ msg: `[FRE][uv cache clean stdout] ${msg.trim()}`, mod: 'RuntimeManager' });
  });

  child.stderr.on('data', d => {
    const msg = d.toString();
    stderrData += msg;
    logger.warn({ msg: `[FRE][uv cache clean stderr] ${msg.trim()}`, mod: 'RuntimeManager' });
  });

  child.on('close', code => {
    const duration = Date.now() - startTime;
    logger.info({ msg: '[FRE] uv cache clean process exited', mod: 'RuntimeManager', code, duration });

    // We don't strictly fail if cache clean issues warning, but let's log it
    if (code === 0) {
      logger.info({ msg: `[FRE] uv cache cleaned successfully in ${duration}ms`, mod: 'RuntimeManager' });
    } else {
      logger.warn({ msg: `[FRE] uv cache clean exited with code ${code}`, mod: 'RuntimeManager', stdout: stdoutData.substring(0, 500), stderr: stderrData.substring(0, 500) });
    }
    resolve(); // Resolve regardless to not block user
  });

  child.on('error', err => {
    const duration = Date.now() - startTime;
    logger.error({ msg: '[FRE] Failed to run uv cache clean', mod: 'RuntimeManager', err, duration });
    resolve(); // Resolve anyway
  });

  return promise;
}
