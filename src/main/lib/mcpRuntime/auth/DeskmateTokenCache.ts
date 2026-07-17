/**
 * DeskmateTokenCache
 *
 * Per-server MCP OAuth credential cache with an in-memory mirror plus
 * profile-scoped persistence. Written as plain JSON under
 * `{userData}/profiles/<id>/credentials/mcp.auth.json` —
 * 落盘形态与 `auth.json`(主身份凭据)一致,均为明文。Concurrent writers
 * are serialized on a single promise chain to prevent read-modify-write
 * loss on parallel MCP OAuth flows.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '@main/log';
import { PERSIST_PATH } from '@shared/persist/path';
import { getAppRoot } from '@main/persist/lib/root';

const CACHE_VERSION = 1 as const;
const CACHE_FILE = 'mcp.auth.json';

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
}

export interface DeskmateTokenCacheData {
  version: typeof CACHE_VERSION;
  /**
   * OAuth credentials for MCP servers. Keyed by `getMcpOAuthServerKey()`.
   * Profile-scoped by way of the cache file's profile-scoped path.
   */
  mcpOAuth?: Record<string, PersistedMcpOAuthEntry>;
  updatedAt: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
  return normalized;
}

/** Read-side validation only — anything writen from within this module is
 *  already well-typed, so we skip re-normalization on persist. */
function normalizeCacheData(value: unknown): DeskmateTokenCacheData | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<DeskmateTokenCacheData>;
  if (raw.version !== CACHE_VERSION) return null;
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) return null;

  const normalized: DeskmateTokenCacheData = {
    version: CACHE_VERSION,
    updatedAt: raw.updatedAt,
  };

  if (raw.mcpOAuth && typeof raw.mcpOAuth === 'object') {
    const out: Record<string, PersistedMcpOAuthEntry> = {};
    for (const [key, rawEntry] of Object.entries(raw.mcpOAuth)) {
      if (!isNonEmptyString(key)) continue;
      const entry = normalizeMcpOAuthEntry(rawEntry);
      if (entry) out[key] = entry;
    }
    if (Object.keys(out).length > 0) normalized.mcpOAuth = out;
  }

  return normalized;
}

export class DeskmateTokenCache {
  /** In-memory mirror of one profile's persisted cache. */
  private cache: DeskmateTokenCacheData | null = null;
  /**
   * Serialization chain for cache writes. Required because read-modify-write
   * (`load → mutate → persist`) on N parallel MCP-OAuth flows would otherwise
   * race and lose entries. Pure reads bypass the chain.
   */
  private writeChain: Promise<unknown> = Promise.resolve();

  public constructor(private readonly profileId: string) {}

  private getStorageDirectory(): string {
    return path.join(PERSIST_PATH.profileDir(getAppRoot(), this.profileId), 'credentials');
  }

  private cacheFile(): { file: string; directory: string } {
    const directory = this.getStorageDirectory();
    return { directory, file: path.join(directory, CACHE_FILE) };
  }

  private async readPersistedCache(): Promise<DeskmateTokenCacheData | null> {
    const paths = this.cacheFile();

    try {
      if (fs.existsSync(paths.file)) {
        const raw = await fs.promises.readFile(paths.file, 'utf-8');
        return normalizeCacheData(JSON.parse(raw));
      }
    } catch (error) {
      log.warn({ msg: '[DeskmateTokenCache] Failed to read persisted MCP OAuth cache', mod: 'DeskmateTokenCache', err: error });
    }
    return null;
  }

  private async persistCache(data: DeskmateTokenCacheData): Promise<void> {
    const paths = this.cacheFile();

    await fs.promises.mkdir(paths.directory, { recursive: true });
    await fs.promises.writeFile(paths.file, JSON.stringify(data, null, 2), 'utf-8');
  }

  async load(): Promise<DeskmateTokenCacheData | null> {
    if (this.cache) return structuredClone(this.cache);
    const persisted = await this.readPersistedCache();
    this.cache = persisted ? structuredClone(persisted) : null;
    return this.cache ? structuredClone(this.cache) : null;
  }

  // ────────────────── MCP OAuth ──────────────────

  /**
   * Read the OAuth credential entry for a single MCP server. Returns `null`
   * if the server has never been authenticated. An entry with
   * `accessToken === ''` represents a server that completed DCR but has not
   * yet exchanged an authorization code for an access token — callers should
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
        version: CACHE_VERSION,
        updatedAt: Date.now(),
        mcpOAuth: { ...existing.mcpOAuth, [serverKey]: entry },
      };
      this.cache = structuredClone(next);
      await this.persistCache(next);
    });
  }

  /**
   * Remove a single MCP server's OAuth slot. Idempotent. Serialized
   * against other writers to prevent read-modify-write races.
   */
  async deleteMcpOAuth(serverKey: string): Promise<void> {
    return this.runSerialized(async () => {
      const existing = await this.load();
      if (!existing?.mcpOAuth?.[serverKey]) return;
      const { [serverKey]: _removed, ...rest } = existing.mcpOAuth;
      void _removed;
      const next: DeskmateTokenCacheData = {
        version: CACHE_VERSION,
        updatedAt: Date.now(),
        mcpOAuth: Object.keys(rest).length > 0 ? rest : undefined,
      };
      this.cache = structuredClone(next);
      await this.persistCache(next);
    });
  }

  /**
   * Remove every OAuth slot ever associated with one server name. A server's
   * identity key changes when its auth-relevant config changes, so removing
   * only its current key would leave historical refresh tokens behind.
   */
  async deleteMcpOAuthForServer(serverName: string): Promise<void> {
    return this.runSerialized(async () => {
      const existing = await this.load();
      if (!existing?.mcpOAuth) return;

      const entries = Object.entries(existing.mcpOAuth).filter(
        ([, entry]) => entry.serverName !== serverName,
      );
      if (entries.length === Object.keys(existing.mcpOAuth).length) return;

      const mcpOAuth = Object.fromEntries(entries);
      const next: DeskmateTokenCacheData = {
        version: CACHE_VERSION,
        updatedAt: Date.now(),
        mcpOAuth: Object.keys(mcpOAuth).length > 0 ? mcpOAuth : undefined,
      };
      this.cache = structuredClone(next);
      await this.persistCache(next);
    });
  }

  /** Run `op` after pending serialized writers; rejection isolated from chain. */
  private runSerialized<T>(op: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(() => op(), () => op());
    this.writeChain = next.catch(() => undefined);
    return next;
  }
}
