import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import type { OAuthCredentials } from '@earendil-works/pi-ai';

const tmpRoot = path.join(os.tmpdir(), `pi-auth-test-${Date.now()}`);

vi.mock('electron', async () => {
  const actual = await vi.importActual<typeof import('electron')>('electron');
  return {
    ...actual,
    app: { ...actual.app, getPath: vi.fn(() => tmpRoot) },
  };
});

const refreshMock = vi.fn<(creds: OAuthCredentials) => Promise<OAuthCredentials>>();
const loginMock = vi.fn();

vi.mock('@earendil-works/pi-ai/oauth', () => ({
  getOAuthProvider: vi.fn((id: string) => {
    if (id !== 'github-copilot') return undefined;
    return {
      id: 'github-copilot',
      name: 'GitHub Copilot',
      login: loginMock,
      refreshToken: refreshMock,
      getApiKey: (c: OAuthCredentials) => c.access,
    };
  }),
}));

import { PiAuthManager, __resetPiAuthManagers } from '../auth';
import { setRootForTesting } from '@main/persist/lib/root';
import { PI_AUTH_VERSION, type PiAuthFile } from '@shared/types/piAuthTypes';

const USER = 'alice';
const AUTH_PATH = path.join(tmpRoot, 'profiles', USER, 'auth.pi.json');

async function writeFile(file: PiAuthFile | Record<string, unknown>) {
  await fs.promises.mkdir(path.dirname(AUTH_PATH), { recursive: true });
  await fs.promises.writeFile(AUTH_PATH, JSON.stringify(file, null, 2));
}

async function readFile(): Promise<PiAuthFile> {
  return JSON.parse(await fs.promises.readFile(AUTH_PATH, 'utf-8'));
}

beforeEach(async () => {
  refreshMock.mockReset();
  loginMock.mockReset();
  __resetPiAuthManagers();
  // auth.ts 走 PERSIST_PATH.piAuthFile(getAppRoot(), profileId) 拼路径。
  // electron mock 还在，但 persist/lib/root.ts 优先用 setRootForTesting 注入的值，
  // 避免 vitest worker 里 require('electron') 拿到的 app.getPath 是空。
  setRootForTesting(tmpRoot);
  await fs.promises.rm(tmpRoot, { recursive: true, force: true });
});

afterEach(async () => {
  setRootForTesting(null);
  await fs.promises.rm(tmpRoot, { recursive: true, force: true });
});

describe('PiAuthManager.load + listProviders', () => {
  it('returns empty when auth.json absent', async () => {
    const m = new PiAuthManager(USER);
    await m.load();
    expect(await m.listProviders()).toEqual([]);
  });

  it('returns empty for legacy V3 schema (version != pi-v1)', async () => {
    await writeFile({ version: '3.0.0', authProvider: 'ghc', ghcAuth: {} });
    const m = new PiAuthManager(USER);
    expect(await m.listProviders()).toEqual([]);
  });

  it('reads pi-v1 providers', async () => {
    await writeFile({
      version: PI_AUTH_VERSION,
      providers: {
        'github-copilot': {
          type: 'oauth',
          credentials: { refresh: 'r', access: 'a', expires: Date.now() + 600_000 },
        },
        anthropic: { type: 'apiKey', apiKey: 'sk-xxx' },
      },
    });
    const m = new PiAuthManager(USER);
    const list = await m.listProviders();
    expect(list).toEqual(expect.arrayContaining([
      { provider: 'github-copilot', type: 'oauth' },
      { provider: 'anthropic', type: 'apiKey' },
    ]));
  });
});

describe('PiAuthManager.getApiKey', () => {
  it('returns null for unknown provider', async () => {
    const m = new PiAuthManager(USER);
    expect(await m.getApiKey('github-copilot')).toBeNull();
  });

  it('returns apiKey directly for apiKey provider', async () => {
    await writeFile({
      version: PI_AUTH_VERSION,
      providers: { anthropic: { type: 'apiKey', apiKey: 'sk-aaa' } },
    });
    const m = new PiAuthManager(USER);
    expect(await m.getApiKey('anthropic')).toBe('sk-aaa');
  });

  it('returns cached access when not expired', async () => {
    await writeFile({
      version: PI_AUTH_VERSION,
      providers: {
        'github-copilot': {
          type: 'oauth',
          credentials: { refresh: 'r1', access: 'a1', expires: Date.now() + 10 * 60_000 },
        },
      },
    });
    const m = new PiAuthManager(USER);
    expect(await m.getApiKey('github-copilot')).toBe('a1');
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('refreshes when expired and persists new credentials', async () => {
    await writeFile({
      version: PI_AUTH_VERSION,
      providers: {
        'github-copilot': {
          type: 'oauth',
          credentials: { refresh: 'r1', access: 'a-old', expires: Date.now() - 1000 },
        },
      },
    });
    refreshMock.mockResolvedValueOnce({ refresh: 'r1', access: 'a-new', expires: Date.now() + 600_000 });

    const m = new PiAuthManager(USER);
    expect(await m.getApiKey('github-copilot')).toBe('a-new');
    expect(refreshMock).toHaveBeenCalledTimes(1);

    const persisted = await readFile();
    expect((persisted.providers['github-copilot'] as { credentials: OAuthCredentials }).credentials.access).toBe('a-new');
  });

  it('deduplicates concurrent refreshes', async () => {
    await writeFile({
      version: PI_AUTH_VERSION,
      providers: {
        'github-copilot': {
          type: 'oauth',
          credentials: { refresh: 'r1', access: 'a-old', expires: Date.now() - 1000 },
        },
      },
    });
    let resolveRefresh!: (c: OAuthCredentials) => void;
    refreshMock.mockReturnValueOnce(new Promise<OAuthCredentials>((res) => { resolveRefresh = res; }));

    const m = new PiAuthManager(USER);
    const p1 = m.getApiKey('github-copilot');
    const p2 = m.getApiKey('github-copilot');
    resolveRefresh({ refresh: 'r1', access: 'a-new', expires: Date.now() + 600_000 });
    expect(await p1).toBe('a-new');
    expect(await p2).toBe('a-new');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

describe('PiAuthManager.getOAuthCredentials', () => {
  it('returns null for unknown provider', async () => {
    const m = new PiAuthManager(USER);
    expect(await m.getOAuthCredentials('github-copilot')).toBeNull();
  });

  it('returns null for apiKey-only provider (apiKey 路径无 modifyModels 语义)', async () => {
    await writeFile({
      version: PI_AUTH_VERSION,
      providers: { anthropic: { type: 'apiKey', apiKey: 'sk-x' } },
    });
    const m = new PiAuthManager(USER);
    expect(await m.getOAuthCredentials('anthropic')).toBeNull();
  });

  it('returns full credentials object when not expired (含 provider 自定义字段)', async () => {
    await writeFile({
      version: PI_AUTH_VERSION,
      providers: {
        'github-copilot': {
          type: 'oauth',
          credentials: {
            refresh: 'r1',
            access: 'a1',
            expires: Date.now() + 10 * 60_000,
            enterpriseUrl: 'foo.ghe.com',
          },
        },
      },
    });
    const m = new PiAuthManager(USER);
    const creds = await m.getOAuthCredentials('github-copilot');
    expect(creds).toMatchObject({
      refresh: 'r1',
      access: 'a1',
      enterpriseUrl: 'foo.ghe.com',
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('refreshes when expired and returns fresh credentials', async () => {
    await writeFile({
      version: PI_AUTH_VERSION,
      providers: {
        'github-copilot': {
          type: 'oauth',
          credentials: { refresh: 'r1', access: 'a-old', expires: Date.now() - 1000 },
        },
      },
    });
    refreshMock.mockResolvedValueOnce({ refresh: 'r1', access: 'a-new', expires: Date.now() + 600_000 });

    const m = new PiAuthManager(USER);
    const creds = await m.getOAuthCredentials('github-copilot');
    expect(creds?.access).toBe('a-new');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

describe('PiAuthManager.setApiKey / logout / startLogin', () => {
  it('setApiKey writes auth.json', async () => {
    const m = new PiAuthManager(USER);
    await m.setApiKey('anthropic', 'sk-bbb');
    const file = await readFile();
    expect(file.providers.anthropic).toEqual({ type: 'apiKey', apiKey: 'sk-bbb' });
  });

  it('setApiKey rejects empty key', async () => {
    const m = new PiAuthManager(USER);
    await expect(m.setApiKey('anthropic', '')).rejects.toThrow();
  });

  it('logout removes provider entry; idempotent', async () => {
    await writeFile({
      version: PI_AUTH_VERSION,
      providers: { anthropic: { type: 'apiKey', apiKey: 'x' } },
    });
    const m = new PiAuthManager(USER);
    await m.logout('anthropic');
    expect((await readFile()).providers).toEqual({});
    await expect(m.logout('anthropic')).resolves.toBeUndefined();
  });

  it('startLogin forwards callbacks and persists credentials', async () => {
    const creds: OAuthCredentials = { refresh: 'r', access: 'a', expires: Date.now() + 600_000 };
    loginMock.mockImplementationOnce(async (cb: any) => {
      cb.onDeviceCode({ userCode: 'AB12', verificationUri: 'https://x' });
      cb.onProgress?.('working');
      return creds;
    });
    const m = new PiAuthManager(USER);
    const onDeviceCode = vi.fn();
    const onProgress = vi.fn();
    await m.startLogin('github-copilot', { onDeviceCode, onProgress });
    expect(onDeviceCode).toHaveBeenCalledWith({ userCode: 'AB12', verificationUri: 'https://x' });
    expect(onProgress).toHaveBeenCalledWith('working');
    const file = await readFile();
    expect((file.providers['github-copilot'] as { type: string }).type).toBe('oauth');
  });

  it('startLogin throws on unknown provider', async () => {
    const m = new PiAuthManager(USER);
    await expect(m.startLogin('does-not-exist', {})).rejects.toThrow();
  });
});
