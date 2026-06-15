import { ipcMain } from 'electron';
import { log } from '@main/log';
import { renderToMain } from '@shared/ipc/runtime';
import { checkGitVersion, checkSystemRuntimeStatus } from './systemProbe';
import type { RuntimeManager } from './RuntimeManager';

const logger = log;

/**
 * Registers all `renderToMain` runtime IPC handlers and routes them to the
 * provided `RuntimeManager` instance. Called once from the constructor.
 *
 * Pure-orchestration handlers (logging + delegate) live here. Anything that
 * needs class state stays as a method on `RuntimeManager`.
 */
export function registerRuntimeIpcHandlers(manager: RuntimeManager): void {
  logger.debug({ msg: '[FRE] Registering runtime IPC handlers', mod: 'RuntimeManager' });

  const handle = renderToMain.bindMain(ipcMain);

  handle.setMode(async (_event, mode) => {
    logger.info({ msg: `[FRE] IPC: runtime:set-mode called`, mod: 'RuntimeManager', mode });
    await manager.setRuntimeMode(mode);
    return manager.getRunTimeConfig();
  });

  handle.installComponent(async (_event, tool, version) => {
    logger.info({ msg: `[FRE] IPC: runtime:install-component called`, mod: 'RuntimeManager', tool, version });
    const startTime = Date.now();
    try {
      await manager.installRuntime(tool, version);

      if (tool === 'bun') {
        await manager.setVersion('bun', version);
      } else {
        await manager.setVersion('uv', version);
      }

      const duration = Date.now() - startTime;
      logger.info({ msg: `[FRE] IPC: runtime:install-component completed`, mod: 'RuntimeManager', tool, version, duration });
      return { success: true };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error({ msg: `[FRE] IPC: runtime:install-component failed`, mod: 'RuntimeManager', tool, version, duration, err: error });
      throw error;
    }
  });

  handle.checkStatus(async () => {
    logger.debug({ msg: '[FRE] IPC: runtime:check-status called', mod: 'RuntimeManager' });
    const status = {
      bun: manager.isInstalled('bun'),
      uv: manager.isInstalled('uv'),
      bunPath: manager.getBinaryPath('bun'),
      uvPath: manager.getBinaryPath('uv'),
    };
    logger.debug({ msg: '[FRE] IPC: runtime:check-status result', mod: 'RuntimeManager', ...(status) });
    return status;
  });

  handle.checkSystemStatus(async () => {
    logger.debug({ msg: '[Runtime] IPC: runtime:check-system-status called', mod: 'RuntimeManager' });
    const result = await checkSystemRuntimeStatus();
    logger.debug({ msg: '[Runtime] IPC: runtime:check-system-status result', mod: 'RuntimeManager', result });
    return result;
  });

  handle.listPythonVersions(async () => {
    logger.debug({ msg: '[FRE] IPC: runtime:list-python-versions called', mod: 'RuntimeManager' });
    const versions = await manager.listPythonVersions();
    logger.debug({ msg: `[FRE] IPC: runtime:list-python-versions returned ${versions.length} versions`, mod: 'RuntimeManager' });
    return versions;
  });

  // Fast synchronous Python version scan - typically < 50ms
  // Use this for FRE and any performance-critical paths
  handle.listPythonVersionsFast(() => {
    logger.debug({ msg: '[FRE] IPC: runtime:list-python-versions-fast called', mod: 'RuntimeManager' });
    const startTime = Date.now();
    const versions = manager.listPythonVersionsFast();
    const duration = Date.now() - startTime;
    logger.debug({ msg: `[FRE] IPC: runtime:list-python-versions-fast returned ${versions.length} versions in ${duration}ms`, mod: 'RuntimeManager' });
    return versions;
  });

  handle.installPythonVersion(async (_event, version) => {
    logger.info({ msg: `[FRE] IPC: runtime:install-python-version called`, mod: 'RuntimeManager', version });
    const startTime = Date.now();
    try {
      await manager.installPythonVersion(version);
      const duration = Date.now() - startTime;
      logger.info({ msg: `[FRE] IPC: runtime:install-python-version completed`, mod: 'RuntimeManager', version, duration });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error({ msg: `[FRE] IPC: runtime:install-python-version failed`, mod: 'RuntimeManager', version, duration, err: error });
      throw error;
    }
  });

  handle.uninstallPythonVersion(async (_event, version) => {
    logger.info({ msg: `[FRE] IPC: runtime:uninstall-python-version called`, mod: 'RuntimeManager', version });
    return manager.uninstallPythonVersion(version);
  });

  handle.setPinnedPythonVersion(async (_event, version) => {
    logger.info({ msg: `[FRE] IPC: runtime:set-pinned-python-version called`, mod: 'RuntimeManager', version });
    return manager.setPinnedPythonVersion(version);
  });

  handle.cleanUvCache(async () => {
    logger.debug({ msg: '[FRE] IPC: runtime:clean-uv-cache called', mod: 'RuntimeManager' });
    return manager.cleanUvCache();
  });

  handle.checkGitVersion(async () => {
    const result = await checkGitVersion();
    logger.debug({ msg: '[FRE] IPC: runtime:check-git-version result', mod: 'RuntimeManager', ...(result) });
    return result;
  });

  logger.info({ msg: '[FRE] Runtime IPC handlers registered', mod: 'RuntimeManager' });
}
