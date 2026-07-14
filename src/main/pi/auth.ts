/**
 * pi 路径的认证管理。每个 profile 一份 auth.pi.json，schema 见 PiAuthFile。
 *
 * 关键差异（vs. 旧 lib/auth/authManager）：
 * - 无全局单例：构造时绑定 profileId，profileCacheManager 之外的写穿透文件
 * - getApiKey 是热路径：每次 LLM 调用前都跑，命中内存缓存就直接返还
 * - refresh 在 getApiKey 内部完成，避免后台 monitor 与请求路径竞写 auth.json
 *
 * 不做的事：多账号同 provider；token 文件加密；后台主动刷新（pi 自带 expires
 * 时间，按需 refresh）。
 */

import * as fs from 'fs';
import * as path from 'path';

import type { OAuthCredentials } from '@earendil-works/pi-ai';
import { PI_AUTH_VERSION,
type PiAuthFile,
type ProviderAuth,
type ProviderAccountSummary, } from '@shared/persist/types'
import { PERSIST_PATH } from '@shared/persist/path';
import { getAppRoot } from '@main/persist/lib/root';

// 5 分钟安全垫：expires 比 now 多于这个值视为有效；少于则提前 refresh。
// 与 pi 内部 `expires_at*1000 - 5*60*1000` 的常数对齐。
const REFRESH_SKEW_MS = 60_000;

// 同 provider 并发 refresh 去重：第一个调用 refresh 时把 promise 存进 inflight，
// 后续调用复用同一 promise，避免连续 LLM 调用各自打一次刷新接口。
type InflightMap = Map<string, Promise<string>>;

export interface StartLoginCallbacks {
  onAuth?: (url: string, instructions?: string) => void;
  onDeviceCode?: (info: {
    userCode: string;
    verificationUri: string;
    intervalSeconds?: number;
    expiresInSeconds?: number;
  }) => void;
  onPrompt?: (prompt: { message: string; placeholder?: string; allowEmpty?: boolean }) => Promise<string>;
  onSelect?: (prompt: { message: string; options: Array<{ id: string; label: string }> }) => Promise<string | undefined>;
  onProgress?: (msg: string) => void;
  signal?: AbortSignal;
}

export class PiAuthManager {
  private cached: PiAuthFile | null = null;
  private readonly inflightRefresh: InflightMap = new Map();

  constructor(public readonly profileId: string) {}

  // ─── persistence ────────────────────────────────────────────────────────

  async load(): Promise<void> {
    const file = await readAuthFile(this.profileId);
    this.cached = file;
  }

  /** 已登录的 provider id 列表 */
  async listProviders(): Promise<ProviderAccountSummary[]> {
    await this.ensureLoaded();
    return Object.entries(this.cached!.providers).map(([provider, p]) => ({
      provider,
      type: p.type,
      ...(p.type === 'apiKey' && p.baseUrl ? { baseUrl: p.baseUrl } : {}),
    }));
  }

  /**
   * 取出 provider 当前可用的 API key。
   *
   * - apiKey 类：直接回原值
   * - oauth 类：expires 还在安全垫内就回原 token；过期则跑 refreshToken、回写
   *   auth.json、更新缓存
   * - 未登录：返回 null（不抛错；调用方决定是否引导登录）
   */
  async getApiKey(provider: string): Promise<string | null> {
    const creds = await this.getOAuthCredentials(provider);
    if (creds) return creds.access;

    await this.ensureLoaded();
    const entry = this.cached!.providers[provider];
    if (!entry) return null;
    if (entry.type === 'apiKey') return entry.apiKey;
    return null;
  }

  /** 取 apiKey provider 存储的自定义 baseUrl（用于 OpenAI/Anthropic 兼容厂商）。 */
  async getBaseUrl(provider: string): Promise<string | undefined> {
    await this.ensureLoaded();
    const entry = this.cached!.providers[provider];
    if (!entry || entry.type !== 'apiKey') return undefined;
    return entry.baseUrl;
  }

  /**
   * 取 provider 当前 fresh 的 OAuth credentials —— 与 `getApiKey` 共用 refresh /
   * inflight dedup 路径。apiKey-only provider / 未登录 → null（pi-ai 的
   * `provider.modifyModels(...)` 也只对 OAuth provider 有意义，apiKey 路径
   * 不需要 baseUrl 动态改写）。
   */
  async getOAuthCredentials(provider: string): Promise<OAuthCredentials | null> {
    await this.ensureLoaded();
    const entry = this.cached!.providers[provider];
    if (!entry || entry.type !== 'oauth') return null;

    const now = Date.now();
    if (entry.credentials.expires > now + REFRESH_SKEW_MS) {
      return entry.credentials;
    }

    // 过期 / 即将过期 → refresh。并发去重，避免一秒内多次 LLM 调用各自打刷新。
    await this.refreshProvider(provider);
    return this.cached!.providers[provider]?.type === 'oauth'
      ? (this.cached!.providers[provider] as Extract<ProviderAuth, { type: 'oauth' }>).credentials
      : null;
  }

  /**
   * device-code / 浏览器登录入口。pi 的 callbacks 不区分 onAuth/onDeviceCode
   * 是同一信号，这里直接转发。返回 promise 在登录完成或失败时 resolve/reject。
   */
  async startLogin(provider: string, callbacks: StartLoginCallbacks): Promise<void> {
    const oauth = await import('@earendil-works/pi-ai/oauth');
    const impl = oauth.getOAuthProvider(provider);
    if (!impl) throw new Error(`[pi/auth] Unknown OAuth provider: ${provider}`);

    const credentials = await impl.login({
      onAuth: (info: { url: string; instructions?: string }) => callbacks.onAuth?.(info.url, info.instructions),
      onDeviceCode: (info: { userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }) => callbacks.onDeviceCode?.(info),
      onPrompt: callbacks.onPrompt ?? (async () => {
        throw new Error('[pi/auth] onPrompt required but not provided');
      }),
      onSelect: callbacks.onSelect ?? (async () => undefined),
      onProgress: callbacks.onProgress,
      signal: callbacks.signal,
    });

    await this.writeProvider(provider, { type: 'oauth', credentials });
  }

  async setApiKey(provider: string, apiKey: string, baseUrl?: string): Promise<void> {
    if (!apiKey) throw new Error('[pi/auth] setApiKey: apiKey is empty');
    await this.writeProvider(provider, { type: 'apiKey', apiKey, ...(baseUrl ? { baseUrl } : {}) });
  }

  async logout(provider: string): Promise<void> {
    await this.ensureLoaded();
    if (!(provider in this.cached!.providers)) return;
    const next: PiAuthFile = {
      version: PI_AUTH_VERSION,
      providers: { ...this.cached!.providers },
    };
    delete next.providers[provider];
    await writeAuthFile(this.profileId, next);
    this.cached = next;
    this.inflightRefresh.delete(provider);
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private async ensureLoaded(): Promise<void> {
    if (!this.cached) await this.load();
  }

  /**
   * 跑 OAuth refresh + 回写 auth.json + 更新 cached。inflight dedup 保证一秒
   * 内多次 LLM 调用只打一次刷新。返回新 access token 字符串作 inflight 值，
   * 调用方需要完整 credentials 时直接读 `this.cached`（refresh 完一定已经
   * `writeProvider` 落地）。
   */
  private async refreshProvider(provider: string): Promise<string> {
    const existing = this.inflightRefresh.get(provider);
    if (existing) return existing;

    const promise = (async () => {
      const entry = this.cached!.providers[provider];
      if (!entry || entry.type !== 'oauth') {
        throw new Error(`[pi/auth] Cannot refresh non-oauth provider: ${provider}`);
      }
      const oauth = await import('@earendil-works/pi-ai/oauth');
      const impl = oauth.getOAuthProvider(provider);
      if (!impl) throw new Error(`[pi/auth] Unknown OAuth provider: ${provider}`);

      const fresh = await impl.refreshToken(entry.credentials);
      await this.writeProvider(provider, { type: 'oauth', credentials: fresh });
      return fresh.access;
    })().finally(() => {
      this.inflightRefresh.delete(provider);
    });

    this.inflightRefresh.set(provider, promise);
    return promise;
  }

  private async writeProvider(provider: string, entry: ProviderAuth): Promise<void> {
    await this.ensureLoaded();
    const next: PiAuthFile = {
      version: PI_AUTH_VERSION,
      providers: { ...this.cached!.providers, [provider]: entry },
    };
    await writeAuthFile(this.profileId, next);
    this.cached = next;
  }
}

// ─── file io ──────────────────────────────────────────────────────────────

function profilePath(profileId: string): string {
  return PERSIST_PATH.piAuthFile(getAppRoot(), profileId);
}

async function readAuthFile(profileId: string): Promise<PiAuthFile> {
  const fp = profilePath(profileId);
  try {
    const raw = await fs.promises.readFile(fp, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: unknown; providers?: unknown };
    if (parsed.version !== PI_AUTH_VERSION || typeof parsed.providers !== 'object' || !parsed.providers) {
      // 旧 schema（V3 等）或损坏：视为未登录。不读旧字段。
      return emptyAuthFile();
    }
    return parsed as PiAuthFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyAuthFile();
    throw err;
  }
}

async function writeAuthFile(profileId: string, file: PiAuthFile): Promise<void> {
  const fp = profilePath(profileId);
  await fs.promises.mkdir(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(file, null, 2), 'utf-8');
  await fs.promises.rename(tmp, fp);
}

function emptyAuthFile(): PiAuthFile {
  return { version: PI_AUTH_VERSION, providers: {} };
}

// ─── singleton registry ──────────────────────────────────────────────────
// 每个 profileId 一个实例：保证内存缓存 + inflightRefresh map 不串号。

const managers = new Map<string, PiAuthManager>();

export function getPiAuthManager(profileId: string): PiAuthManager {
  let m = managers.get(profileId);
  if (!m) {
    m = new PiAuthManager(profileId);
    managers.set(profileId, m);
  }
  return m;
}

/** 仅测试用 */
export function __resetPiAuthManagers(): void {
  managers.clear();
}
