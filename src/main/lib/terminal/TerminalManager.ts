/**
 * 统一终端实例管理器。
 *
 * 负责创建、管理与协调所有终端实例（跨 Windows / macOS）。类本身只持有
 * 实例池（Map）、池配置与清理定时器；配置校验委托给纯函数 validateConfig。
 */

import {
  TerminalConfig,
  TerminalConfigBase,
  TerminalResult
} from './types';
import { BaseTerminalInstance } from './BaseTerminalInstance';
import { CommandInstance } from './CommandInstance';
import { McpTransportInstance } from './McpTransportInstance';
import { validateConfig } from './validateConfig';
import { genId } from './ids';
import { log } from '@main/log';

/**
 * 终端实例池配置。
 */
interface PoolConfig {
  maxInstances: number;
  idleTimeoutMs: number;
  cleanupIntervalMs: number;
}

const DEFAULT_POOL_CONFIG: PoolConfig = {
  maxInstances: 50,
  idleTimeoutMs: 300_000, // 5 分钟
  cleanupIntervalMs: 300_000 // 5 分钟（与 idleTimeoutMs 对齐）
};

// 进程退出后延迟摘池的时长。exit 监听按注册序同步触发，manager 早于下游消费者
// （如 StdioTransport）注册；若同步 dispose 会 removeAllListeners 掐掉下游 exit 回调，
// 故延迟一拍，确保所有 exit 监听先跑完。
const EXIT_REMOVAL_DELAY_MS = 1_000;

export class TerminalManager {
  private instances = new Map<string, BaseTerminalInstance>();
  private poolConfig: PoolConfig;
  private cleanupTimer?: NodeJS.Timeout;
  private disposed = false;

  constructor(poolConfig: Partial<PoolConfig> = {}) {
    this.poolConfig = { ...DEFAULT_POOL_CONFIG, ...poolConfig };

    log.info({ msg: `TerminalManager initialized`, mod: 'TerminalManager', poolConfig: this.poolConfig, platform: process.platform });

    this.startCleanupTimer();
  }

  /**
   * 执行一次性命令并返回归一化结果。内部建临时非持久实例，`execute()` 自带 spawn，
   * 无论成败 `finally` 立即回收。无需增量输出 / 取消的调用方用这个（git/uv 探测等）。
   */
  public async run(config: TerminalConfigBase): Promise<TerminalResult> {
    const executionId = genId('exec');
    const startTime = Date.now();

    const instance = await this.createCommand({
      ...config,
      persistent: false,
      instanceId: config.instanceId ?? genId('cmd')
    });

    try {
      const result = await instance.execute();
      log.info({ msg: `Command execution completed`, mod: 'TerminalManager', executionId, instanceId: instance.id, exitCode: result.exitCode, executionTimeMs: Date.now() - startTime, timedOut: result.timedOut });
      return result;
    } catch (error) {
      log.error({ msg: `Command execution failed`, mod: 'TerminalManager', executionId, instanceId: instance.id, err: error, executionTimeMs: Date.now() - startTime });
      throw error;
    } finally {
      await this.stopInstance(instance.id, true);
    }
  }

  /**
   * 创建一个命令实例（`CommandInstance`），**不启动**。返回具体类型，调用方可挂
   * stdout/stderr/exit 监听后再自行 `start()`。用于需要增量输出、取消（`shell` 工具）
   * 或长驻后台（`persistent: true`，`BackgroundProcessManager`）的命令。
   */
  public async createCommand(config: TerminalConfigBase): Promise<CommandInstance> {
    await this.ensureCapacity();
    const full: TerminalConfig = { ...config, type: 'command' };
    validateConfig(full);
    return this.register(new CommandInstance(full));
  }

  /**
   * 创建一个 MCP 持久传输实例（`McpTransportInstance`），**不启动**。返回具体类型，
   * `.send()` 编译期可见；始终 `persistent`。调用方挂 message/exit 监听后自行 `start()`。
   */
  public async createTransport(config: TerminalConfigBase): Promise<McpTransportInstance> {
    await this.ensureCapacity();
    const full: TerminalConfig = { ...config, type: 'mcp_transport', persistent: true };
    validateConfig(full);
    return this.register(new McpTransportInstance(full));
  }

  /**
   * 按 id 取实例。只有测试在用。
   */
  public getInstance(id: string): BaseTerminalInstance | null {
    return this.instances.get(id) || null;
  }

  /**
   * 池容量守卫：已 dispose 抛错；达上限先强制清理空闲实例，仍满则抛。
   * 造实例前调用，保证「构造与启动分离」路径上不越过池上限。
   */
  private async ensureCapacity(): Promise<void> {
    if (this.disposed) {
      throw new Error('TerminalManager has been disposed');
    }

    if (this.instances.size >= this.poolConfig.maxInstances) {
      log.warn({ msg: `Maximum instance limit reached, attempting cleanup`, mod: 'TerminalManager', currentCount: this.instances.size, maxInstances: this.poolConfig.maxInstances });
      await this.cleanupIdleInstances(true);

      if (this.instances.size >= this.poolConfig.maxInstances) {
        throw new Error(`Maximum number of terminal instances reached (${this.poolConfig.maxInstances})`);
      }
    }
  }

  /**
   * 入池：挂 pool 级监听 + 注册进 Map。构造与启动分离 —— 此处只登记，绝不 `start`。
   */
  private register<T extends BaseTerminalInstance>(instance: T): T {
    this.subscribeInstanceForPool(instance);
    this.instances.set(instance.id, instance);
    log.info({ msg: `Terminal instance created`, mod: 'TerminalManager', instanceId: instance.id, instanceType: instance.type, command: instance.config.command, cwd: instance.config.cwd, totalInstances: this.instances.size });
    return instance;
  }

  /**
   * 停止指定实例，无论成败都从池中移除并 dispose。
   */
  public async stopInstance(id: string, force: boolean = false): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      return; // 实例不存在 —— 无需操作
    }

    try {
      await instance.stop(force);
    } catch (error) {
      log.error({ msg: `Failed to stop terminal instance`, mod: 'TerminalManager', instanceId: id, err: error });
      throw error;
    } finally {
      this.instances.delete(id);
      instance.dispose();
    }
  }

  /**
   * 停止全部实例（并行）。
   */
  private async stopAllInstances(force: boolean = false): Promise<void> {
    if (this.instances.size === 0) {
      return;
    }

    const stopPromises = Array.from(this.instances.keys()).map(id => this.stopInstance(id, force));
    const results = await Promise.allSettled(stopPromises);

    const failed = results.filter(r => r.status === 'rejected').length;
    log.info({ msg: `All terminal instances stopped`, mod: 'TerminalManager', total: results.length, failed, force });
  }

  /**
   * 清理资源：停定时器、停全部实例。
   */
  public async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    await this.stopAllInstances(true);

    log.info({ msg: `TerminalManager disposed`, mod: 'TerminalManager' });
  }

  private subscribeInstanceForPool(instance: BaseTerminalInstance): void {
    instance.on('error', (error: Error) => {
      log.error({ msg: `Terminal instance error occurred`, mod: 'TerminalManager', instanceId: instance.id, err: error });
    });

    // 进程退出即摘池：exit 是任何「真正跑起来又退出」实例的权威回收路径。
    // 延迟一拍让下游 exit 监听先跑完，再 delete + dispose。周期 cleanup 只兜底
    // 「创建后从未 exit」的泄漏实例。
    instance.on('exit', (code: number | null, signal: string | null) => {
      log.info({ msg: `Terminal instance process exited`, mod: 'TerminalManager', instanceId: instance.id, exitCode: code, signal, persistent: instance.getInfo().config.persistent });

      setTimeout(() => {
        if (this.instances.has(instance.id)) {
          this.instances.delete(instance.id);
          instance.dispose();
        }
      }, EXIT_REMOVAL_DELAY_MS);
    });

    instance.on('stateChange', (state) => {
      log.debug({ msg: `Terminal instance state changed`, mod: 'TerminalManager', instanceId: instance.id, newState: state });
    });
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleInstances(false).catch(error => {
        log.error({ msg: `Cleanup timer error`, mod: 'TerminalManager', err: error });
      });
    }, this.poolConfig.cleanupIntervalMs);

    // 确保定时器不阻止进程退出
    this.cleanupTimer.unref();
  }

  /**
   * 清理空闲实例。force=true 时无视 persistent 与空闲时长，清理全部可停止实例。
   */
  private async cleanupIdleInstances(force: boolean): Promise<void> {
    const now = Date.now();
    const instancesToCleanup: string[] = [];

    for (const [id, instance] of Array.from(this.instances.entries())) {
      const info = instance.getInfo();

      // 跳过持久实例（除非强制清理）
      if (info.config.persistent && !force) {
        continue;
      }

      const idleTime = now - info.lastActivity;
      const shouldCleanup = force ||
        (info.state === 'idle' && idleTime > this.poolConfig.idleTimeoutMs) ||
        info.state === 'error' ||
        info.state === 'stopped';

      if (shouldCleanup) {
        instancesToCleanup.push(id);
      }
    }

    if (instancesToCleanup.length === 0) {
      return;
    }

    const cleanupPromises = instancesToCleanup.map(id =>
      this.stopInstance(id, true).catch(error => {
        log.error({ msg: `Failed to cleanup instance`, mod: 'TerminalManager', instanceId: id, err: error });
      })
    );
    await Promise.allSettled(cleanupPromises);

    log.info({ msg: `Idle instances cleanup completed`, mod: 'TerminalManager', cleanedInstances: instancesToCleanup.length, remainingInstances: this.instances.size, force });
  }
}

/**
 * 全局终端管理器单例。构造零成本，模块加载即建；实例池 / 清理定时器都是惰性的。
 */
export const terminalManager = new TerminalManager();
