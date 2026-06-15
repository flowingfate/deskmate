import { EventEmitter } from 'events';
import { McpClientCore } from '../Client';

class FakeTransport extends EventEmitter {
  public state: { state: 'stopped' | 'running' | 'error' } = { state: 'stopped' };

  async start(): Promise<void> {
    this.state = { state: 'running' };
  }

  send(_message: string): void {
    setImmediate(() => {
      this.state = { state: 'error' };
      this.emit('stateChange', {
        state: 'error',
        message: 'spawn failed'
      });
    });
  }

  async stop(): Promise<void> {
    this.state = { state: 'stopped' };
  }
}

const mockCreateFromConfig = vi.fn();

vi.mock('../transport/TransportFactory', async () => ({
  TransportFactory: {
    createFromConfig: (...args: unknown[]) => mockCreateFromConfig(...args)
  }
}));
describe('McpClient', () => {
  beforeEach(() => {
    mockCreateFromConfig.mockReset();
  });

  it('rejects initialization when the transport errors during startup', async () => {
    const transport = new FakeTransport();
    mockCreateFromConfig.mockReturnValue(transport);

    const client = new McpClientCore({
      name: 'flink',
      type: 'stdio',
      command: 'node',
      args: ['server.js']
    });

    await expect(client.connect()).rejects.toThrow('spawn failed');
  });
});