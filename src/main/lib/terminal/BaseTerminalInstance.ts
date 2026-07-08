/**
 * 终端实例抽象基类 —— 承载所有实例共有的「进程生命周期编排」。
 *
 * 两个正交维度决定一个终端实例的行为：
 * - **输出解释**：一次性命令缓冲 stdout/stderr（`CommandInstance`），还是 MCP 按 `\n`
 *   分帧收发消息（`McpTransportInstance`）。这条轴由**子类**实现 `setupOutputHandlers`。
 * - **生命周期**：是否 `persistent`。持久实例装 `TerminalStateHandler` 做优雅关闭。
 *   这条轴留在基类，由 `config.persistent` 驱动，两种子类都可持久。
 *
 * 基类只负责：解析 cwd/shell/env、spawn、等待 ready、状态机、停止、清理。
 * MCP 专属的运行时 lazy-install 与 Windows-ARM shim 绕过，作为可覆盖 hook 下沉到此，
 * 基类默认 no-op，`McpTransportInstance` 覆盖。
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { readFile, stat } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  TerminalConfig,
  TerminalInstanceType,
  TerminalState,
  TerminalInstanceInfo
} from './types';
import { userDataBinPath, userDataNodeShimsPath, userDataRuntimeBinPath, parseEnvFile, untildify } from './environment';
import {
  getDefaultShell,
  getShellProfile,
  getRunnableShellProfile,
  getEnhancedEnvironment
} from './platformConfigs';
import { log } from '@main/log';
import { TerminalStateHandler } from './processControl';
import { buildShellInvocation, createMissingCwdPrefix } from './commandBuilder';
import { genId } from './ids';

const SPAWN_TIMEOUT_MS = 5_000;
const STOP_SIGKILL_FALLBACK_MS = 5_000;

export abstract class BaseTerminalInstance extends EventEmitter {
  public readonly id: string;
  public readonly type: TerminalInstanceType;
  public readonly config: TerminalConfig;

  protected _state: TerminalState = 'idle';
  protected _process: ChildProcessWithoutNullStreams | null = null;
  protected stateHandler: TerminalStateHandler | null = null;

  protected readonly startTime: number;
  protected lastActivity: number;
  protected error?: string;

  constructor(config: TerminalConfig) {
    super();
    this.id = config.instanceId || genId('terminal');
    this.type = config.type;
    this.config = config;
    this.startTime = Date.now();
    this.lastActivity = this.startTime;
  }

  public get state(): TerminalState {
    return this._state;
  }

  public get process(): ChildProcessWithoutNullStreams | null {
    return this._process;
  }

  public get pid(): number | undefined {
    return this._process?.pid;
  }

  /**
   * 启动终端实例：解析 cwd / shell / 环境 / 命令，spawn 子进程并等待其 ready。
   */
  public async start(): Promise<void> {
    if (this._state === 'running') {
      return;
    }

    this.setState('running');

    try {
      let cwd = this.prepareCwd();
      const runnableShell = await getRunnableShellProfile(this.config.shell);
      if (runnableShell.fallbackReason) {
        log.warn({ msg: '[TerminalInstance] Shell fallback applied', mod: 'start', requestedShell: this.config.shell || getDefaultShell(), effectiveShell: runnableShell.shellType, reason: runnableShell.fallbackReason });
      }

      // cwd 不存在时，回退到 home 并加一个切换目录的命令前缀
      let commandPrefix = '';
      try {
        await stat(cwd);
      } catch {
        commandPrefix = createMissingCwdPrefix(cwd, runnableShell.profile.command);
        cwd = os.homedir();
      }

      const env = await this.prepareEnvironment();
      const { executable, args, shell } = this.prepareCommand(commandPrefix, runnableShell.profile, runnableShell.shellType);

      this._process = spawn(executable, args, {
        stdio: 'pipe',
        cwd,
        env: env as unknown as NodeJS.ProcessEnv,
        shell,
      });

      // 仅持久实例需要优雅关闭状态机
      if (this.config.persistent) {
        this.stateHandler = new TerminalStateHandler(this._process);
      }

      this.setupEventHandlers();
      await this.waitForSpawn();
    } catch (error) {
      this.setState('error');
      this.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * 停止终端实例。持久实例走状态机优雅关闭；否则直接发信号并在 5 秒后强制杀。
   */
  public async stop(force: boolean = false): Promise<void> {
    if (this._state === 'stopped') {
      return;
    }

    this.setState('stopping');

    if (this.stateHandler) {
      this.stateHandler.stop();
    } else if (this._process && !this._process.killed) {
      if (force) {
        this._process.kill('SIGKILL');
      } else {
        this._process.kill('SIGTERM');
        setTimeout(() => {
          if (this._process && !this._process.killed) {
            this._process.kill('SIGKILL');
          }
        }, STOP_SIGKILL_FALLBACK_MS);
      }
    }

    if (this._process && !this._process.killed) {
      const { promise, resolve } = Promise.withResolvers<void>();
      this._process.once('exit', () => resolve());
      await promise;
    }

    this.cleanup();
  }

  public getInfo(): TerminalInstanceInfo {
    return {
      id: this.id,
      type: this.type,
      state: this._state,
      config: this.config,
      pid: this.pid,
      startTime: this.startTime,
      lastActivity: this.lastActivity,
      error: this.error
    };
  }

  public dispose(): void {
    this.cleanup();
    this.removeAllListeners();
  }

  // ─── 子类可覆盖的 hook ────────────────────────────────────────────────────

  /**
   * 挂载输出流处理器。`command` 缓冲 stdout/stderr；`mcp_transport` 按 `\n` 分帧。
   */
  protected abstract setupOutputHandlers(): void;

  /**
   * 是否让子进程绕过内置 node/npm/npx shim（Windows-ARM 原生依赖解析修复）。
   * 基类默认不绕过；`McpTransportInstance` 覆盖。
   */
  protected shouldBypassInternalNodeShims(): boolean {
    return false;
  }

  /**
   * spawn 前按需 lazy-install 运行时。基类 no-op；`McpTransportInstance` 覆盖为
   * 首次 spawn 时安装对应运行时（JS 命令用 bun，Python 命令用 uv）。
   */
  protected async ensureRuntimeInstalled(): Promise<void> {
    // 默认无需安装
  }

  // ─── 共享内部逻辑 ─────────────────────────────────────────────────────────

  protected setState(newState: TerminalState): void {
    this._state = newState;
    this.emit('stateChange', newState);
  }

  protected cleanup(): void {
    if (this.stateHandler) {
      this.stateHandler.dispose();
      this.stateHandler = null;
    }
    this._process = null;
  }

  /**
   * 等待子进程 spawn 就绪，带 5 秒超时。
   */
  private waitForSpawn(): Promise<void> {
    const child = this._process!;
    const { promise, resolve, reject } = Promise.withResolvers<void>();

    if (child.killed) {
      reject(new Error('Process was killed during startup'));
      return promise;
    }

    child.once('spawn', () => {
      this.lastActivity = Date.now();
      resolve();
    });
    child.once('error', reject);
    setTimeout(() => reject(new Error('Process spawn timeout')), SPAWN_TIMEOUT_MS);

    return promise;
  }

  private prepareCwd(): string {
    let cwd = untildify(this.config.cwd);
    if (!path.isAbsolute(cwd)) {
      cwd = path.resolve(cwd);
    }
    return cwd;
  }

  /**
   * shim 可见范围决策，env 与 wrapper 共用同一结论，保证两处 PATH 一致：
   * - `includeBinPath`：是否前插 {userData}/env/bin（root）。Win-ARM bypass 时整体关闭。
   * - `includeNodeShims`：是否额外前插 node-shims 子目录。仅 MCP transport 需要全套
   *   node shim；shell（command 型）不含 → node/npm/npx 落系统真二进制。
   */
  private resolveShimScope(): { includeBinPath: boolean; includeNodeShims: boolean } {
    const includeBinPath = !this.shouldBypassInternalNodeShims();
    const includeNodeShims = includeBinPath && this.type === 'mcp_transport';
    return { includeBinPath, includeNodeShims };
  }

  /** 依 scope 收集写入 wrapper 的 PATH 前插目录（shim 目录 + runtime-bin，覆盖 `.zshrc` 对 PATH 的篡改）。 */
  private resolvePrependDirs(): string[] {
    const { includeBinPath, includeNodeShims } = this.resolveShimScope();
    if (!includeBinPath) return [];
    const root = userDataBinPath();
    const nodeShims = includeNodeShims ? userDataNodeShimsPath() : null;
    // runtime-bin 排在 shim 目录之后（wrapper 里再接 `:$PATH`）→ shim 压过全局 CLI，全局 CLI 压过系统。
    const runtimeBin = userDataRuntimeBinPath();
    return [root, nodeShims, runtimeBin].filter((p): p is string => Boolean(p));
  }

  /**
   * 构建环境变量：注入运行时 bin 路径、按需 lazy-install 运行时、加载 envFile、
   * 应用 config.env 覆盖。委托给 environment / platformConfigs 模块。
   */
  protected async prepareEnvironment(): Promise<Record<string, string>> {
    // app-managed 运行时始终启用：把 {userData}/env/bin 前置到 PATH，除非命中 shim 绕过。
    const { includeBinPath, includeNodeShims } = this.resolveShimScope();

    if (includeBinPath) {
      await this.ensureRuntimeInstalled();
    }

    const env = getEnhancedEnvironment(includeBinPath, includeNodeShims);

    if (this.config.envFile) {
      try {
        const envContent = await readFile(this.config.envFile, 'utf-8');
        for (const [key, value] of parseEnvFile(envContent)) {
          env[key] = value;
        }
      } catch (e) {
        throw new Error(`Failed to read envFile '${this.config.envFile}': ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (this.config.env) {
      for (const [key, value] of Object.entries(this.config.env)) {
        if (value === null) {
          delete env[key];
        } else if (value !== undefined) {
          env[key] = String(value);
        }
      }
    }

    return env;
  }

  /**
   * 构建传给 shell 的调用参数。委托给 commandBuilder.buildShellInvocation。
   */
  protected prepareCommand(prefix: string = '', shellProfileOverride?: { command: string; args: string[] }, shellTypeOverride?: string): { executable: string; args: string[]; shell: boolean } {
    const shellProfile = shellProfileOverride || getShellProfile(this.config.shell);
    const shellType = shellTypeOverride || this.config.shell || getDefaultShell();

    return buildShellInvocation({
      command: this.config.command,
      args: this.config.args,
      prefix,
      shellCommand: shellProfile.command,
      shellArgs: shellProfile.args,
      shellType,
      prependDirs: this.resolvePrependDirs()
    });
  }

  private setupEventHandlers(): void {
    if (!this._process) return;

    this.setupOutputHandlers();

    this._process.on('error', (error: Error) => {
      this.setState('error');
      this.error = `Process error: ${error.message}`;
      this.emit('error', error);
    });

    this._process.on('exit', (code: number | null, signal: string | null) => {
      const isExpectedExit = this.stateHandler?.stopped || this._state === 'stopping';
      if (isExpectedExit || code === 0) {
        this.setState('stopped');
      } else {
        this.setState('error');
        this.error = `Process exited with code ${code}, signal ${signal}`;
      }
      this.emit('exit', code, signal);
      this.cleanup();
    });
  }
}
