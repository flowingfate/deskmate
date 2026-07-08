/**
 * 锁定 TerminalManager 的「exit 驱动摘池」回归保护。
 *
 * 有意的行为契约：进程 `exit` 是任何「真正跑起来又退出」实例的唯一权威回收路径。
 * 任何实例（含持久 + 干净退出 code 0/null）在 exit 后延迟 EXIT_REMOVAL_DELAY_MS(1000ms)
 * 从池中 delete + dispose。重构前只有「非持久 或 异常退出」才会移除，持久且干净退出的
 * 实例会永久泄漏在池里。这里用假实例（不 spawn 真进程）验证可观测行为：池可见性 + dispose 调用。
 */

import type { TerminalConfig, TerminalInstanceInfo, TerminalInstanceType } from '../types';

// 自足的假实例：不依赖 EventEmitter，避免 vi.mock 工厂在 imports 之前运行时引用尚未初始化的顶层导入。
// 定义在 vi.hoisted 中，保证 factories 求值前已就绪。
const mockTerminal = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class MockTerminalInstance {
    public readonly id: string;
    public readonly type: TerminalInstanceType;
    public readonly config: TerminalConfig;
    public readonly start = vi.fn().mockResolvedValue(undefined);
    public readonly stop = vi.fn().mockResolvedValue(undefined);
    public readonly dispose = vi.fn();
    private readonly listeners = new Map<string, Listener[]>();

    constructor(config: TerminalConfig) {
      this.config = config;
      this.type = config.type;
      this.id = config.instanceId ?? `fake_${Math.random().toString(36).slice(2)}`;
      created.push(this);
    }

    public on(event: string, listener: Listener): this {
      const list = this.listeners.get(event) ?? [];
      list.push(listener);
      this.listeners.set(event, list);
      return this;
    }

    public emit(event: string, ...args: unknown[]): boolean {
      const list = this.listeners.get(event) ?? [];
      for (const listener of list) {
        listener(...args);
      }
      return list.length > 0;
    }

    public getInfo(): TerminalInstanceInfo {
      return {
        id: this.id,
        type: this.type,
        state: 'running',
        config: this.config,
        pid: 1234,
        startTime: Date.now(),
        lastActivity: Date.now(),
      };
    }
  }

  const created: MockTerminalInstance[] = [];
  return { MockTerminalInstance, created };
});

vi.mock('../CommandInstance', () => ({ CommandInstance: mockTerminal.MockTerminalInstance }));
vi.mock('../McpTransportInstance', () => ({ McpTransportInstance: mockTerminal.MockTerminalInstance }));
vi.mock('@main/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { TerminalManager } from '../TerminalManager';

const EXIT_REMOVAL_DELAY_MS = 1_000;

function makeConfig(overrides: Partial<TerminalConfig> & Pick<TerminalConfig, 'type'>): TerminalConfig {
  return {
    command: 'node',
    args: [],
    cwd: '/tmp',
    ...overrides,
  };
}

describe('TerminalManager exit-driven pool recycling', () => {
  let manager: TerminalManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mockTerminal.created.length = 0;
    manager = new TerminalManager();
  });

  afterEach(async () => {
    await manager.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    mockTerminal.created.length = 0;
  });

  it('removes a persistent instance that exits cleanly (core regression guard)', async () => {
    const instance = await manager.createCommand(
      makeConfig({ type: 'command', persistent: true, instanceId: 'persist-clean' })
    );
    const fake = mockTerminal.created.find(f => f.id === instance.id);
    if (!fake) throw new Error('fake instance was not constructed');

    expect(manager.getInstance(instance.id)).not.toBeNull();

    fake.emit('exit', 0, null);
    vi.advanceTimersByTime(EXIT_REMOVAL_DELAY_MS);

    expect(manager.getInstance(instance.id)).toBeNull();
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  });

  it('removes a persistent mcp_transport instance that exits cleanly', async () => {
    const instance = await manager.createTransport(
      makeConfig({ type: 'mcp_transport', instanceId: 'persist-mcp' })
    );
    const fake = mockTerminal.created.find(f => f.id === instance.id);
    if (!fake) throw new Error('fake instance was not constructed');

    expect(manager.getInstance(instance.id)).not.toBeNull();

    fake.emit('exit', 0, null);
    vi.advanceTimersByTime(EXIT_REMOVAL_DELAY_MS);

    expect(manager.getInstance(instance.id)).toBeNull();
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps the instance in the pool until the delay window elapses (delayed, not immediate)', async () => {
    const instance = await manager.createCommand(
      makeConfig({ type: 'command', persistent: true, instanceId: 'delay-window' })
    );
    const fake = mockTerminal.created.find(f => f.id === instance.id);
    if (!fake) throw new Error('fake instance was not constructed');

    fake.emit('exit', 0, null);

    vi.advanceTimersByTime(EXIT_REMOVAL_DELAY_MS - 1);
    expect(manager.getInstance(instance.id)).not.toBeNull();
    expect(fake.dispose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(manager.getInstance(instance.id)).toBeNull();
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  });

  it('removes an instance that exits abnormally (non-zero code)', async () => {
    const instance = await manager.createCommand(
      makeConfig({ type: 'command', persistent: false, instanceId: 'abnormal-exit' })
    );
    const fake = mockTerminal.created.find(f => f.id === instance.id);
    if (!fake) throw new Error('fake instance was not constructed');

    expect(manager.getInstance(instance.id)).not.toBeNull();

    fake.emit('exit', 1, null);
    vi.advanceTimersByTime(EXIT_REMOVAL_DELAY_MS);

    expect(manager.getInstance(instance.id)).toBeNull();
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  });

  it('stopInstance stops + removes the instance and is idempotent on a second call', async () => {
    const instance = await manager.createCommand(
      makeConfig({ type: 'command', persistent: false, instanceId: 'idempotent-stop' })
    );
    const fake = mockTerminal.created.find(f => f.id === instance.id);
    if (!fake) throw new Error('fake instance was not constructed');

    await manager.stopInstance(instance.id, true);

    expect(fake.stop).toHaveBeenCalledTimes(1);
    expect(manager.getInstance(instance.id)).toBeNull();

    // 实例已不在池中：二次 stop 应为 no-op，不抛。
    await expect(manager.stopInstance(instance.id)).resolves.toBeUndefined();
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });
});
