/**
 * DeskmateStdioSdkTransport smoke.
 *
 * 覆盖 adapter 的核心契约 —— 用 mock 的 wire `StdioTransport` EventEmitter,
 * 验证 SDK Transport 语义:
 *   - `start()` 挂 handlers 后再调 inner.start(顺序敏感 —— 首帧不能丢)
 *   - inner 'message' 事件 → `JSON.parse` → `onmessage(JSONRPCMessage)`
 *   - 非 JSON 帧 → `onerror(Error)`,不进 `onmessage`
 *   - inner `stateChange:'error'` → `onerror` + `onclose` + 保存
 *     `lastErrorMessage`(供 `mcpClient` 增强 "Connection closed" 通用错误)
 *   - close 后 inner 事件被丢弃(`closed` 幂等保护,防止 exit + stop 双回调)
 *   - `send(obj)` → `JSON.stringify` → `inner.send(string)`
 */
import { EventEmitter } from 'events';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { DeskmateStdioSdkTransport } from '../DeskmateStdioSdkTransport';

/**
 * `vi.hoisted` 让 factory 与测试共享同一份 instances registry:mock factory
 * 被提升到 import 之前执行,普通模块级 const 那时还未初始化。
 */
const fakeCtx = vi.hoisted(() => {
  return { instances: [] as EventEmitter[] };
});

vi.mock('../wire/StdioTransport', () => {
  const events = require('events');
  class FakeStdioTransport extends events.EventEmitter {
    public start = vi.fn().mockResolvedValue(undefined);
    public stop = vi.fn().mockResolvedValue(undefined);
    public send = vi.fn();
    public getStderrPreview = vi.fn().mockReturnValue('');
    public startCallOrder = 0;
    public listenerCountAtStart = 0;
    constructor(_config: unknown) {
      super();
      // 记录 start 被调用时 message/stateChange listener 数,用于验证
      // handlers 在 start 之前挂就位。
      this.start.mockImplementation(async () => {
        this.listenerCountAtStart =
          this.listenerCount('message') + this.listenerCount('stateChange');
      });
      fakeCtx.instances.push(this);
    }
  }
  return { StdioTransport: FakeStdioTransport };
});

interface FakeInner extends EventEmitter {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  getStderrPreview: ReturnType<typeof vi.fn>;
  listenerCountAtStart: number;
}

function latestInner(): FakeInner {
  const inst = fakeCtx.instances[fakeCtx.instances.length - 1];
  if (!inst) {
    throw new Error('no fake StdioTransport instance was constructed');
  }
  return inst as FakeInner;
}

describe('DeskmateStdioSdkTransport', () => {
  beforeEach(() => {
    fakeCtx.instances.length = 0;
  });

  it('attaches inner event handlers before inner.start() runs', async () => {
    const adapter = new DeskmateStdioSdkTransport('srv', {
      command: 'node',
      args: [],
    });
    await adapter.start();
    const inner = latestInner();
    expect(inner.start).toHaveBeenCalledTimes(1);
    // 'message' + 'stateChange' 各挂 1 个 → 2
    expect(inner.listenerCountAtStart).toBe(2);
  });

  it('parses inner stdout lines into JSONRPCMessage for onmessage', async () => {
    const adapter = new DeskmateStdioSdkTransport('srv', { command: 'node', args: [] });
    const received: JSONRPCMessage[] = [];
    adapter.onmessage = (msg) => {
      received.push(msg);
    };
    await adapter.start();

    latestInner().emit('message', '{"jsonrpc":"2.0","id":7,"result":{"ok":true}}');

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ jsonrpc: '2.0', id: 7, result: { ok: true } });
  });

  it('routes malformed stdout line to onerror without calling onmessage', async () => {
    const adapter = new DeskmateStdioSdkTransport('srv', { command: 'node', args: [] });
    const errors: Error[] = [];
    const messages: JSONRPCMessage[] = [];
    adapter.onerror = (err) => errors.push(err);
    adapter.onmessage = (msg) => messages.push(msg);
    await adapter.start();

    latestInner().emit('message', 'not valid json');

    expect(messages).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
  });

  it('maps inner stateChange:error to onerror + onclose and captures lastErrorMessage', async () => {
    const adapter = new DeskmateStdioSdkTransport('srv', { command: 'node', args: [] });
    const errors: Error[] = [];
    let closedCount = 0;
    adapter.onerror = (err) => errors.push(err);
    adapter.onclose = () => {
      closedCount += 1;
    };
    await adapter.start();

    latestInner().emit('stateChange', { state: 'error', message: 'spawn ENOENT' });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('spawn ENOENT');
    expect(closedCount).toBe(1);
    expect(adapter.getLastErrorMessage()).toBe('spawn ENOENT');
  });

  it('drops further inner events after a terminal state (closed flag is idempotent)', async () => {
    const adapter = new DeskmateStdioSdkTransport('srv', { command: 'node', args: [] });
    const errors: Error[] = [];
    let closedCount = 0;
    adapter.onerror = (err) => errors.push(err);
    adapter.onclose = () => {
      closedCount += 1;
    };
    await adapter.start();

    const inner = latestInner();
    // 先触发 error(第一次 onclose)
    inner.emit('stateChange', { state: 'error', message: 'first' });
    // 再触发 stopped(应被忽略,不能第二次 onclose)
    inner.emit('stateChange', { state: 'stopped' });
    // 再来一条 message(应被忽略)
    inner.emit('message', '{"jsonrpc":"2.0","id":1,"result":{}}');

    expect(closedCount).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('sends JSON.stringify(message) through inner.send', async () => {
    const adapter = new DeskmateStdioSdkTransport('srv', { command: 'node', args: [] });
    await adapter.start();

    await adapter.send({ jsonrpc: '2.0', id: 1, method: 'ping' });

    const inner = latestInner();
    expect(inner.send).toHaveBeenCalledTimes(1);
    expect(inner.send).toHaveBeenCalledWith('{"jsonrpc":"2.0","id":1,"method":"ping"}');
  });

  it('close() calls inner.stop() and triggers onclose exactly once even on repeat', async () => {
    const adapter = new DeskmateStdioSdkTransport('srv', { command: 'node', args: [] });
    let closedCount = 0;
    adapter.onclose = () => {
      closedCount += 1;
    };
    await adapter.start();

    await adapter.close();
    await adapter.close();

    expect(latestInner().stop).toHaveBeenCalledTimes(1);
    expect(closedCount).toBe(1);
  });
});
