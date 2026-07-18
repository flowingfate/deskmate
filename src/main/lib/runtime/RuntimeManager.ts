import * as path from 'path';
import * as fs from 'fs';
import { log } from '@main/log';
import type { RuntimeEnvironment } from '@shared/types/appConfig';
import type { InternalToolType, PythonVersionInfo } from '@shared/types/runtimeTypes';
import {
  getBinDir,
  getPythonVenvDir,
  getUvCacheDir,
  getUvToolDir,
  getUvPythonInstallDir,
  getBunInstallDir,
  getRuntimeBinDir,
} from '@main/persist/lib/path';
import { ensureShims } from './shim';
import { InstallLockMap } from './lock';
import { ensureVenvMatchesPinnedPython } from './venv';
import {
  listPythonVersionsFast,
  doInstallPythonVersion,
  doUninstallPythonVersion,
  doCleanUvCache,
  type UvSpawnContext,
} from './pythonInstall';
import { detectRuntimeNeed } from './commandClassifier';
import { buildInternalEnv, applyManagedRuntimeDirs, type ManagedRuntimeDirs } from './internalEnv';
import { installTool } from './install';
import { readRuntimeConfig, writeToolVersion, applyPinnedPythonVersion } from './runtimeConfig';

const logger = log;

export type { InternalToolType };

/**
 * 内置运行时（bun / uv / Python）的协调者。单例。
 *
 * 只持有三块真正需要跨调用共享的状态：安装路径、安装锁、以及惰性安装的
 * 去重 promise 缓存。所有无状态的重活（命令分类、环境构建、下载安装、配置读写）
 * 都下沉到同目录的纯函数模块，类本身只做编排。
 *
 * 安装模型是「惰性」的：boot 时不下载任何东西，第一次真正 spawn 需要某工具的
 * MCP transport 时才按需安装（见 {@link ensureRuntimeForCommand}）。
 */
export class RuntimeManager {
  private static instance: RuntimeManager;

  private readonly binPath: string;
  private readonly venvPath: string;

  /** 防止同一组件并发安装。 */
  private readonly installLocks = new InstallLockMap();

  /**
   * 惰性安装的去重缓存：合并同一工具的并发首次 spawn 请求。
   * 由 ensureRuntimeForCommand() 填充，boot 时不 await。
   */
  private readonly toolReadyPromises: Map<InternalToolType, Promise<void>> = new Map();

  private constructor() {
    this.binPath = getBinDir();
    this.venvPath = getPythonVenvDir();
    logger.info({ msg: `Initialized. Bin path: ${this.binPath}, Venv path: ${this.venvPath}` });
    this.initializeInternalMode();
  }

  public static getInstance(): RuntimeManager {
    return RuntimeManager.instance ??= new RuntimeManager();
  }

  // --- 配置 ---

  public getRunTimeConfig(): RuntimeEnvironment {
    return readRuntimeConfig();
  }

  /** 持久化某个内置工具的版本号。 */
  public setVersion(tool: InternalToolType, version: string): Promise<void> {
    return writeToolVersion(tool, version);
  }

  /** 更新锁定的 Python 版本，必要时重建 venv。 */
  public setPinnedPythonVersion(version: string | null): Promise<void> {
    return applyPinnedPythonVersion(version, this.venvPath);
  }

  /**
   * Python 虚拟环境目录的绝对路径，位于 {userData}/env/python-venv/。
   *
   * 刻意不放在 process.cwd()/.venv：打包后 cwd 在 macOS 是 "/"、Windows 是
   * "C:\Windows\System32"，均不可写；而 userData 恒可写。managedRuntimeDirs()
   * 会把它经 applyManagedRuntimeDirs 写入 VIRTUAL_ENV，令 uv/python 及子进程无视 cwd 都能发现该 venv。
   */
  public getVenvPath(): string {
    return this.venvPath;
  }

  // --- 惰性安装 ---

  /**
   * 按命令惰性确保所需运行时就绪。由 TerminalInstance.prepareEnvironment 在
   * spawn MCP transport 前调用
   *
   * - JS 命令 → 确保 bun 就绪；Python 命令 → 确保 uv 就绪 + venv ready；其它 → noop。
   * - 同一工具的并发调用复用同一 in-flight promise。
   * - 失败会记录并抛出，同时丢弃缓存，使下次 spawn 可重试。
   */
  public async ensureRuntimeForCommand(command: string, args: readonly string[] = []): Promise<void> {
    const need = detectRuntimeNeed(command, args);
    if (need) {
      await this.ensureToolReady(need);
    }
  }

  private async ensureToolReady(tool: InternalToolType): Promise<void> {
    if (this.isInstalled(tool)) {
      // 已安装 —— 只做一次廉价的幂等 shim 校验，uv 额外对齐锁定的 Python。
      ensureShims(this.binPath);
      await this.ensurePinnedVenv(tool);
      return;
    }

    const inflight = this.toolReadyPromises.get(tool);
    if (inflight) {
      return inflight;
    }

    const rt = this.getRunTimeConfig();
    const version = tool === 'bun' ? rt.bunVersion : rt.uvVersion;
    logger.info({
      msg: `[Runtime] Lazy-installing ${tool} v${version} on demand (first MCP request)`,
      mod: 'RuntimeManager',
      tool,
      version,
    });

    const promise = (async () => {
      try {
        await this.installRuntime(tool, version);
        ensureShims(this.binPath, true, tool);
        await this.ensurePinnedVenv(tool);
        logger.info({ msg: `[Runtime] ${tool} ready`, mod: 'RuntimeManager', tool });
      } catch (err) {
        logger.error({ msg: `[Runtime] Lazy install of ${tool} failed`, mod: 'RuntimeManager', tool, err });
        // 丢弃缓存，让下次 spawn 重试，而非拿到一个已失败的 promise。
        this.toolReadyPromises.delete(tool);
        throw err;
      }
    })();

    this.toolReadyPromises.set(tool, promise);
    return promise;
  }

  /** uv 就绪后，若用户锁定了 Python 版本则确保 venv 与之匹配。 */
  private async ensurePinnedVenv(tool: InternalToolType): Promise<void> {
    if (tool !== 'uv') return;
    const pinned = this.getRunTimeConfig().pinnedPythonVersion;
    if (pinned) {
      await ensureVenvMatchesPinnedPython(this.venvPath, pinned);
    }
  }

  // --- 路径与环境 ---

  public getBinaryPath(tool: InternalToolType): string {
    const isWin = process.platform === 'win32';
    const exe = tool === 'bun' ? 'bun' : 'uv';
    return path.join(this.binPath, isWin ? `${exe}.exe` : exe);
  }

  public isInstalled(tool: InternalToolType): boolean {
    return fs.existsSync(this.getBinaryPath(tool));
  }

  /**
   * 内置模式初始化（惰性安装模型）：创建 bin 目录，并为「已安装」的工具刷新 shims。
   *
   * 刻意不在此下载 bun / uv / Python —— 未配置任何 MCP 的新用户 boot 期零安装成本。
   * 首次 MCP transport spawn 会走 ensureRuntimeForCommand() 按需安装。
   * Settings → Runtime 仍提供显式 Install 按钮供想预装的用户使用。
   */
  public initializeInternalMode(): void {
    logger.info({ msg: 'Initializing internal mode (lazy install)', mod: 'RuntimeManager' });

    if (!fs.existsSync(this.binPath)) {
      fs.mkdirSync(this.binPath, { recursive: true });
      logger.info({ msg: `Created bin directory: ${this.binPath}`, mod: 'RuntimeManager' });
    }

    // 刷新 shims，让上次运行已安装的工具能通过 {userData}/env/bin 解析到。
    ensureShims(this.binPath, true);
    logger.debug({ msg: 'Internal mode initialization completed (no eager install)', mod: 'RuntimeManager' });
  }

  /** 在给定 base 环境上叠加内置 bin 路径与运行时相关变量（PATH 前插 + managed dir 环境变量）。 */
  public getEnvWithInternalPath(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    // 每次使用内置环境时确保 shims 存在。
    ensureShims(this.binPath);
    const env = buildInternalEnv(baseEnv, this.binPath);
    // 路径 A（设置页按钮）：与路径 B（terminalBridge）共用同一「喂目录变量」实现，杜绝只改一边。
    applyManagedRuntimeDirs(env, this.managedRuntimeDirs());
    return env;
  }

  /** 组装自带运行时的 managed dir 集合（供 A/B 两路的 applyManagedRuntimeDirs 共用）。 */
  public managedRuntimeDirs(): ManagedRuntimeDirs {
    return {
      uvCacheDir: getUvCacheDir(),
      uvToolDir: getUvToolDir(),
      uvPythonInstallDir: getUvPythonInstallDir(),
      bunInstallDir: getBunInstallDir(),
      runtimeBinDir: getRuntimeBinDir(),
      venvPath: this.venvPath,
      pinnedPythonVersion: this.getRunTimeConfig().pinnedPythonVersion,
    };
  }

  // --- 安装 ---

  /** 在安装锁下安装某个内置工具（同一 tool+version 并发调用复用一次安装）。 */
  public installRuntime(tool: InternalToolType, version: string): Promise<void> {
    const lockKey = `${tool}-${version}`;
    const existing = this.installLocks.get(lockKey);
    if (existing) {
      logger.info({ msg: `[FRE] ${tool} v${version} installation already in progress, waiting for it to complete...`, mod: 'RuntimeManager' });
      return existing;
    }
    return this.installLocks.run(lockKey, () => installTool(this.binPath, tool, version));
  }

  // --- Python 管理 ---

  public listPythonVersionsFast(): PythonVersionInfo[] {
    return listPythonVersionsFast();
  }

  /** 列出已安装的 Python 版本（快速目录扫描，通常 < 50ms，不 spawn 子进程）。 */
  public async listPythonVersions(): Promise<PythonVersionInfo[]> {
    return listPythonVersionsFast();
  }

  public async installPythonVersion(version: string): Promise<void> {
    const lockKey = `python-${version}`;
    const existing = this.installLocks.get(lockKey);
    if (existing) {
      logger.info({ msg: `[FRE] Python ${version} installation already in progress, waiting for it to complete...`, mod: 'RuntimeManager' });
      return existing;
    }

    if (!this.isInstalled('uv')) {
      logger.error({ msg: `[FRE][python] Cannot install Python: uv is not installed`, mod: 'RuntimeManager' });
      throw new Error('uv is not installed');
    }

    return this.installLocks.run(lockKey, () => doInstallPythonVersion(this.uvContext(), version));
  }

  public async uninstallPythonVersion(version: string): Promise<void> {
    if (!this.isInstalled('uv')) {
      throw new Error('uv is not installed');
    }

    // 若卸载的是锁定版本，先解除锁定。pinnedPythonVersion 可能存为短 semver
    // ("3.10.12")，而 version 是 uv 目录全名 ("cpython-3.10.12-macos-aarch64-none")，两种形态都比对。
    const pinned = this.getRunTimeConfig().pinnedPythonVersion;
    const versionSemver = version.match(/^(?:cpython|pypy)-(\d+\.\d+\.\d+)/)?.[1] ?? null;
    if (pinned && (pinned === version || (versionSemver && pinned === versionSemver))) {
      await this.setPinnedPythonVersion(null);
    }

    return doUninstallPythonVersion(this.uvContext(), version);
  }

  public async cleanUvCache(): Promise<void> {
    logger.info({ msg: '[FRE] cleanUvCache called', mod: 'RuntimeManager', uvInstalled: this.isInstalled('uv') });
    if (!this.isInstalled('uv')) {
      logger.debug({ msg: '[FRE] uv not installed, skipping cache clean', mod: 'RuntimeManager' });
      return;
    }
    return doCleanUvCache(this.uvContext());
  }

  /** 构造 uv 子命令所需的 spawn 上下文（uv 路径 + 内置环境）。 */
  private uvContext(): UvSpawnContext {
    return { uvPath: this.getBinaryPath('uv'), env: this.getEnvWithInternalPath() };
  }
}
