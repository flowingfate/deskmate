import { describe, it, expect, vi, beforeEach } from 'vitest';

// 捕获 ipcMain.on 注册的 handler，然后在测试里直接调用。
let registeredHandler: ((event: { sender: { id: number } }, payload: unknown) => void) | null = null;
let registeredBatchHandler: ((event: { sender: { id: number } }, payload: unknown) => void) | null = null;

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, fn: (event: { sender: { id: number } }, payload: unknown) => void) => {
      if (channel === 'log:write') registeredHandler = fn;
      if (channel === 'log:writeBatch') registeredBatchHandler = fn;
    }),
  },
}));

const logFns = {
  trace: vi.fn(), debug: vi.fn(), info: vi.fn(),
  warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
};

vi.mock('@main/log', () => ({
  log: logFns,
}));

describe('log:write IPC handler', () => {
  beforeEach(async () => {
    Object.values(logFns).forEach((f) => f.mockClear());
    registeredHandler = null;
    registeredBatchHandler = null;
    vi.resetModules();
    const mod = await import('../log');
    mod.registerLogIPC();
  });

  it('accepts a valid payload and forwards to log[level]', () => {
    registeredHandler!({ sender: { id: 42 } }, {
      level: 'info',
      fields: { mod: 'X', msg: 'hello', custom: 1 },
    });
    expect(logFns.info).toHaveBeenCalledTimes(1);
    expect(logFns.info).toHaveBeenCalledWith({
      mod: 'X',
      msg: 'hello',
      custom: 1,
      processType: 'renderer',
      windowId: 42,
    });
  });

  it('overrides processType / windowId from renderer', () => {
    registeredHandler!({ sender: { id: 7 } }, {
      level: 'warn',
      fields: {
        mod: 'X',
        msg: 'm',
        processType: 'main',
        windowId: 9999,
      },
    });
    expect(logFns.warn).toHaveBeenCalledWith(expect.objectContaining({
      processType: 'renderer',
      windowId: 7,
    }));
  });

  it('silently drops payload with unknown level', () => {
    registeredHandler!({ sender: { id: 1 } }, {
      level: 'banana',
      fields: { mod: 'X', msg: 'm' },
    });
    Object.values(logFns).forEach((f) => expect(f).not.toHaveBeenCalled());
  });

  it('silently drops payload missing fields', () => {
    registeredHandler!({ sender: { id: 1 } }, { level: 'info' });
    Object.values(logFns).forEach((f) => expect(f).not.toHaveBeenCalled());
  });

  it('silently drops non-object payload', () => {
    registeredHandler!({ sender: { id: 1 } }, 'oops');
    registeredHandler!({ sender: { id: 1 } }, null);
    registeredHandler!({ sender: { id: 1 } }, 42);
    Object.values(logFns).forEach((f) => expect(f).not.toHaveBeenCalled());
  });

  it('coerces non-string msg into a string', () => {
    registeredHandler!({ sender: { id: 1 } }, {
      level: 'error',
      fields: { mod: 'X', msg: 123 as unknown as string },
    });
    expect(logFns.error).toHaveBeenCalledWith(expect.objectContaining({ msg: '123' }));
  });

  it('batch: forwards each entry and overrides windowId per entry', () => {
    registeredBatchHandler!({ sender: { id: 5 } }, [
      { level: 'info', fields: { mod: 'A', msg: 'one' } },
      { level: 'warn', fields: { mod: 'B', msg: 'two', windowId: 999 } },
    ]);
    expect(logFns.info).toHaveBeenCalledWith(expect.objectContaining({ mod: 'A', msg: 'one', windowId: 5 }));
    expect(logFns.warn).toHaveBeenCalledWith(expect.objectContaining({ mod: 'B', msg: 'two', windowId: 5 }));
  });

  it('batch: invalid entries are skipped but valid ones pass through', () => {
    registeredBatchHandler!({ sender: { id: 1 } }, [
      { level: 'info', fields: { mod: 'X', msg: 'ok' } },
      { level: 'banana', fields: { mod: 'X', msg: 'bad' } },
      'oops',
    ]);
    expect(logFns.info).toHaveBeenCalledTimes(1);
    expect(logFns.warn).not.toHaveBeenCalled();
  });

  it('batch: non-array payload is silently dropped', () => {
    registeredBatchHandler!({ sender: { id: 1 } }, { level: 'info', fields: { mod: 'X', msg: 'm' } });
    Object.values(logFns).forEach((f) => expect(f).not.toHaveBeenCalled());
  });
});
