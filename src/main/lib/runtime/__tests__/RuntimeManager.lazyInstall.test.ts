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

vi.mock('../../terminal', async () => ({
  terminalManager: { run: vi.fn() },
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
import { detectRuntimeNeed } from '../commandClassifier';

afterAll(() => {
  fs.rmSync(testUserData, { recursive: true, force: true });
});

interface RuntimeManagerInternals {
  toolReadyPromises: Map<InternalToolType, Promise<void>>;
  installRuntime(tool: InternalToolType, version: string): Promise<void>;
  binPath: string;
}

interface SingletonHolder {
  instance: RuntimeManagerClass | undefined;
}

describe('detectRuntimeNeed', () => {
  const detect = (command: string, args: readonly string[] = []): InternalToolType | null =>
    detectRuntimeNeed(command, args);

  it('classifies node/npm/npx/bun/bunx as bun', () => {
    expect(detect('node')).toBe('bun');
    expect(detect('npm')).toBe('bun');
    expect(detect('npx')).toBe('bun');
    expect(detect('bun')).toBe('bun');
    expect(detect('bunx')).toBe('bun');
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
