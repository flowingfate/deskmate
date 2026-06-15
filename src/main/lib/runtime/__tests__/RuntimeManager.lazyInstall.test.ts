/**
 * Tests for the P1 lazy-install model.
 *
 * Boot path no longer downloads bun / uv. The first MCP-transport spawn for a
 * given tool drives `ensureRuntimeForCommand`, which dispatches to the per-tool
 * install lock. Repeat calls coalesce.
 */
import * as fs from 'fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalToolType, RuntimeManager as RuntimeManagerClass } from '../RuntimeManager';

const { testUserData } = vi.hoisted(() => {
  const p = require('path');
  const o = require('os');
  return { testUserData: p.join(o.tmpdir(), 'deskmate-test-RuntimeManager-lazyInstall') };
});

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn().mockReturnValue(testUserData),
    getName: vi.fn().mockReturnValue('test-app'),
    isReady: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock('../../terminalManager', async () => ({
  getTerminalManager: vi.fn().mockReturnValue(null),
}));

vi.mock('node-stream-zip', async () => ({}));

vi.mock('../../featureFlags', async () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}));

const { mockEnsureShims } = vi.hoisted(() => ({ mockEnsureShims: vi.fn() }));
vi.mock('../shim', () => ({
  ensureShims: mockEnsureShims,
}));

import { RuntimeManager } from '../RuntimeManager';

afterAll(() => {
  fs.rmSync(testUserData, { recursive: true, force: true });
});

interface RuntimeManagerInternals {
  toolReadyPromises: Map<InternalToolType, Promise<void>>;
  detectRuntimeNeed(command: string, args: readonly string[]): InternalToolType | null;
  installRuntime(tool: InternalToolType, version: string): Promise<void>;
  binPath: string;
}

interface SingletonHolder {
  instance: RuntimeManagerClass | undefined;
}

describe('RuntimeManager.detectRuntimeNeed', () => {
  let manager: RuntimeManagerClass;
  let detect: (command: string, args?: readonly string[]) => InternalToolType | null;

  beforeEach(() => {
    (RuntimeManager as unknown as SingletonHolder).instance = undefined;
    manager = RuntimeManager.getInstance();
    const internals = manager as unknown as RuntimeManagerInternals;
    // Captured callback bound to the current manager instance — kept as a
    // closure so each `it` reads naturally without an extra cast inside.
    detect = (cmd, args = []) => internals.detectRuntimeNeed(cmd, args);
  });

  it('classifies node/npm/npx/bun as bun', () => {
    expect(detect('node')).toBe('bun');
    expect(detect('npm')).toBe('bun');
    expect(detect('npx')).toBe('bun');
    expect(detect('bun')).toBe('bun');
    // Path-prefixed and Windows variants normalize correctly.
    expect(detect('/usr/local/bin/node')).toBe('bun');
    expect(detect('npm.cmd')).toBe('bun');
    expect(detect('NODE.EXE')).toBe('bun');
  });

  it('classifies python/pip/uv/uvx as uv', () => {
    expect(detect('python')).toBe('uv');
    expect(detect('python3')).toBe('uv');
    expect(detect('pip')).toBe('uv');
    expect(detect('pip3')).toBe('uv');
    expect(detect('uv')).toBe('uv');
    expect(detect('uvx')).toBe('uv');
  });

  it('handles Windows `cmd /c <real-command>` wrapper', () => {
    expect(detect('cmd', ['/c', 'npx', 'pkg'])).toBe('bun');
    expect(detect('cmd.exe', ['/C', 'python', 'script.py'])).toBe('uv');
  });

  it('returns null for unknown commands', () => {
    expect(detect('docker')).toBeNull();
    expect(detect('echo', ['hello'])).toBeNull();
    expect(detect('cmd', ['/c', 'docker', 'run'])).toBeNull();
  });
});

describe('RuntimeManager.ensureRuntimeForCommand', () => {
  let manager: RuntimeManagerClass;
  let internals: RuntimeManagerInternals;

  beforeEach(() => {
    (RuntimeManager as unknown as SingletonHolder).instance = undefined;
    manager = RuntimeManager.getInstance();
    internals = manager as unknown as RuntimeManagerInternals;
  });

  it('is a noop in system mode even when command needs a runtime', async () => {
    vi.spyOn(manager, 'getRunTimeConfig').mockReturnValue({
      mode: 'system',
      bunVersion: '1.3.6',
      uvVersion: '0.6.17',
      pinnedPythonVersion: null,
    });
    const installSpy = vi.spyOn(internals, 'installRuntime').mockResolvedValue(undefined);
    // Defensive: even if the system-mode early return regressed, the cheap
    // path through ensureToolReady would still skip install when isInstalled
    // is true. Failing test then points at the early return, not at a runaway
    // download.
    vi.spyOn(manager, 'isInstalled').mockReturnValue(true);

    await manager.ensureRuntimeForCommand('python', []);
    expect(installSpy).not.toHaveBeenCalled();
  });

  it('returns immediately for unknown commands without scheduling install', async () => {
    const installSpy = vi.spyOn(internals, 'installRuntime').mockResolvedValue(undefined);

    await manager.ensureRuntimeForCommand('docker', ['run']);
    expect(installSpy).not.toHaveBeenCalled();
    expect(internals.toolReadyPromises.size).toBe(0);
  });

  it('skips install when the tool is already present', async () => {
    vi.spyOn(manager, 'isInstalled').mockReturnValue(true);
    const installSpy = vi.spyOn(internals, 'installRuntime').mockResolvedValue(undefined);
    mockEnsureShims.mockClear();

    await manager.ensureRuntimeForCommand('node', []);
    expect(installSpy).not.toHaveBeenCalled();
    // ensureShims is called as a cheap idempotent check.
    expect(mockEnsureShims).toHaveBeenCalled();
  });

  it('coalesces concurrent first-spawn calls into one install', async () => {
    vi.spyOn(manager, 'isInstalled').mockReturnValue(false);

    const gate = Promise.withResolvers<void>();
    const installSpy = vi.spyOn(internals, 'installRuntime').mockImplementation(() => gate.promise);

    const a = manager.ensureRuntimeForCommand('npx', ['some-pkg']);
    const b = manager.ensureRuntimeForCommand('node', ['index.js']);
    const c = manager.ensureRuntimeForCommand('npm', ['install']);

    // Same tool — same in-flight promise.
    expect(installSpy).toHaveBeenCalledTimes(1);

    gate.resolve();
    await Promise.all([a, b, c]);

    expect(installSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the cached promise on install failure to allow retry', async () => {
    vi.spyOn(manager, 'isInstalled').mockReturnValue(false);

    const installSpy = vi
      .spyOn(internals, 'installRuntime')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(undefined);

    await expect(manager.ensureRuntimeForCommand('node', [])).rejects.toThrow('network down');
    expect(internals.toolReadyPromises.has('bun')).toBe(false);

    // Second attempt: install retried.
    await manager.ensureRuntimeForCommand('node', []);
    expect(installSpy).toHaveBeenCalledTimes(2);
  });
});

describe('RuntimeManager.setRuntimeMode', () => {
  beforeEach(() => {
    (RuntimeManager as unknown as SingletonHolder).instance = undefined;
  });

  it('calls initializeInternalMode when switching to internal', async () => {
    const manager = RuntimeManager.getInstance();
    const spy = vi.spyOn(manager, 'initializeInternalMode');
    await manager.setRuntimeMode('internal');
    expect(spy).toHaveBeenCalled();
  });

  it('does not call initializeInternalMode when switching to system', async () => {
    const manager = RuntimeManager.getInstance();
    const spy = vi.spyOn(manager, 'initializeInternalMode');
    await manager.setRuntimeMode('system');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('RuntimeManager.getEnvWithInternalPath', () => {
  beforeEach(() => {
    (RuntimeManager as unknown as SingletonHolder).instance = undefined;
  });

  it('prepends binPath to PATH', () => {
    const manager = RuntimeManager.getInstance();
    const env = manager.getEnvWithInternalPath({ PATH: '/usr/bin' } as NodeJS.ProcessEnv);
    const binPath = (manager as unknown as RuntimeManagerInternals).binPath;
    expect(env['PATH']).toContain(binPath);
  });

  it('sets PYTHONUTF8 and PYTHONIOENCODING', () => {
    const manager = RuntimeManager.getInstance();
    const env = manager.getEnvWithInternalPath({ PATH: '/usr/bin' } as NodeJS.ProcessEnv);
    expect(env['PYTHONUTF8']).toBe('1');
    expect(env['PYTHONIOENCODING']).toBe('utf-8');
  });
});
