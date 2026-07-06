import * as fs from 'fs';
import * as path from 'path';
import { log } from '@main/log';
import { terminalManager } from '../terminal'

const logger = log;

/**
 * Ensure the Python venv at `venvDir` matches the pinned Python version.
 *
 * Reads `<venvDir>/pyvenv.cfg` to extract `version_info` (e.g. "3.10"). If it
 * doesn't match the pinned version's major.minor (e.g. "3.12"), deletes the
 * stale venv and recreates it with `uv venv --python <version> <venvDir>`.
 *
 * This prevents `uv pip install` from failing with:
 *   "No virtual environment found for cpython-X.Y.Z-..."
 *
 * Called by `setPinnedPythonVersion()` when the version changes and by the
 * lazy install path when the user has a pinned Python.
 *
 * Environment compatibility:
 *   The venv lives in `{userData}/env/python-venv/`, which is always writable in
 *   both dev and packaged (production) environments on macOS and Windows. This
 *   eliminates the need for `process.cwd()` writability checks.
 *
 * Version comparison:
 *   Only major.minor is compared (e.g. "3.12"). Patch-level differences
 *   (3.12.8 → 3.12.9) produce compatible venvs and do NOT trigger rebuild.
 */
export async function ensureVenvMatchesPinnedPython(venvDir: string, pinnedVersion: string): Promise<void> {
  const pyvenvCfg = path.join(venvDir, 'pyvenv.cfg');

  // Extract semver from pinned version (handles both "3.12.9" and "cpython-3.12.9-..." formats)
  const semverMatch = pinnedVersion.match(/(\d+\.\d+\.\d+)/);
  if (!semverMatch) {
    logger.warn({ msg: `[FRE] Cannot parse semver from pinned version "${pinnedVersion}", skipping venv check`, mod: 'RuntimeManager' });
    return;
  }
  const pinnedSemver = semverMatch[1]; // e.g. "3.12.9"
  // Compare major.minor only (patch difference is OK, venv is compatible)
  const pinnedMajorMinor = pinnedSemver.split('.').slice(0, 2).join('.'); // e.g. "3.12"

  // Read current venv's Python version from pyvenv.cfg
  let venvVersion: string | null = null;
  try {
    if (fs.existsSync(pyvenvCfg)) {
      const content = fs.readFileSync(pyvenvCfg, 'utf-8');
      const match = content.match(/version_info\s*=\s*(\d+\.\d+)/);
      if (match) {
        venvVersion = match[1]; // e.g. "3.10"
      }
    }
  } catch (err) {
    logger.warn({ msg: `[FRE] Failed to read pyvenv.cfg: ${err instanceof Error ? err.message : String(err)}`, mod: 'RuntimeManager' });
  }

  // If no venv exists, proactively create one
  if (!fs.existsSync(venvDir)) {
    logger.debug({ msg: '[FRE] No python-venv directory found, creating for pinned version', mod: 'RuntimeManager' });
    await recreateVenv(venvDir, pinnedVersion);
    return;
  }

  if (venvVersion === pinnedMajorMinor) {
    logger.debug({ msg: `[FRE] python-venv Python version (${venvVersion}) matches pinned (${pinnedMajorMinor}), no rebuild needed`, mod: 'RuntimeManager' });
    return;
  }

  // Version mismatch — rebuild
  logger.info({ msg: `[FRE] python-venv Python version mismatch: venv=${venvVersion || 'unknown'}, pinned=${pinnedMajorMinor}. Rebuilding...`, mod: 'RuntimeManager' });

  await recreateVenv(venvDir, pinnedVersion);
}

/**
 * Delete the venv at `venvDir` and recreate it with
 * `uv venv --python <version> <venvDir>`.
 *
 * No writability check is needed because `{userData}` is always writable.
 */
async function recreateVenv(venvDir: string, pythonVersion: string): Promise<void> {
  // Remove old venv
  try {
    if (fs.existsSync(venvDir)) {
      fs.rmSync(venvDir, { recursive: true, force: true });
      logger.info({ msg: '[FRE] Deleted stale python-venv directory', mod: 'RuntimeManager' });
    }
  } catch (err) {
    logger.error({ msg: `[FRE] Failed to delete python-venv: ${err instanceof Error ? err.message : String(err)}`, mod: 'RuntimeManager' });
    return;
  }

  // Recreate venv using uv — explicitly specify the venv path so uv doesn't
  // rely on cwd-based discovery. This works in both dev and packaged environments.
  try {
    const result = await terminalManager.run({
      command: 'uv',
      args: ['venv', '--python', pythonVersion, venvDir],
      cwd: path.dirname(venvDir),
      timeoutMs: 60_000,
    });

    if (result.exitCode === 0) {
      logger.info({ msg: `[FRE] python-venv created at ${venvDir} with Python ${pythonVersion}`, mod: 'RuntimeManager' });
    } else {
      logger.error({ msg: `[FRE] Failed to create python-venv (exit code ${result.exitCode}): ${result.stderr.substring(0, 300)}`, mod: 'RuntimeManager' });
    }
  } catch (err) {
    logger.error({ msg: `[FRE] Error creating python-venv: ${err instanceof Error ? err.message : String(err)}`, mod: 'RuntimeManager' });
  }
}
