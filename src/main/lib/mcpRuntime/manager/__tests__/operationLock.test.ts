import { describe, expect, it } from 'vitest';
import { OperationLockRegistry } from '../operationLock';

describe('OperationLockRegistry', () => {
  it('runs background work after an active server operation settles', async () => {
    const locks = new OperationLockRegistry();
    const operations: string[] = [];
    let releaseConnect: () => void = () => {
      throw new Error('Connect operation has not started');
    };
    const connectFinished = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });

    const connect = locks.run('server', 'connect', async () => {
      operations.push('connect');
      await connectFinished;
    });
    const reconnect = locks.runWhenIdle('server', 'reconnect', async () => {
      operations.push('reconnect');
    });

    await Promise.resolve();
    expect(operations).toEqual(['connect']);

    releaseConnect();
    await Promise.all([connect, reconnect]);
    expect(operations).toEqual(['connect', 'reconnect']);
  });
});
