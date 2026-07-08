/**
 * Tests for the MCP transport lazy-runtime-install gate in
 * TerminalInstance.prepareEnvironment().
 *
 * Replaces the previous shim-ready test: the boot path no longer pre-installs
 * runtimes, so the gate now drives `ensureRuntimeForCommand(command, args)`
 * which classifies the spawn and ensures only the runtime that command needs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandInstance } from '../CommandInstance';
import { McpTransportInstance } from '../McpTransportInstance';
import { TerminalConfig } from '../types';
import { setTerminalRuntimeBridge, type TerminalRuntimeBridge } from '../runtimeBridge';

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn().mockReturnValue('C:\\test\\userData'),
    getName: vi.fn().mockReturnValue('test-app'),
    isReady: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

const mockEnsureRuntimeForCommand = vi.fn<TerminalRuntimeBridge['ensureRuntimeForCommand']>().mockResolvedValue(undefined);

const bridge: TerminalRuntimeBridge = {
  ensureRuntimeForCommand: mockEnsureRuntimeForCommand,
  applyRuntimeEnv: vi.fn(),
};

vi.mock('../platformConfigs', async () => ({
  getRunnableShellProfile: async () => ({
    shellType: 'powershell',
    profile: {
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
      supportsPersistent: true,
    },
  }),
  getShellProfile: () => ({
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'],
    supportsPersistent: true,
  }),
  getDefaultShell: () => 'powershell',
  getEnhancedEnvironment: vi.fn().mockReturnValue({ Path: 'C:\\test\\bin;C:\\Windows' }),
}));

function createMcpConfig(): TerminalConfig {
  return {
    command: 'uvx',
    args: ['test-mcp-server'],
    cwd: 'C:\\Users\\test',
    type: 'mcp_transport',
    persistent: true,
  };
}

function createCommandConfig(): TerminalConfig {
  return {
    command: 'echo hello',
    args: [],
    cwd: 'C:\\Users\\test',
    type: 'command',
    shell: 'powershell',
  };
}

interface PreparableTerminal {
  prepareEnvironment(): Promise<Record<string, string>>;
}

describe('TerminalInstance prepareEnvironment lazy-runtime gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTerminalRuntimeBridge(bridge);
  });

  it('triggers ensureRuntimeForCommand for mcp_transport (app-managed runtime)', async () => {
    const instance = new McpTransportInstance(createMcpConfig());
    const env = await (instance as unknown as PreparableTerminal).prepareEnvironment();

    expect(mockEnsureRuntimeForCommand).toHaveBeenCalledTimes(1);
    expect(mockEnsureRuntimeForCommand).toHaveBeenCalledWith('uvx', ['test-mcp-server']);
    expect(env).toBeDefined();
  });

  it('does NOT trigger ensureRuntimeForCommand for command type (non-mcp)', async () => {
    const instance = new CommandInstance(createCommandConfig());
    await (instance as unknown as PreparableTerminal).prepareEnvironment();

    expect(mockEnsureRuntimeForCommand).not.toHaveBeenCalled();
  });

  it('proceeds when ensureRuntimeForCommand rejects (install failure)', async () => {
    mockEnsureRuntimeForCommand.mockRejectedValueOnce(new Error('install failed'));
    const instance = new McpTransportInstance(createMcpConfig());

    // Should not throw — the catch in prepareEnvironment swallows the error
    // so a botched install does not strand the whole MCP connect.
    const env = await (instance as unknown as PreparableTerminal).prepareEnvironment();
    expect(env).toBeDefined();
  });
});
