import { log } from '@main/log';
import { appCacheManager } from '../appCache';
import type { RuntimeEnvironment } from '@shared/types/appConfig';
import { DEFAULT_RUNTIME_ENVIRONMENT } from '@shared/types/appConfig';
import type { InternalToolType } from '@shared/types/runtimeTypes';
import { ensureVenvMatchesPinnedPython } from './venv';

const logger = log;

/** 读取当前 RuntimeEnvironment 配置（缺失时回落到默认值副本）。 */
export function readRuntimeConfig(): RuntimeEnvironment {
  return appCacheManager.getConfig().runtimeEnvironment ?? { ...DEFAULT_RUNTIME_ENVIRONMENT };
}

/** 持久化某个内置工具（bun/uv）的版本号。 */
export async function writeToolVersion(tool: InternalToolType, version: string): Promise<void> {
  const rt = appCacheManager.getConfig().runtimeEnvironment ?? DEFAULT_RUNTIME_ENVIRONMENT;
  await appCacheManager.updateConfig({
    runtimeEnvironment: {
      ...rt,
      ...(tool === 'bun' ? { bunVersion: version } : { uvVersion: version }),
    },
  });
}

/**
 * 更新锁定的 Python 版本。版本变化时持久化，并在锁定了具体版本时按需重建 venv
 * （uv pip 拒绝在解释器版本不符的 venv 上操作）。版本未变则直接跳过。
 *
 * @param venvPath 供 ensureVenvMatchesPinnedPython 定位 {userData}/env/python-venv/。
 */
export async function applyPinnedPythonVersion(
  version: string | null,
  venvPath: string,
): Promise<void> {
  const rt = appCacheManager.getConfig().runtimeEnvironment ?? DEFAULT_RUNTIME_ENVIRONMENT;
  logger.info({
    msg: `[FRE] Setting pinned Python version`,
    mod: 'RuntimeManager',
    newVersion: version,
    oldVersion: rt.pinnedPythonVersion,
  });

  if (rt.pinnedPythonVersion === version) {
    logger.debug({ msg: `[FRE] Pinned Python version unchanged, skipping`, mod: 'RuntimeManager' });
    return;
  }

  logger.debug({ msg: `[FRE] Saving runtime config with new pinned version`, mod: 'RuntimeManager' });
  await appCacheManager.updateConfig({
    runtimeEnvironment: { ...rt, pinnedPythonVersion: version },
  });
  // 不再在此清理 uv cache：对 venv 问题无益，且 cache 大时会让 FRE 长时间卡住。
  logger.info({ msg: `[FRE] Pinned Python version set to ${version}`, mod: 'RuntimeManager' });

  if (version) {
    await ensureVenvMatchesPinnedPython(venvPath, version);
  }
}
