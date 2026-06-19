import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OAuthCredentials } from '@earendil-works/pi-ai';

const getApiKeyMock = vi.fn<(provider: string) => Promise<string | null>>();
const getOAuthCredentialsMock = vi.fn<(provider: string) => Promise<OAuthCredentials | null>>();
const getBaseUrlMock = vi.fn<(provider: string) => Promise<string | undefined>>();
vi.mock('../auth', () => ({
  getPiAuthManager: vi.fn(() => ({
    getApiKey: getApiKeyMock,
    getOAuthCredentials: getOAuthCredentialsMock,
    getBaseUrl: getBaseUrlMock,
  })),
}));

// `@earendil-works/pi-ai/oauth` 子路径在 resolveCredentials 内动态 import；用
// vi.mock 把 getOAuthProvider 替换成可控的 mock，模拟 pi-ai 的 modifyModels
// hook（GHC：从 OAuth access token 里 proxy-ep 字段派生 baseUrl）。
const modifyModelsMock = vi.fn();
const getOAuthProviderMock = vi.fn();
vi.mock('@earendil-works/pi-ai/oauth', () => ({
  getOAuthProvider: (id: string) => getOAuthProviderMock(id),
}));

import { resolveModel, resolveApiKey, resolveCredentials, listModels, getModelInfo, type ResolvedModel } from '../model';

beforeEach(() => {
  vi.clearAllMocks();
  getOAuthCredentialsMock.mockResolvedValue(null);
  getBaseUrlMock.mockResolvedValue(undefined);
  getOAuthProviderMock.mockReturnValue(undefined);
  modifyModelsMock.mockReset();
});

// 所有 provider 都走 pi-ai 内置 model 表（github-copilot 也不例外）。
// 这些测试用 pi-ai 真实数据（编译时常量），版本变化时如果 pi-ai 重命名了
// 模型 id，需要更新这里的 fixture。

describe('resolveModel', () => {
  it('已知 model → pi.Model', async () => {
    const m = await resolveModel({ provider: 'openai-codex', modelId: 'gpt-5.5' });
    expect(m.provider).toBe('openai-codex');
    expect(m.id).toBe('gpt-5.5');
  });

  it('github-copilot 走 pi-ai 内置表', async () => {
    const m = await resolveModel({ provider: 'github-copilot', modelId: 'claude-sonnet-4.6' });
    expect(m.provider).toBe('github-copilot');
    expect(m.id).toBe('claude-sonnet-4.6');
  });

  it('未知 modelId → 抛错', async () => {
    await expect(resolveModel({ provider: 'github-copilot', modelId: 'definitely-not-a-model' }))
      .rejects.toThrow(/Unknown model "definitely-not-a-model" under provider "github-copilot"/);
  });

  it('未知 provider → 抛错', async () => {
    await expect(resolveModel({ provider: 'made-up-provider', modelId: 'whatever' }))
      .rejects.toThrow(/Unknown model "whatever" under provider "made-up-provider"/);
  });
});

describe('resolveApiKey', () => {
  let sampleModel: Awaited<ReturnType<typeof resolveModel>>;

  beforeEach(async () => {
    sampleModel = await resolveModel({ provider: 'github-copilot', modelId: 'claude-sonnet-4.6' });
    vi.clearAllMocks();
    // describe-level beforeEach clears the top-level mock default; restore it
    // so OAuth-path branch in resolveCredentials stays inactive for these
    // apiKey-only tests.
    getOAuthCredentialsMock.mockResolvedValue(null);
    getBaseUrlMock.mockResolvedValue(undefined);
  });

  it('PiAuthManager 返回 token → 直接透传', async () => {
    getApiKeyMock.mockResolvedValueOnce('tok_pi');
    expect(await resolveApiKey(sampleModel, 'alice')).toBe('tok_pi');
    expect(getApiKeyMock).toHaveBeenCalledWith('github-copilot');
  });

  it('PiAuthManager 返回 null → 抛错引导登录', async () => {
    getApiKeyMock.mockResolvedValueOnce(null);
    await expect(resolveApiKey(sampleModel, 'alice'))
      .rejects.toThrow(/No credentials for provider "github-copilot"/);
  });

  it('PiAuthManager 抛错（refresh 失败）→ 透传错误', async () => {
    getApiKeyMock.mockRejectedValueOnce(new Error('refresh boom'));
    await expect(resolveApiKey(sampleModel, 'alice')).rejects.toThrow(/refresh boom/);
  });

  it('按 model.provider 查 PiAuthManager（不是写死 github-copilot）', async () => {
    const fake = { ...sampleModel, provider: 'anthropic' };
    getApiKeyMock.mockResolvedValueOnce('sk-ant');
    expect(await resolveApiKey(fake, 'alice')).toBe('sk-ant');
    expect(getApiKeyMock).toHaveBeenCalledWith('anthropic');
  });
});

describe('resolveCredentials', () => {
  let sampleGhcModel: Awaited<ReturnType<typeof resolveModel>>;
  let sampleAnthropicModel: Awaited<ReturnType<typeof resolveModel>>;

  beforeEach(async () => {
    sampleGhcModel = await resolveModel({ provider: 'github-copilot', modelId: 'claude-sonnet-4.6' });
    sampleAnthropicModel = await resolveModel({ provider: 'anthropic', modelId: 'claude-3-5-haiku-latest' });
    vi.clearAllMocks();
    // 复位 top-level beforeEach 设的 defaults（vi.clearAllMocks 把它们清了）
    getOAuthCredentialsMock.mockResolvedValue(null);
    getOAuthProviderMock.mockReturnValue(undefined);
    getBaseUrlMock.mockResolvedValue(undefined);
  });

  it('OAuth provider 有 modifyModels hook → baseUrl 被 fresh credentials 改写', async () => {
    // 模拟 pi-ai GHC oauth provider 的 modifyModels：从 access token 派生
    // baseUrl（真实实现是解析 token 里的 proxy-ep 字段，这里直接用 mock 值）。
    const creds: OAuthCredentials = {
      refresh: 'r-ghu',
      access: 'tid=xx;proxy-ep=proxy.enterprise.githubcopilot.com;sku=enterprise',
      expires: Date.now() + 600_000,
    };
    getOAuthCredentialsMock.mockResolvedValueOnce(creds);
    getOAuthProviderMock.mockReturnValueOnce({
      id: 'github-copilot',
      modifyModels: (models: any[], _c: OAuthCredentials) =>
        models.map((m) => ({ ...m, baseUrl: 'https://api.enterprise.githubcopilot.com' })),
    });

    const result = await resolveCredentials(sampleGhcModel, 'alice');

    expect(result.apiKey).toBe(creds.access);
    expect(result.model.baseUrl).toBe('https://api.enterprise.githubcopilot.com');
    // 原 model 不被 mutate（pi-ai modifyModels 返回的是不可变副本）
    expect(sampleGhcModel.baseUrl).not.toBe('https://api.enterprise.githubcopilot.com');
    expect(getOAuthProviderMock).toHaveBeenCalledWith('github-copilot');
  });

  it('OAuth provider 无 modifyModels hook → 原 model 透传', async () => {
    const creds: OAuthCredentials = {
      refresh: 'r-ant',
      access: 'sk-ant-oat-xxx',
      expires: Date.now() + 600_000,
    };
    const originalBaseUrl = sampleAnthropicModel.baseUrl;
    getOAuthCredentialsMock.mockResolvedValueOnce(creds);
    getOAuthProviderMock.mockReturnValueOnce({
      id: 'anthropic',
      // 没有 modifyModels 字段
    });

    const result = await resolveCredentials(sampleAnthropicModel, 'alice');

    expect(result.apiKey).toBe(creds.access);
    expect(result.model.baseUrl).toBe(originalBaseUrl);
    expect(result.model).toBe(sampleAnthropicModel); // 同一引用，未派生副本
  });

  it('OAuth provider impl 找不到 → 仍然返回 apiKey + 原 model（防御）', async () => {
    const creds: OAuthCredentials = {
      refresh: 'r', access: 'a', expires: Date.now() + 600_000,
    };
    getOAuthCredentialsMock.mockResolvedValueOnce(creds);
    getOAuthProviderMock.mockReturnValueOnce(undefined);

    const result = await resolveCredentials(sampleGhcModel, 'alice');

    expect(result.apiKey).toBe('a');
    expect(result.model).toBe(sampleGhcModel);
  });

  it('apiKey-only provider → 走 getApiKey，model 原样', async () => {
    // OAuth 路径返回 null → fallback 到 getApiKey
    getOAuthCredentialsMock.mockResolvedValueOnce(null);
    getApiKeyMock.mockResolvedValueOnce('sk-direct');

    const result = await resolveCredentials(sampleAnthropicModel, 'alice');

    expect(result.apiKey).toBe('sk-direct');
    expect(result.model).toBe(sampleAnthropicModel);
    expect(getApiKeyMock).toHaveBeenCalledWith('anthropic');
    // 没 OAuth credentials → 不会去查 oauth provider 注册表
    expect(getOAuthProviderMock).not.toHaveBeenCalled();
  });

  it('OAuth 和 apiKey 都没有 → 抛错引导登录', async () => {
    getOAuthCredentialsMock.mockResolvedValueOnce(null);
    getApiKeyMock.mockResolvedValueOnce(null);

    await expect(resolveCredentials(sampleGhcModel, 'alice'))
      .rejects.toThrow(/No credentials for provider "github-copilot"/);
  });

  it('每次调用都重新取 fresh credentials（不缓存）—— turn loop 跨过期点的关键', async () => {
    const creds1: OAuthCredentials = {
      refresh: 'r', access: 'a1', expires: Date.now() + 600_000,
    };
    const creds2: OAuthCredentials = {
      refresh: 'r', access: 'a2', expires: Date.now() + 600_000,
    };
    let callIdx = 0;
    getOAuthCredentialsMock.mockImplementation(async () => (++callIdx === 1 ? creds1 : creds2));
    getOAuthProviderMock.mockReturnValue({
      id: 'github-copilot',
      modifyModels: (models: any[], c: OAuthCredentials) =>
        models.map((m) => ({ ...m, baseUrl: `https://api/${c.access}` })),
    });

    const r1 = await resolveCredentials(sampleGhcModel, 'alice');
    const r2 = await resolveCredentials(sampleGhcModel, 'alice');
    expect(r1.apiKey).toBe('a1');
    expect(r2.apiKey).toBe('a2');
    expect(r1.model.baseUrl).toBe('https://api/a1');
    expect(r2.model.baseUrl).toBe('https://api/a2');
  });
});

describe('listModels', () => {
  it('github-copilot → pi-ai 内置 20 个 model', async () => {
    const list = await listModels('github-copilot');
    expect(list.length).toBeGreaterThan(0);
    for (const r of list) {
      expect(r.model.provider).toBe('github-copilot');
      // capabilities.tools 固定 true（pi.Model 不暴露 tool 能力）
      expect(r.capabilities.tools).toBe(true);
    }
    // 抽样验证白名单内的核心模型存在
    const ids = list.map((r) => r.model.id);
    expect(ids).toContain('claude-sonnet-4.6');
  });

  it('openai-codex → pi-ai 内置表；所有 model 都属于该 provider', async () => {
    const list = await listModels('openai-codex');
    expect(list.length).toBeGreaterThan(0);
    for (const r of list) {
      expect(r.model.provider).toBe('openai-codex');
    }
  });

  it('未知 provider → 空数组（pi-ai 找不到时返 []）', async () => {
    const list = await listModels('made-up-provider');
    expect(list).toEqual([]);
  });
});

describe('getModelInfo', () => {
  it('已知 model → 完整 ResolvedModel', async () => {
    const info = await getModelInfo({ provider: 'github-copilot', modelId: 'claude-sonnet-4.6' });
    expect(info).not.toBeNull();
    const r = info as ResolvedModel;
    expect(r.model.id).toBe('claude-sonnet-4.6');
    expect(r.capabilities.contextWindow).toBeGreaterThan(0);
    expect(r.capabilities.maxTokens).toBeGreaterThan(0);
    expect(r.capabilities.tools).toBe(true);
  });

  it('未知 model → null（不抛错，与 IPC "找不到返回 data:null" 语义一致）', async () => {
    const info = await getModelInfo({ provider: 'openai-codex', modelId: 'does-not-exist' });
    expect(info).toBeNull();
  });

  it('reasoning model → reasoningLevels 非空且不含 off', async () => {
    // 找一个 pi-ai 里带 reasoning 的 model；anthropic claude-sonnet-4-5 通常带
    // thinkingLevelMap。pi-ai 版本变更后若 id 改了，把候选挪到此处即可。
    const candidates = [
      { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929' },
      { provider: 'openai', modelId: 'o3' },
      { provider: 'openai', modelId: 'gpt-5' },
    ];
    let found: ResolvedModel | null = null;
    for (const c of candidates) {
      const r = await getModelInfo(c);
      if (r?.capabilities.reasoning) { found = r; break; }
    }
    if (!found) return; // pi-ai 版本变化或这些 model 都不在内置表里；跳过
    expect(found.capabilities.reasoningLevels.length).toBeGreaterThan(0);
    expect(found.capabilities.reasoningLevels).not.toContain('off' as never);
  });

  it('非 reasoning model → reasoningLevels 为空数组', async () => {
    const info = await getModelInfo({ provider: 'github-copilot', modelId: 'gpt-4o' });
    if (!info) return; // pi-ai 版本变化时 gpt-4o 可能不在；跳过
    if (info.capabilities.reasoning) return; // 万一 pi-ai 给 gpt-4o 标 reasoning，跳过
    expect(info.capabilities.reasoningLevels).toEqual([]);
  });
});
