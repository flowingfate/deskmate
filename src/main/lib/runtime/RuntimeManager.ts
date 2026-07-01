import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { log } from '@main/log';
import { LocalPythonMirror } from './LocalPythonMirror';
import { appCacheManager } from '../appCache';
import type { RuntimeEnvironment } from '@shared/types/appConfig';
import { DEFAULT_RUNTIME_ENVIRONMENT } from '@shared/types/appConfig';
import { getTerminalManager } from '../terminalManager';
import { ensureShims } from './shim';
import { InstallLockMap } from './lock';
import { ensureVenvMatchesPinnedPython } from './venv';
import { installBunDirectly, installUvDirectly } from './download';
import { registerRuntimeIpcHandlers } from './ipc';
import {
  listPythonVersionsFast,
  doInstallPythonVersion,
  doUninstallPythonVersion,
  doCleanUvCache,
  type UvSpawnContext,
} from './pythonInstall';
import type { PythonVersionInfo } from '@shared/types/runtimeTypes';
import { getBinDir, getPythonVenvDir } from '@main/persist/lib/path';

const logger = log;

export type InternalToolType = 'bun' | 'uv';

export class RuntimeManager {
  private static instance: RuntimeManager;
  private binPath: string;
  private venvPath: string;
  // Installation locks to prevent concurrent installations of the same component
  private installLocks = new InstallLockMap();

  // Lazy install — coalesces concurrent first-spawn requests for the same tool.
  // Populated by ensureRuntimeForCommand(); not awaited at boot.
  private toolReadyPromises: Map<InternalToolType, Promise<void>> = new Map();

  private constructor() {
    this.binPath = getBinDir();
    this.venvPath = getPythonVenvDir();

    logger.info({ msg: `Initialized. Bin path: ${this.binPath}, Venv path: ${this.venvPath}` });

    // Register IPC handlers
    registerRuntimeIpcHandlers(this);

    // Initialize internal mode if configured (check and repair shims)
    this.initializeInternalMode();

  }

  public static getInstance(): RuntimeManager {
    if (!RuntimeManager.instance) {
      RuntimeManager.instance = new RuntimeManager();
    }
    return RuntimeManager.instance;
  }

  // --- Configuration Management ---

  /**
   * Returns the current RuntimeEnvironment configuration (read from AppCacheManager).
   */
  public getRunTimeConfig(): RuntimeEnvironment {
    return appCacheManager.getConfig().runtimeEnvironment ?? { ...DEFAULT_RUNTIME_ENVIRONMENT };
  }
  /**
   * Lazy ensure the runtime needed for a given command is installed.
   *
   * Called by TerminalInstance.prepareEnvironment before spawning MCP transports.
   * Replaces the old eager install-at-boot model: instead of downloading bun + uv
   * during FRE, we wait until the user actually configures an MCP that needs them.
   *
   * - System mode → noop. The user owns runtimes; we never install.
   * - JS commands (node/npm/npx/bun)        → ensure `bun` is installed.
   * - Python commands (python/pip/uv/uvx …) → ensure `uv` is installed + venv ready.
   * - Anything else → noop. We don't speculatively install for unknown commands.
   *
   * Concurrent calls for the same tool reuse the in-flight install promise.
   * Failures are logged and rethrown; cached promise is dropped so a retry can
   * be attempted on the next spawn.
   */
  public async ensureRuntimeForCommand(command: string, args: readonly string[] = []): Promise<void> {

    const need = this.detectRuntimeNeed(command, args);
    if (!need) {
      return;
    }

    await this.ensureToolReady(need);
  }

  private detectRuntimeNeed(command: string, args: readonly string[]): InternalToolType | null {
    const norm = (s: string): string => path.basename(s).toLowerCase().replace(/\.(exe|cmd)$/, '');

    const isJsCommand = (s: string): boolean => {
      const n = norm(s);
      return n === 'node' || n === 'npm' || n === 'npx' || n === 'bun';
    };
    const isPyCommand = (s: string): boolean => {
      const n = norm(s);
      return n === 'python' || n === 'python3' || n === 'pip' || n === 'pip3' || n === 'uv' || n === 'uvx';
    };

    if (isJsCommand(command)) return 'bun';
    if (isPyCommand(command)) return 'uv';

    // Windows: `cmd /c <real-command> ...`
    const cmdNorm = norm(command);
    if ((cmdNorm === 'cmd') && args.length >= 2 && args[0].toLowerCase() === '/c') {
      if (isJsCommand(args[1])) return 'bun';
      if (isPyCommand(args[1])) return 'uv';
    }
    return null;
  }

  private async ensureToolReady(tool: InternalToolType): Promise<void> {
    if (this.isInstalled(tool)) {
      // Tool is present — just verify shims are wired (cheap idempotent op).
      ensureShims(this.binPath);
      if (tool === 'uv') {
        const pinned = this.getRunTimeConfig().pinnedPythonVersion;
        if (pinned) {
          await ensureVenvMatchesPinnedPython(this.venvPath, pinned);
        }
      }
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
        ensureShims(this.binPath, true);
        if (tool === 'uv') {
          const pinned = this.getRunTimeConfig().pinnedPythonVersion;
          if (pinned) {
            await ensureVenvMatchesPinnedPython(this.venvPath, pinned);
          }
        }
        logger.info({ msg: `[Runtime] ${tool} ready`, mod: 'RuntimeManager', tool });
      } catch (err) {
        logger.error({ msg: `[Runtime] Lazy install of ${tool} failed`, mod: 'RuntimeManager', tool, err });
        // Drop cache so the next spawn retries instead of resolving to a failed install.
        this.toolReadyPromises.delete(tool);
        throw err;
      }
    })();

    this.toolReadyPromises.set(tool, promise);
    return promise;
  }


  public async setVersion(tool: InternalToolType, version: string): Promise<void> {
    const current = appCacheManager.getConfig();
    const rt = current.runtimeEnvironment ?? DEFAULT_RUNTIME_ENVIRONMENT;
    await appCacheManager.updateConfig({
      runtimeEnvironment: {
        ...rt,
        ...(tool === 'bun' ? { bunVersion: version } : { uvVersion: version }),
      },
    });
  }

  public async setPinnedPythonVersion(version: string | null): Promise<void> {
    const current = appCacheManager.getConfig();
    const rt = current.runtimeEnvironment ?? DEFAULT_RUNTIME_ENVIRONMENT;
    logger.info({ msg: `[FRE] Setting pinned Python version`, mod: 'RuntimeManager', newVersion: version, oldVersion: rt.pinnedPythonVersion });

    if (rt.pinnedPythonVersion !== version) {
      logger.debug({ msg: `[FRE] Saving runtime config with new pinned version`, mod: 'RuntimeManager' });
      await appCacheManager.updateConfig({
        runtimeEnvironment: {
          ...rt,
          pinnedPythonVersion: version,
        },
      });
      // Note: We no longer clean uv cache here as it doesn't help with venv issues
      // and can cause FRE to hang for a long time if cache is large
      logger.info({ msg: `[FRE] Pinned Python version set to ${version}`, mod: 'RuntimeManager' });

      // Auto-rebuild .venv if the existing venv's Python version doesn't match.
      // uv pip refuses to operate when the venv was created with a different Python.
      if (version) {
        await ensureVenvMatchesPinnedPython(this.venvPath, version);
      }
    } else {
      logger.debug({ msg: `[FRE] Pinned Python version unchanged, skipping`, mod: 'RuntimeManager' });
    }
  }

  /**
   * Returns the absolute path to the Python virtual environment directory.
   *
   * The venv lives under {userData}/python-venv/ (e.g.
   * ~/.deskmate/python-venv/ on macOS).
   *
   * This is deliberately NOT in process.cwd()/.venv because:
   *   - process.cwd() is "/" on packaged macOS apps and "C:\Windows\System32"
   *     on packaged Windows apps — both are not writable.
   *   - app.getPath('userData') is always writable, in both dev and production.
   *   - Other app-managed resources (native modules, playwright profiles)
   *     already live under userData.
   *
   * The VIRTUAL_ENV environment variable is set in getEnvWithInternalPath()
   * so that `uv pip install`, `python`, and any subprocess automatically
   * discover this venv regardless of their working directory.
   */
  public getVenvPath(): string {
    return this.venvPath;
  }


  // --- Path & Environment ---

  public getBinaryPath(tool: InternalToolType): string {
    const isWin = process.platform === 'win32';

    if (tool === 'bun') {
      return path.join(this.binPath, isWin ? 'bun.exe' : 'bun');
    } else {
      // uv usually installs 'uv' and 'uvx'. We return the path to the executable.
      return path.join(this.binPath, isWin ? 'uv.exe' : 'uv');
    }
  }

  public isInstalled(tool: InternalToolType): boolean {
      const binPath = this.getBinaryPath(tool);
      return fs.existsSync(binPath);
  }

  /**
   * ============================================================================
   * INTERNAL MODE INITIALIZATION (lazy-install model)
   * ============================================================================
   *
   * Called automatically when RuntimeManager is instantiated and mode is 'internal'.
   *
   * INITIALIZATION FLOW:
   * ┌─────────────────────────────────────────────────────────────────┐
   * │ 1. Create bin directory (if not exists)                        │
   * │    └─> {userData}/bin/                                         │
   * │                                                                 │
   * │ 2. Refresh shims for ALREADY-installed tools                   │
   * │    └─> Skipped shims (missing dependency) wait until install   │
   * └─────────────────────────────────────────────────────────────────┘
   *
   * IMPORTANT: We do NOT download bun / uv / Python here. New users with no
   * MCPs configured pay zero install cost at boot. The first MCP transport
   * spawn calls ensureRuntimeForCommand(), which installs the relevant runtime
   * on demand and surfaces install duration as MCP "connecting" status.
   *
   * Settings → Runtime still exposes explicit Install buttons for users who
   * want to pre-install before using MCPs.
   */
  public initializeInternalMode() {
    logger.info({ msg: 'Initializing internal mode (lazy install)', mod: 'RuntimeManager' });

    if (!fs.existsSync(this.binPath)) {
      fs.mkdirSync(this.binPath, { recursive: true });
      logger.info({ msg: `Created bin directory: ${this.binPath}`, mod: 'RuntimeManager' });
    }

    // Refresh shims so commands resolved through {userData}/bin work for any
    // tools that are already installed from a previous run.
    ensureShims(this.binPath, true);

    logger.debug({ msg: 'Internal mode initialization completed (no eager install)', mod: 'RuntimeManager' });
  }


  /**
   * Returns environment variables with Internal Bin path prepended to PATH
   */
  public getEnvWithInternalPath(baseEnv = process.env): NodeJS.ProcessEnv {
      // Ensure shims exist whenever we use the internal environment
      ensureShims(this.binPath);

      const env = { ...baseEnv };
      const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';

      const currentPath = env[pathKey] || '';
      env[pathKey] = `${this.binPath}${path.delimiter}${currentPath}`;

      // Ensure Python uses UTF-8 to avoid encoding issues in subprocesses
      // This is especially important for tools running on Windows
      env['PYTHONUTF8'] = '1';
      env['PYTHONIOENCODING'] = 'utf-8';

      // If a specific python version is pinned, force uv to use it
      const pinnedPythonVersion = this.getRunTimeConfig().pinnedPythonVersion;
      if (pinnedPythonVersion && pinnedPythonVersion.trim().length > 0) {
         // UV_PYTHON sets the Python interpreter for uv commands (run, tool run, pip, etc.)
         // It can accept a path or a version request like "3.12"
         env['UV_PYTHON'] = pinnedPythonVersion;
      }

      // Point VIRTUAL_ENV to {userData}/python-venv so that `uv pip install`,
      // `python`, and any subprocess discover the venv regardless of cwd.
      // This replaces the previous reliance on process.cwd()/.venv discovery.
      env['VIRTUAL_ENV'] = this.venvPath;

      // Remove npm_config_prefix to avoid conflicts with nvm in subprocesses.
      // Homebrew node sets this, but it's incompatible with nvm and unnecessary
      // for our internal runtime environment.
      delete env['npm_config_prefix'];

      // Check if mirror is running and inject environment variable
      const mirrorUrl = LocalPythonMirror.getInstance().getBaseUrlIfRunning();
      if (mirrorUrl) {
           env['UV_PYTHON_INSTALL_MIRROR'] = mirrorUrl;
      }

      return env;
  }

  // --- Installation ---

  public async installRuntime(tool: InternalToolType, version: string): Promise<void> {
    const lockKey = `${tool}-${version}`;
    const existing = this.installLocks.get(lockKey);
    if (existing) {
      logger.info({ msg: `[FRE] ${tool} v${version} installation already in progress, waiting for it to complete...`, mod: 'RuntimeManager' });
      return existing;
    }
    return this.installLocks.run(lockKey, () => this.doInstallRuntime(tool, version));
  }

  private async doInstallRuntime(tool: InternalToolType, version: string): Promise<void> {
    const startTime = Date.now();
    logger.info({ msg: `[FRE] Starting installation of ${tool} v${version}...`, mod: 'RuntimeManager', tool, version, isPackaged: app.isPackaged, platform: process.platform, arch: process.arch, binPath: this.binPath });

    // Ensure bin directory exists
    if (!fs.existsSync(this.binPath)) {
      fs.mkdirSync(this.binPath, { recursive: true });
    }

    // Run installation directly in main process (not as subprocess)
    // This is critical because in packaged Electron apps, process.execPath
    // points to the Electron app itself, not Node.js runtime
    if (tool === 'bun') {
      await installBunDirectly(this.binPath, version);
    } else if (tool === 'uv') {
      await installUvDirectly(this.binPath, version);
    } else {
      throw new Error(`Unknown tool: ${tool}`);
    }

    const duration = Date.now() - startTime;
    logger.info({ msg: `[FRE] Successfully installed ${tool} v${version} in ${duration}ms`, mod: 'RuntimeManager', tool, version, duration });

    // Refresh shims after installation to ensure new tools have their corresponding shims
    logger.debug({ msg: `[FRE] Ensuring shims after ${tool} installation...`, mod: 'RuntimeManager' });
    ensureShims(this.binPath);
  }

  // --- Python Management ---

  public listPythonVersionsFast(): PythonVersionInfo[] {
    return listPythonVersionsFast();
  }

  /**
   * List installed Python versions.
   *
   * Uses fast directory scanning only (< 100ms, typically 1-50ms).
   * Directly scans UV's Python installation directory without spawning any subprocess.
   */
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

    // Start global mirror before installation; stop it after — succeed or fail.
    const mirror = LocalPythonMirror.getInstance();
    try {
      await mirror.start();
    } catch (e) {
      logger.warn({ msg: `[FRE] Failed to start local python mirror, proceeding without it`, mod: 'RuntimeManager', err: e });
    }

    const ctx: UvSpawnContext = { uvPath: this.getBinaryPath('uv'), env: this.getEnvWithInternalPath() };

    try {
      await this.installLocks.run(lockKey, () => doInstallPythonVersion(ctx, version));
    } finally {
      mirror.stop();
    }
  }

  public async uninstallPythonVersion(version: string): Promise<void> {
    if (!this.isInstalled('uv')) {
      throw new Error('uv is not installed');
    }

    // If we're uninstalling the pinned version, unpin it first.
    // pinnedPythonVersion may be stored as a short semver ("3.10.12") while
    // version is the full uv directory name ("cpython-3.10.12-macos-aarch64-none"),
    // so match both forms.
    const pinned = this.getRunTimeConfig().pinnedPythonVersion;
    const semverMatch = version.match(/^(?:cpython|pypy)-(\d+\.\d+\.\d+)/);
    const versionSemver = semverMatch ? semverMatch[1] : null;
    if (pinned && (pinned === version || (versionSemver && pinned === versionSemver))) {
      await this.setPinnedPythonVersion(null);
    }

    const ctx: UvSpawnContext = { uvPath: this.getBinaryPath('uv'), env: this.getEnvWithInternalPath() };
    return doUninstallPythonVersion(ctx, version);
  }

  public async cleanUvCache(): Promise<void> {
    logger.info({ msg: '[FRE] cleanUvCache called', mod: 'RuntimeManager', uvInstalled: this.isInstalled('uv') });
    if (!this.isInstalled('uv')) {
      logger.debug({ msg: '[FRE] uv not installed, skipping cache clean', mod: 'RuntimeManager' });
      return;
    }
    const ctx: UvSpawnContext = { uvPath: this.getBinaryPath('uv'), env: this.getEnvWithInternalPath() };
    return doCleanUvCache(ctx);
  }
}
