/**
 * GitHub Copilot model registry —— 本地缓存 + 远程拉取 + Deskmate 白名单查询。
 *
 * **当前状态：未被 model registry 消费**。`pi/model.ts` 已统一走 pi-ai 内置
 * model 表，github-copilot 直接来自 pi-ai 的 `getModels('github-copilot')`，
 * 不再从此处取数据。
 *
 * 本模块由 `main.ts` import 触发 singleton 构造,构造函数内 fire-and-forget
 * 调 `refreshFromRemote()`,在启动时维护本地缓存文件
 * `{userData}/profiles/{profileId}/models/github-copilot.json` —— 留作未来
 * 恢复"动态 `/models`"路径的备用（若 pi-ai 收录跟不上 GHC 真发新模型）。
 *
 * Export 面：单例 + `getModelById` + `getAllDeskmateUsedModels`（孤儿，无人调用）。
 *
 * 关键不变量：
 *   - 本地缓存路径 `{userData}/profiles/{profileId}/models/github-copilot.json`，
 *     与 `src/main/persist/models.ts` 的 Models registry 同源。
 *   - `refreshFromRemote()` 的 token 来源是 `PiAuthManager.getApiKey('github-copilot')`
 *     —— 自动处理过期 refresh + 回写 `auth.pi.json`。
 *   - "缺 Claude 完整性"防护：远程不返 Claude、但本地缓存有 Claude → 拒绝写入。
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '@main/log';
import { Profiles } from '@main/persist';
import { PERSIST_PATH } from '@shared/persist/path';
import { getAppRoot } from '@main/persist/lib/root';
import { getPiAuthManager } from '@main/pi/auth';
import { GHC_CONFIG } from './config';
import type { GhcCopilotModel } from './types';

const logger = log;

/** Local persistence file name —— 与 persist Models registry 一致：models/{provider}.json */
const MODELS_FILE_NAME = 'github-copilot.json';

/**
 * Deskmate model matching rules (dynamically filtered from the full GHC model set)
 *
 * Version constraints (derived from the version range covered by the original DESKMATE_USED_MODEL_IDS):
 *   - Claude  ≥ 4.0 : claude-(opus|sonnet)-4, 4.5, 4.6, 5, … — excludes haiku
 *   - Gemini  ≥ 2.5 : gemini-2.5-pro, gemini-3-pro, …        — excludes flash
 *   - GPT     > 5.0 : gpt-5.1, gpt-5.2-codex, gpt-6, …      — excludes mini
 *
 * Common rules:
 *   1. capabilities.type === 'chat' (excludes embeddings / completion)
 *   2. Exclude lightweight models (mini / flash / haiku)
 *   3. Exclude reasoning-only models (o3 / o4 series)
 *   4. model_picker_enabled === true (models not enabled are not shown)
 */
const DESKMATE_MODEL_PATTERNS: { include: RegExp; sortGroup: number }[] = [
  // Claude ≥4.0 opus / sonnet (excludes haiku)
  { include: /^claude-(opus|sonnet)-([4-9]|\d{2,})/, sortGroup: 0 },
  // Gemini ≥2.5 pro series (excludes flash)
  { include: /^gemini-(2\.[5-9]|2\.\d{2,}|[3-9]|\d{2,}).*pro/, sortGroup: 1 },
  // GPT >5.0 (i.e. 5.1+, 6, 7, …) — excludes gpt-5.0 and gpt-4.x
  { include: /^gpt-(5\.[1-9]|5\.\d{2,}|[6-9]|\d{2,})/, sortGroup: 2 },
];

/** Global exclusion: lightweight and reasoning-only variants (\b prevents matching "mini" inside "gemini") */
const DESKMATE_MODEL_EXCLUDE = /\bmini|\bflash|\bhaiku/i;

class GhcModelsManager {
  private static instance: GhcModelsManager;

  /** In-memory cache — the full set of currently active models */
  private modelsCache: GhcCopilotModel[] = [];

  /** Whether initialization has completed */
  private initialized = false;

  /** In-progress initialization Promise (used to prevent race conditions) */
  private initializationPromise: Promise<void> | null = null;

  /** Current profile id —— 用于侦测 active profile 切换重置 cache。 */
  private currentProfileId: string | null = null;

  private constructor() {}

  static getInstance(): GhcModelsManager {
    if (!GhcModelsManager.instance) {
      GhcModelsManager.instance = new GhcModelsManager();
    }
    return GhcModelsManager.instance;
  }

  /**
   * Initialize the model manager.
   *
   * profileId 默认从 `Profiles.get().activeProfileId` 取。当传入的 profileId
   * 与当前缓存的不一致时，触发重新初始化（用于 profile 切换场景）。
   */
  async initialize(profileId?: string): Promise<void> {
    const resolvedId = profileId ?? Profiles.get().activeProfileId ?? null;
    if (resolvedId && resolvedId !== this.currentProfileId) {
      this.currentProfileId = resolvedId;
      this.initialized = false;
      this.initializationPromise = null;
    }

    if (this.initialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = this._doInitialize();
    return this.initializationPromise;
  }

  private async _doInitialize(): Promise<void> {
    logger.debug({ msg: `[GhcModelsManager] Initializing${this.currentProfileId ? ` for profile: ${this.currentProfileId}` : ''}...` });

    try {
      const loaded = await this.loadFromFile();
      if (loaded && this.modelsCache.length > 0) {
        logger.debug({ msg: `[GhcModelsManager] Loaded ${this.modelsCache.length} models from local cache` });
      } else {
        logger.debug({ msg: '[GhcModelsManager] No local cache available, will rely on remote fetch' });
      }
    } catch (error) {
      logger.error({ msg: `[GhcModelsManager] Initialization error: ${error instanceof Error ? error.message : String(error)}` });
    }

    this.initialized = true;
    logger.debug({ msg: `[GhcModelsManager] Initialized with ${this.modelsCache.length} models (from local cache)` });

    // Background remote refresh; fire-and-forget. Failure is non-fatal.
    this.refreshFromRemote().catch((err) => {
      logger.warn({ msg: `[GhcModelsManager] Background remote refresh failed: ${err instanceof Error ? err.message : String(err)}` });
    });
  }

  // ==========================================================================
  // Local file read/write
  // ==========================================================================

  /**
   * Get the full path to the local persistence file.
   * Path format: `{userData}/profiles/{profileId}/models/github-copilot.json`
   * 与 src/main/persist/models.ts 的 Models registry 共用同一路径。
   */
  private getFilePath(): string {
    if (!this.currentProfileId) {
      throw new Error('[GhcModelsManager] currentProfileId is not set. Call initialize() first.');
    }
    return path.join(PERSIST_PATH.modelsDir(getAppRoot(), this.currentProfileId), MODELS_FILE_NAME);
  }

  private async loadFromFile(): Promise<boolean> {
    try {
      const filePath = this.getFilePath();
      if (!fs.existsSync(filePath)) return false;

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      // Supports two formats: a bare array or { models: [...], updatedAt: ... }
      if (Array.isArray(parsed)) {
        this.modelsCache = parsed;
      } else if (parsed && Array.isArray(parsed.models)) {
        this.modelsCache = parsed.models;
      } else {
        logger.warn({ msg: '[GhcModelsManager] Invalid file format' });
        return false;
      }

      return this.modelsCache.length > 0;
    } catch (error) {
      logger.error({ msg: `[GhcModelsManager] Failed to read local file: ${error instanceof Error ? error.message : String(error)}` });
      return false;
    }
  }

  private async saveToFile(): Promise<boolean> {
    try {
      const filePath = this.getFilePath();
      const data = {
        version: 1 as const,
        models: this.modelsCache,
        updatedAt: new Date().toISOString(),
        count: this.modelsCache.length,
      };
      // models/ 目录在新装 / 旧 profile 升级场景下可能不存在，先 mkdir -p
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      logger.debug({ msg: `[GhcModelsManager] Saved ${this.modelsCache.length} models to ${filePath}` });
      return true;
    } catch (error) {
      logger.error({ msg: `[GhcModelsManager] Failed to save to file: ${error instanceof Error ? error.message : String(error)}` });
      return false;
    }
  }

  // ==========================================================================
  // Remote fetch updates
  // ==========================================================================

  /**
   * Fetch the latest model list from the remote API and update the cache and local file.
   * Token 走 `PiAuthManager.getApiKey('github-copilot')` —— 过期自动 refresh + 回写
   * auth.pi.json。未登录返回 null，跳过远程刷新。
   */
  async refreshFromRemote(): Promise<boolean> {
    logger.debug({ msg: '[GhcModelsManager] Fetching models from remote API...' });

    try {
      if (!this.currentProfileId) {
        logger.warn({ msg: '[GhcModelsManager] currentProfileId not set, skipping remote fetch' });
        return false;
      }

      let token: string | null = null;
      try {
        token = await getPiAuthManager(this.currentProfileId).getApiKey('github-copilot');
      } catch (err) {
        logger.warn({ msg: `[GhcModelsManager] Pi token fetch failed: ${err instanceof Error ? err.message : String(err)}` });
      }

      if (!token) {
        logger.warn({ msg: '[GhcModelsManager] No github-copilot token available (not signed in?), skipping remote fetch' });
        return false;
      }

      const url = `${GHC_CONFIG.API_ENDPOINT}/models`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'User-Agent': GHC_CONFIG.USER_AGENT,
          'Editor-Version': GHC_CONFIG.EDITOR_VERSION,
          'Editor-Plugin-Version': GHC_CONFIG.EDITOR_PLUGIN_VERSION,
          'Copilot-Integration-Id': GHC_CONFIG.INTEGRATION_ID,
        },
      });

      if (!response.ok) {
        logger.error({ msg: `[GhcModelsManager] Remote fetch failed: ${response.status} ${response.statusText}` });
        return false;
      }

      const data = await response.json();
      let models: GhcCopilotModel[] = [];

      // GitHub Copilot API response format: { data: [...] } or a bare array
      if (Array.isArray(data)) {
        models = data;
      } else if (data && Array.isArray(data.data)) {
        models = data.data;
      } else {
        logger.warn({ msg: '[GhcModelsManager] Unexpected API response format' });
        return false;
      }

      if (models.length === 0) {
        logger.warn({ msg: '[GhcModelsManager] Remote returned empty model list, keeping existing cache' });
        return false;
      }

      // Integrity check: the remote list must include Claude models to be considered complete.
      // In some network environments (e.g. without a VPN), the remote may not return Claude models;
      // in that case we must not overwrite the local cache.
      const hasClaudeModels = models.some((m) => /^claude-/i.test(m.id));
      const localHasClaude = this.modelsCache.some((m) => /^claude-/i.test(m.id));
      if (!hasClaudeModels && localHasClaude) {
        logger.warn({ msg: `[GhcModelsManager] Remote list has ${models.length} models but missing Claude models (local cache has Claude). Keeping local cache to prevent model loss.` });
        return false;
      }

      logger.debug({ msg: `[GhcModelsManager] Remote list integrity check passed (claude=${hasClaudeModels}, localHadClaude=${localHasClaude})` });

      this.modelsCache = models;
      await this.saveToFile();

      logger.debug({ msg: `[GhcModelsManager] Successfully refreshed ${models.length} models from remote` });
      return true;
    } catch (error) {
      logger.error({ msg: `[GhcModelsManager] Remote fetch error: ${error instanceof Error ? error.message : String(error)}` });
      return false;
    }
  }

  // ==========================================================================
  // Public query API
  // ==========================================================================

  /**
   * Get the list of models used by Deskmate (dynamically matched from the full GHC model set).
   *
   * Matching logic:
   *   1. capabilities.type === 'chat'
   *   2. model_picker_enabled === true
   *   3. Model ID matches at least one DESKMATE_MODEL_PATTERNS include regex
   *   4. Model ID does not match DESKMATE_MODEL_EXCLUDE (mini/flash/haiku)
   *
   * Sort: grouped by sortGroup (Claude → Gemini → GPT), within each group sorted by ID descending.
   */
  getAllDeskmateUsedModels(): GhcCopilotModel[] {
    this.ensureInitialized();

    const matched: { model: GhcCopilotModel; sortGroup: number }[] = [];

    for (const model of this.modelsCache) {
      if (model.capabilities.type !== 'chat' || !model.model_picker_enabled) continue;
      if (DESKMATE_MODEL_EXCLUDE.test(model.id)) continue;

      for (const pattern of DESKMATE_MODEL_PATTERNS) {
        if (pattern.include.test(model.id)) {
          matched.push({ model, sortGroup: pattern.sortGroup });
          break;
        }
      }
    }

    matched.sort((a, b) => {
      if (a.sortGroup !== b.sortGroup) return a.sortGroup - b.sortGroup;
      return b.model.id.localeCompare(a.model.id);
    });

    return matched.map((m) => m.model);
  }

  /** Get a single model by ID */
  getModelById(modelId: string): GhcCopilotModel | undefined {
    this.ensureInitialized();
    return this.modelsCache.find((model) => model.id === modelId);
  }

  // ==========================================================================
  // Internal helpers
  // ==========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      logger.warn({ msg: '[GhcModelsManager] Not yet initialized. Call initialize() first. Models cache may be empty.' });
    }
  }
}


// ============================================================================
// Exports
// ============================================================================

export const ghcModelsManager = GhcModelsManager.getInstance();

export function getAllDeskmateUsedModels(): GhcCopilotModel[] {
  return ghcModelsManager.getAllDeskmateUsedModels();
}

export function getModelById(modelId: string): GhcCopilotModel | undefined {
  return ghcModelsManager.getModelById(modelId);
}

