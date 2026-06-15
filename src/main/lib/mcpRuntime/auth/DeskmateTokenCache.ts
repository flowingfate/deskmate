/**
 * DeskmateTokenCache
 *
 * Browser auth token cache with an in-memory mirror plus profile-scoped
 * persistence. The cache is written under the active Deskmate profile so the
 * next app launch can reuse access tokens and refresh metadata before
 * re-entering browser auth.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '@main/log';
// profile 永远存在；token cache 只关心写盘根目录，认证态由 pi/auth 自己管。
import { Profiles } from '@main/persist';
import { PERSIST_PATH } from '@shared/persist/path';
import { getAppRoot } from '@main/persist/lib/root';

const logger = log;

const CACHE_VERSION = 1 as const;
const CACHE_FILE_NAME = 'browserAuthTokenCache';
const FALLBACK_FILE_NAME = `${CACHE_FILE_NAME}.json`;

type SafeStorageLike = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

export type TokenCacheResource = 'graph' | 'chatsvc' | 'skypeApi' | 'substrate';

export interface PersistedTokenInfo {
  accessToken: string;
  expiresAt: number;
}

export interface PersistedRefreshInfo {
  refreshToken: string;
  clientId: string;
  homeAccountId: string;
  tenantId: string;
  environment?: string;
  refreshTokenKey?: string;
}

export interface PersistedAccountInfo {
  upn?: string | null;
  tenantId?: string | null;
  userMri?: string | null;
}

export interface PersistedRegionInfo {
  region?: string;
  chatServiceUrl?: string;
  csaServiceUrl?: string;
  teamsBaseUrl?: string;
}

/**
 * OAuth credential record for a single MCP server.
 * Stored under `DeskmateTokenCacheData.mcpOAuth` keyed by the value returned by
 * `getMcpOAuthServerKey(name, cfg)` so that renaming or reconfiguring a
 * server invalidates the slot automatically.
 *
 * `accessToken` is allowed to be empty when only DCR client information has
 * been written (between SDK's `saveClientInformation` and `saveTokens`
 * calls). Consumers should treat `accessToken === ''` as "no usable token".
 */
export interface PersistedMcpOAuthEntry {
  serverName: string;
  serverUrl: string;
  /** Empty string means "no usable access token yet" (e.g. DCR completed but PKCE not yet finished). */
  accessToken: string;
  refreshToken?: string;
  /** Unix epoch milliseconds. 0 means "no usable access token". */
  expiresAt: number;
  scope?: string;
  /** Pre-configured or DCR-issued client id. */
  clientId?: string;
  /** Optional client secret for confidential clients. */
  clientSecret?: string;
  /** Cached OAuth metadata to skip re-discovery on refresh. URL-only to avoid keychain bloat. */
  discoveryState?: {
    authorizationServerUrl: string;
    resourceMetadataUrl?: string;
  };
  /** Scope cached from a 403 insufficient_scope response, used on the next interactive flow. */
  stepUpScope?: string;
}

export interface DeskmateTokenCacheData {
  version: typeof CACHE_VERSION;
  account?: PersistedAccountInfo;
  graph?: PersistedTokenInfo;
  chatsvc?: PersistedTokenInfo;
  skypeApi?: PersistedTokenInfo;
  substrate?: PersistedTokenInfo;
  azureDevOps?: PersistedTokenInfo;
  refresh?: PersistedRefreshInfo;
  region?: PersistedRegionInfo;
  /**
   * OAuth credentials for non-Microsoft MCP servers. Keyed by
   * `getMcpOAuthServerKey()`. Profile-scoped by way of the cache file's
   * profile-scoped path.
   */
  mcpOAuth?: Record<string, PersistedMcpOAuthEntry>;
  updatedAt: number;
}

export interface TokenCacheSnapshotInput {
  account?: PersistedAccountInfo | null;
  graph?: PersistedTokenInfo | null;
  chatsvc?: PersistedTokenInfo | null;
  skypeApi?: PersistedTokenInfo | null;
  substrate?: PersistedTokenInfo | null;
  azureDevOps?: PersistedTokenInfo | null;
  refresh?: PersistedRefreshInfo | null;
  region?: PersistedRegionInfo | null;
}

function resolveSafeStorage(): SafeStorageLike | null {
  try {
    // Use a runtime require so Jest/node tests can load this module without Electron.
    return require('electron').safeStorage as SafeStorageLike;
  } catch {
    return null;
  }
}

function cloneCache(data: DeskmateTokenCacheData): DeskmateTokenCacheData {
  return JSON.parse(JSON.stringify(data)) as DeskmateTokenCacheData;
}

function normalizeCacheData(value: unknown): DeskmateTokenCacheData | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<DeskmateTokenCacheData>;
  if (raw.version !== CACHE_VERSION) return null;
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) return null;

  const normalized: DeskmateTokenCacheData = {
    version: CACHE_VERSION,
    updatedAt: raw.updatedAt,
  };

  const account = normalizeAccount(raw.account);
  const graph = normalizeToken(raw.graph);
  const chatsvc = normalizeToken(raw.chatsvc);
  const skypeApi = normalizeToken(raw.skypeApi);
  const substrate = normalizeToken(raw.substrate);
  const azureDevOps = normalizeToken(raw.azureDevOps);
  const refresh = normalizeRefresh(raw.refresh);
  const region = normalizeRegion(raw.region);
  const mcpOAuth = normalizeMcpOAuthMap(raw.mcpOAuth);

  if (account) normalized.account = account;
  if (graph) normalized.graph = graph;
  if (chatsvc) normalized.chatsvc = chatsvc;
  if (skypeApi) normalized.skypeApi = skypeApi;
  if (substrate) normalized.substrate = substrate;
  if (azureDevOps) normalized.azureDevOps = azureDevOps;
  if (refresh) normalized.refresh = refresh;
  if (region) normalized.region = region;
  if (mcpOAuth) normalized.mcpOAuth = mcpOAuth;

  return normalized;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeToken(value: unknown): PersistedTokenInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const token = value as PersistedTokenInfo;
  if (!isNonEmptyString(token.accessToken) || typeof token.expiresAt !== 'number' || !Number.isFinite(token.expiresAt)) {
    return undefined;
  }
  return {
    accessToken: token.accessToken,
    expiresAt: token.expiresAt,
  };
}

function normalizeRefresh(value: unknown): PersistedRefreshInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const refresh = value as PersistedRefreshInfo;
  if (
    !isNonEmptyString(refresh.refreshToken) ||
    !isNonEmptyString(refresh.clientId) ||
    !isNonEmptyString(refresh.homeAccountId) ||
    !isNonEmptyString(refresh.tenantId)
  ) {
    return undefined;
  }

  return {
    refreshToken: refresh.refreshToken,
    clientId: refresh.clientId,
    homeAccountId: refresh.homeAccountId,
    tenantId: refresh.tenantId,
    environment: isNonEmptyString(refresh.environment) ? refresh.environment : undefined,
    refreshTokenKey: isNonEmptyString(refresh.refreshTokenKey) ? refresh.refreshTokenKey : undefined,
  };
}

function normalizeAccount(value: unknown): PersistedAccountInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const account = value as PersistedAccountInfo;
  const normalized: PersistedAccountInfo = {
    upn: isNonEmptyString(account.upn) ? account.upn : null,
    tenantId: isNonEmptyString(account.tenantId) ? account.tenantId : null,
    userMri: isNonEmptyString(account.userMri) ? account.userMri : null,
  };

  if (!normalized.upn && !normalized.tenantId && !normalized.userMri) {
    return undefined;
  }

  return normalized;
}

function normalizeRegion(value: unknown): PersistedRegionInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const region = value as PersistedRegionInfo;
  const normalized: PersistedRegionInfo = {};

  if (isNonEmptyString(region.region)) normalized.region = region.region;
  if (isNonEmptyString(region.chatServiceUrl)) normalized.chatServiceUrl = region.chatServiceUrl;
  if (isNonEmptyString(region.csaServiceUrl)) normalized.csaServiceUrl = region.csaServiceUrl;
  if (isNonEmptyString(region.teamsBaseUrl)) normalized.teamsBaseUrl = region.teamsBaseUrl;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeMcpOAuthEntry(value: unknown): PersistedMcpOAuthEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Partial<PersistedMcpOAuthEntry>;

  // serverName + serverUrl are mandatory bookkeeping; accessToken/expiresAt
  // are required by schema but accessToken === '' is allowed (DCR-only state).
  if (
    !isNonEmptyString(entry.serverName) ||
    typeof entry.serverUrl !== 'string' ||
    typeof entry.accessToken !== 'string' ||
    typeof entry.expiresAt !== 'number' ||
    !Number.isFinite(entry.expiresAt)
  ) {
    return undefined;
  }

  const normalized: PersistedMcpOAuthEntry = {
    serverName: entry.serverName,
    serverUrl: entry.serverUrl,
    accessToken: entry.accessToken,
    expiresAt: entry.expiresAt,
  };

  if (isNonEmptyString(entry.refreshToken)) normalized.refreshToken = entry.refreshToken;
  if (isNonEmptyString(entry.scope)) normalized.scope = entry.scope;
  if (isNonEmptyString(entry.clientId)) normalized.clientId = entry.clientId;
  if (isNonEmptyString(entry.clientSecret)) normalized.clientSecret = entry.clientSecret;
  if (isNonEmptyString(entry.stepUpScope)) normalized.stepUpScope = entry.stepUpScope;

  if (entry.discoveryState && typeof entry.discoveryState === 'object') {
    const ds = entry.discoveryState as { authorizationServerUrl?: unknown; resourceMetadataUrl?: unknown };
    if (isNonEmptyString(ds.authorizationServerUrl)) {
      normalized.discoveryState = {
        authorizationServerUrl: ds.authorizationServerUrl,
      };
      if (isNonEmptyString(ds.resourceMetadataUrl)) {
        normalized.discoveryState.resourceMetadataUrl = ds.resourceMetadataUrl;
      }
    }
  }

  return normalized;
}

function normalizeMcpOAuthMap(value: unknown): Record<string, PersistedMcpOAuthEntry> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Record<string, PersistedMcpOAuthEntry> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isNonEmptyString(key)) continue;
    const entry = normalizeMcpOAuthEntry(raw);
    if (entry) out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export class DeskmateTokenCache {
  private static instance: DeskmateTokenCache | null = null;

  /** In-memory mirror of the profile-scoped persisted cache. */
  private cache: DeskmateTokenCacheData | null = null;
  private loadedCachePath: string | null = null;
  /**
   * Serialization chain for cache writes. Required because read-modify-write
   * (`load → mutate → persist`) on N parallel MCP-OAuth flows would otherwise
   * race and lose entries. Pure reads bypass the chain.
   */
  private writeChain: Promise<unknown> = Promise.resolve();

  static getInstance(): DeskmateTokenCache {
    if (!DeskmateTokenCache.instance) {
      DeskmateTokenCache.instance = new DeskmateTokenCache();
    }
    return DeskmateTokenCache.instance;
  }

  private getCurrentProfileId(): string | null {
    try {
      // profile 在 Profiles.bootstrap() 后总是存在；只要有 active profile
      // 就可以写 cache，认证态由 pi/auth 自行管理。
      const profileId = Profiles.get().activeProfileId;
      return isNonEmptyString(profileId) ? profileId : null;
    } catch {
      return null;
    }
  }

  private getStorageDirectory(): string | null {
    const profileId = this.getCurrentProfileId();
    if (!profileId) {
      return null;
    }
    return path.join(PERSIST_PATH.profileDir(getAppRoot(), profileId), 'credentials');
  }

  private getEncryptedCachePath(): string | null {
    const directory = this.getStorageDirectory();
    return directory ? path.join(directory, `${CACHE_FILE_NAME}.enc`) : null;
  }

  private getFallbackCachePath(): string | null {
    const directory = this.getStorageDirectory();
    return directory ? path.join(directory, FALLBACK_FILE_NAME) : null;
  }

  private logMissingAlias(operation: 'load' | 'save' | 'clear'): void {
    logger.warn({ msg: '[DeskmateTokenCache] Skipping persisted browser auth cache operation because no active profile is available', mod: operation });
  }

  private async readPersistedCache(): Promise<DeskmateTokenCacheData | null> {
    const encryptedPath = this.getEncryptedCachePath();
    const fallbackPath = this.getFallbackCachePath();
    const safeStorage = resolveSafeStorage();

    if (!encryptedPath || !fallbackPath) {
      this.logMissingAlias('load');
      this.loadedCachePath = null;
      return null;
    }

    try {
      if (safeStorage?.isEncryptionAvailable() && fs.existsSync(encryptedPath)) {
        const encrypted = await fs.promises.readFile(encryptedPath);
        const decrypted = safeStorage.decryptString(encrypted);
        const parsed = normalizeCacheData(JSON.parse(decrypted));
        if (parsed) {
          this.loadedCachePath = encryptedPath;
        }
        return parsed;
      }

      if (fs.existsSync(fallbackPath)) {
        const raw = await fs.promises.readFile(fallbackPath, 'utf-8');
        const parsed = normalizeCacheData(JSON.parse(raw));
        if (parsed) {
          this.loadedCachePath = fallbackPath;
        }
        return parsed;
      }
    } catch (error) {
      logger.warn({ msg: '[DeskmateTokenCache] Failed to read persisted browser auth cache', mod: 'readPersistedCache', err: error });
    }

    this.loadedCachePath = null;
    return null;
  }

  private async persistCache(data: DeskmateTokenCacheData): Promise<void> {
    const directory = this.getStorageDirectory();
    const encryptedPath = this.getEncryptedCachePath();
    const fallbackPath = this.getFallbackCachePath();
    const safeStorage = resolveSafeStorage();
    const serialized = JSON.stringify(data, null, 2);

    if (!directory || !encryptedPath || !fallbackPath) {
      this.logMissingAlias('save');
      return;
    }

    await fs.promises.mkdir(directory, { recursive: true });

    if (safeStorage?.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(serialized);
      await fs.promises.writeFile(encryptedPath, encrypted);
      await fs.promises.rm(fallbackPath, { force: true });
      this.loadedCachePath = encryptedPath;
      return;
    }

    await fs.promises.writeFile(fallbackPath, serialized, 'utf-8');
    this.loadedCachePath = fallbackPath;
  }

  private async deletePersistedCache(): Promise<void> {
    const encryptedPath = this.getEncryptedCachePath();
    const fallbackPath = this.getFallbackCachePath();

    if (!encryptedPath || !fallbackPath) {
      this.logMissingAlias('clear');
      this.loadedCachePath = null;
      return;
    }

    await Promise.all([
      fs.promises.rm(encryptedPath, { force: true }),
      fs.promises.rm(fallbackPath, { force: true }),
    ]);
    this.loadedCachePath = null;
  }

  async load(): Promise<DeskmateTokenCacheData | null> {
    if (this.cache) {
      return cloneCache(this.cache);
    }

    const persisted = await this.readPersistedCache();
    this.cache = persisted ? cloneCache(persisted) : null;
    return this.cache ? cloneCache(this.cache) : null;
  }

  async save(data: DeskmateTokenCacheData): Promise<void> {
    return this.runSerialized(async () => {
      const normalized = normalizeCacheData({ ...data, version: CACHE_VERSION, updatedAt: Date.now() });
      if (!normalized) {
        throw new Error('Invalid browser auth cache payload');
      }

      this.cache = cloneCache(normalized);
      await this.persistCache(normalized);
      logger.info({ msg: '[DeskmateTokenCache] Token cache updated (memory + persisted profile cache)' });
    });
  }

  async clear(): Promise<void> {
    return this.runSerialized(async () => {
      this.cache = null;
      await this.deletePersistedCache();
      logger.info({ msg: '[DeskmateTokenCache] Token cache cleared (memory + persisted profile cache)' });
    });
  }

  async getValidToken(resource: TokenCacheResource, minValiditySec: number = 300): Promise<PersistedTokenInfo | null> {
    const cache = await this.load();
    if (!cache) return null;

    const token = cache[resource];
    if (!token) return null;

    const now = Math.floor(Date.now() / 1000);
    if (token.expiresAt <= now + minValiditySec) {
      return null;
    }

    return token;
  }

  async getRefreshInfo(): Promise<PersistedRefreshInfo | null> {
    return (await this.load())?.refresh || null;
  }

  async getCache(): Promise<DeskmateTokenCacheData | null> {
    return await this.load();
  }

  // ────────────────── MCP OAuth (non-Microsoft) ──────────────────

  /**
   * Read the OAuth credential entry for a single MCP server.
   * Returns `null` if the server has never been authenticated.
   *
   * Note: an entry with `accessToken === ''` is valid — it represents a
   * server that has completed Dynamic Client Registration but has not yet
   * exchanged an authorization code for an access token. Callers should
   * treat that case as "not authenticated yet".
   */
  async getMcpOAuth(serverKey: string): Promise<PersistedMcpOAuthEntry | null> {
    const cache = await this.load();
    return cache?.mcpOAuth?.[serverKey] ?? null;
  }

  /**
   * Persist (insert or replace) the OAuth credential entry for a single
   * MCP server. Other entries are preserved verbatim. Serialized against
   * other writers to prevent read-modify-write races.
   */
  async setMcpOAuth(serverKey: string, entry: PersistedMcpOAuthEntry): Promise<void> {
    return this.runSerialized(async () => {
      const existing = (await this.load()) ?? { version: CACHE_VERSION, updatedAt: Date.now() };
      const next: DeskmateTokenCacheData = {
        ...existing,
        version: CACHE_VERSION,
        updatedAt: Date.now(),
        mcpOAuth: {
          ...(existing.mcpOAuth ?? {}),
          [serverKey]: entry,
        },
      };
      const normalized = normalizeCacheData(next);
      if (!normalized) {
        throw new Error('Invalid MCP OAuth cache payload');
      }
      this.cache = cloneCache(normalized);
      await this.persistCache(normalized);
    });
  }

  /**
   * Remove a single MCP server's OAuth slot. Idempotent. Serialized
   * against other writers to prevent read-modify-write races.
   */
  async deleteMcpOAuth(serverKey: string): Promise<void> {
    return this.runSerialized(async () => {
      const existing = await this.load();
      if (!existing?.mcpOAuth || !existing.mcpOAuth[serverKey]) return;
      const { [serverKey]: _removed, ...rest } = existing.mcpOAuth;
      void _removed;
      const next: DeskmateTokenCacheData = {
        ...existing,
        version: CACHE_VERSION,
        updatedAt: Date.now(),
        mcpOAuth: Object.keys(rest).length > 0 ? rest : undefined,
      };
      const normalized = normalizeCacheData(next);
      // normalizeCacheData drops mcpOAuth when empty; that is the desired
      // outcome (clean schema), so we tolerate `normalized.mcpOAuth` being
      // undefined here.
      if (!normalized) return;
      this.cache = cloneCache(normalized);
      await this.persistCache(normalized);
    });
  }

  /** Run `op` after pending serialized writers; rejection isolated from chain. */
  private runSerialized<T>(op: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(() => op(), () => op());
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  async hasAnyUsableAuth(): Promise<boolean> {
    const cache = await this.load();
    if (!cache) return false;

    return Boolean(
      cache.graph ||
      cache.chatsvc ||
      cache.skypeApi ||
      cache.substrate ||
      cache.azureDevOps ||
      cache.refresh
    );
  }

  async updateFromSnapshot(snapshot: TokenCacheSnapshotInput): Promise<DeskmateTokenCacheData> {
    const existing = (await this.load()) || { version: CACHE_VERSION, updatedAt: Date.now() };
    const next: DeskmateTokenCacheData = {
      ...existing,
      version: CACHE_VERSION,
      updatedAt: Date.now(),
    };

    if (snapshot.account !== undefined) {
      const normalized = normalizeAccount(snapshot.account);
      if (normalized) next.account = normalized;
    }
    if (snapshot.graph !== undefined) {
      const normalized = normalizeToken(snapshot.graph);
      if (normalized) next.graph = normalized;
    }
    if (snapshot.chatsvc !== undefined) {
      const normalized = normalizeToken(snapshot.chatsvc);
      if (normalized) next.chatsvc = normalized;
    }
    if (snapshot.skypeApi !== undefined) {
      const normalized = normalizeToken(snapshot.skypeApi);
      if (normalized) next.skypeApi = normalized;
    }
    if (snapshot.substrate !== undefined) {
      const normalized = normalizeToken(snapshot.substrate);
      if (normalized) next.substrate = normalized;
    }
    if (snapshot.azureDevOps !== undefined) {
      const normalized = normalizeToken(snapshot.azureDevOps);
      if (normalized) next.azureDevOps = normalized;
    }
    if (snapshot.refresh !== undefined) {
      const normalized = normalizeRefresh(snapshot.refresh);
      if (normalized) next.refresh = normalized;
    }
    if (snapshot.region !== undefined) {
      const normalized = normalizeRegion(snapshot.region);
      if (normalized) next.region = normalized;
    }

    await this.save(next);
    return next;
  }

  async updateFromRefreshResult(
    resource: TokenCacheResource,
    result: { accessToken: string; expiresAt: number; refreshToken?: string },
    metadata?: {
      refresh?: PersistedRefreshInfo | null;
      account?: PersistedAccountInfo | null;
      region?: PersistedRegionInfo | null;
    },
  ): Promise<DeskmateTokenCacheData> {
    const existing = (await this.load()) || { version: CACHE_VERSION, updatedAt: Date.now() };
    const next: DeskmateTokenCacheData = {
      ...existing,
      version: CACHE_VERSION,
      updatedAt: Date.now(),
      [resource]: {
        accessToken: result.accessToken,
        expiresAt: result.expiresAt,
      },
    };

    const refreshBase = metadata?.refresh || existing.refresh;
    if (refreshBase) {
      next.refresh = {
        ...refreshBase,
        refreshToken: isNonEmptyString(result.refreshToken) ? result.refreshToken : refreshBase.refreshToken,
      };
    }

    const account = normalizeAccount(metadata?.account);
    const region = normalizeRegion(metadata?.region);
    if (account) next.account = account;
    if (region) next.region = region;

    await this.save(next);
    return next;
  }
}
