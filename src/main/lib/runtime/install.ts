import { app } from 'electron';
import * as fs from 'fs';
import { log } from '@main/log';
import type { InternalToolType } from '@shared/types/runtimeTypes';
import { installBunDirectly, installUvDirectly } from './download';

const logger = log;

/**
 * 把某个内置工具（bun/uv）下载并解压到 `binPath`。shims 由调用方
 * （RuntimeManager.ensureToolReady）在安装成功后统一刷新。
 *
 * 直接在主进程内跑安装、而非派生子进程：打包后的 Electron 里 `process.execPath`
 * 指向 Electron 本体而非 Node 运行时，子进程方案不可靠。
 *
 * 由 RuntimeManager 在安装锁内调用，保证同一 (tool, version) 不并发安装。
 */
export async function installTool(binPath: string, tool: InternalToolType, version: string): Promise<void> {
  const startTime = Date.now();
  logger.info({
    msg: `[FRE] Starting installation of ${tool} v${version}...`,
    mod: 'RuntimeManager',
    tool,
    version,
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    binPath,
  });

  if (!fs.existsSync(binPath)) {
    fs.mkdirSync(binPath, { recursive: true });
  }

  if (tool === 'bun') {
    await installBunDirectly(binPath, version);
  } else {
    await installUvDirectly(binPath, version);
  }

  const duration = Date.now() - startTime;
  logger.info({
    msg: `[FRE] Successfully installed ${tool} v${version} in ${duration}ms`,
    mod: 'RuntimeManager',
    tool,
    version,
    duration,
  });
}
