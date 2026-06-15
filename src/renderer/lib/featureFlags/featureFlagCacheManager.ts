/**
 * Feature Flag cache manager (Renderer Process)
 *
 * Architecture notes:
 * - Backend (Main Process) is the single source of truth for feature flags
 * - Feature flags are defined by developers in the backend, or passed via CLI arguments
 * - Frontend is read-only; flags are synced from the backend at startup
 * - localStorage cache is used as a fallback
 */

import { BRAND_NAME } from '@shared/constants/branding';
import type { FeatureFlagName, FeatureFlagsValues } from '@shared/types/featureFlagTypes';
import { featureFlagsApi } from '@/ipc/featureFlags';
import { log } from '@/log';
const logger = log.child({ mod: 'FeatureFlagCacheManager' });

const STORAGE_KEY = `${BRAND_NAME}_feature_flags_cache`;
const CACHE_VERSION_KEY = `${BRAND_NAME}_feature_flags_cache_version`;
const CURRENT_CACHE_VERSION = '1.0';

class FeatureFlagCacheManager {
  private static instance: FeatureFlagCacheManager;
  private flags: Partial<FeatureFlagsValues> = {};
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): FeatureFlagCacheManager {
    if (!FeatureFlagCacheManager.instance) {
      FeatureFlagCacheManager.instance = new FeatureFlagCacheManager();
    }
    return FeatureFlagCacheManager.instance;
  }

  /**
   * Initialize the cache manager
   * Should be called at app startup to sync the latest flags from the backend
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug({ msg: "Already initialized, skipping..." });
      return;
    }

    // Prevent duplicate initialization
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    logger.debug({ msg: "Initializing feature flags cache manager..." });

    try {
      // Check cache version
      const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY);
      const needsUpdate = cachedVersion !== CURRENT_CACHE_VERSION;

      if (needsUpdate) {
        logger.debug({ msg: "Cache version mismatch, clearing old cache..." });
        localStorage.removeItem(STORAGE_KEY);
      }

      // Fetch latest flags from the backend
      await this.syncFromBackend();

      // Update cache version
      localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);

      this.initialized = true;
      logger.debug({ msg: "Initialization complete" });
    } catch (error) {
      logger.error({ msg: "Initialization failed:", err: error });
      // If sync fails, attempt to load old cache from localStorage
      this.loadFromLocalStorage();
      this.initialized = true;
    }
  }

  /**
   * Sync the latest flags from the backend
   */
  private async syncFromBackend(): Promise<void> {
    logger.debug({ msg: "Syncing flags from backend..." });

    try {
      const flagsResult = await featureFlagsApi.getAllFlags();
      if (!flagsResult.success) {
        throw new Error(flagsResult.error || 'Failed to fetch feature flags');
      }

      this.flags = flagsResult.data;
      this.saveToLocalStorage();

      logger.debug({ msg: "Successfully synced flags from backend", flagCount: Object.keys(this.flags).length });
    } catch (error) {
      logger.error({ msg: "Failed to sync from backend:", err: error });
      throw error;
    }
  }

  /**
   * Save flags data to localStorage
   */
  private saveToLocalStorage(): void {
    try {
      const cacheData = {
        flags: this.flags,
        timestamp: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheData));
    } catch (error) {
      logger.error({ msg: "Failed to save to localStorage:", err: error });
    }
  }

  /**
   * Load flags data from localStorage
   */
  private loadFromLocalStorage(): void {
    try {
      const cachedData = localStorage.getItem(STORAGE_KEY);
      if (cachedData) {
        const parsedData = JSON.parse(cachedData);
        this.flags = parsedData.flags || {};
        logger.debug({ msg: "Loaded from localStorage", flagCount: Object.keys(this.flags).length });
      }
    } catch (error) {
      logger.error({ msg: "Failed to load from localStorage:", err: error });
    }
  }

  /**
   * Check whether a feature flag is enabled (synchronous)
   */
  public isEnabled(name: FeatureFlagName): boolean {
    if (!this.initialized) {
      logger.warn({ msg: "Not initialized, returning false for", data: name });
      return false;
    }
    return this.flags[name] ?? false;
  }

  /**
   * Get all flag values
   */
  public getAllFlags(): Partial<FeatureFlagsValues> {
    if (!this.initialized) {
      return {};
    }
    return { ...this.flags };
  }

  /**
   * Check whether the manager has been initialized
   */
  public get isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const featureFlagCacheManager = FeatureFlagCacheManager.getInstance();

// Export convenience functions
export function isFeatureEnabled(name: FeatureFlagName): boolean {
  return featureFlagCacheManager.isEnabled(name);
}

export function getAllFeatureFlags(): Partial<FeatureFlagsValues> {
  return featureFlagCacheManager.getAllFlags();
}
