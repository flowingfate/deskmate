import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerConfig } from '../../../../shared/persist/types';

const clientHarness = vi.hoisted(() => ({
  connect: vi.fn<(signal?: AbortSignal) => Promise<void>>(),
  cleanup: vi.fn<() => Promise<void>>(),
}));

vi.mock('../mcpClient', () => ({
  McpClient: class {
    connectToServer(signal?: AbortSignal): Promise<void> {
      return clientHarness.connect(signal);
    }

    async getTools() {
      return [{ name: 'search', inputSchema: {} }];
    }

    cleanup(): Promise<void> {
      return clientHarness.cleanup();
    }
  },
}));

vi.mock('../auth', () => ({
  McpAuthService: class {
    constructor(_profileId: string) {}

    onInteraction(_listener: () => void): () => void {
      return () => {};
    }

    cancelPendingPrompts(): void {}

    clearOAuthForServer(): Promise<void> {
      return Promise.resolve();
    }

    clearAllOAuthForServer(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

vi.mock('../manager/runtimeStateStore', () => ({
  RuntimeStateStore: class {
    constructor(_profileId: string) {}

    getAll() {
      return [];
    }

    get(_serverName: string) {
      return undefined;
    }

    setStatus(_serverName: string, _status: string): void {}

    markConnecting(_serverName: string): void {}

    markConnected(_serverName: string): void {}

    markError(_serverName: string, _error: Error): void {}

    markDisconnected(_serverName: string): void {}

    remove(_serverName: string): void {}

    dispose(): void {}
  },
}));

import { MCPClientManager } from '..';

interface TestStore {
  readonly id: string;
  readonly mcp: {
    readonly items: McpServerConfig[];
    get(name: string): McpServerConfig | undefined;
    upsert(server: McpServerConfig): Promise<void>;
    remove(name: string): Promise<void>;
  };
}

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'server',
    transport: 'StreamableHttp',
    command: '',
    args: [],
    env: {},
    url: 'https://mcp.example.test',
    in_use: false,
    ...overrides,
  };
}

function makeStore(config: McpServerConfig): TestStore {
  let items = [config];

  return {
    id: 'p_test',
    mcp: {
      get items(): McpServerConfig[] {
        return items;
      },
      get(name: string): McpServerConfig | undefined {
        return items.find((item) => item.name === name);
      },
      async upsert(server: McpServerConfig): Promise<void> {
        items = items.map((item) => (item.name === server.name ? server : item));
      },
      async remove(name: string): Promise<void> {
        items = items.filter((item) => item.name !== name);
      },
    },
  };
}

describe('MCPClientManager lifecycle', () => {
  beforeEach(() => {
    clientHarness.connect.mockReset();
    clientHarness.cleanup.mockReset();
    clientHarness.cleanup.mockResolvedValue(undefined);
  });

  it('cancels an in-flight connection before disconnecting the server', async () => {
    let signalForConnection: AbortSignal | undefined;
    let notifyConnectionStarted: (() => void) | undefined;
    const connectionStarted = new Promise<void>((resolve) => {
      notifyConnectionStarted = resolve;
    });

    clientHarness.connect.mockImplementation((signal) => new Promise<void>((_resolve, reject) => {
      signalForConnection = signal;
      notifyConnectionStarted?.();
      signal?.addEventListener('abort', () => reject(new Error('connection aborted')), { once: true });
    }));

    const store = makeStore(makeConfig({ in_use: true }));
    const manager = new MCPClientManager(store);
    await manager.initialize();
    await connectionStarted;

    await manager.disconnect('server');

    expect(signalForConnection?.aborted).toBe(true);
    expect(clientHarness.cleanup).toHaveBeenCalledTimes(1);
    expect(store.mcp.get('server')?.in_use).toBe(false);
  });

  it('rejects OAuth credential resets after cleanup begins', async () => {
    const config = makeConfig();
    const manager = new MCPClientManager(makeStore(config));
    await manager.initialize();
    await manager.cleanup();

    await expect(manager.clearOAuthForServer('server', config)).rejects.toThrow('MCPClientManager not initialized');
  });

  it('rejects new connections as soon as cleanup begins', async () => {
    const manager = new MCPClientManager(makeStore(makeConfig()));
    await manager.initialize();
    await manager.cleanup();

    await expect(manager.connect('server')).rejects.toThrow('MCPClientManager not initialized');
  });
});
