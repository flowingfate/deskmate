/**
 * AppCacheManager
 *
 * Manages reading/writing and in-memory caching of {userData}/app.json.
 * On data changes, syncs to the frontend AppDataManager in real time via the IPC event 'app:configUpdated'.
 *
 * app.json structure:
 * {
 *   "updaterVersion": "0.0.5",
 *   "runtimeEnvironment": {
 *     "mode": "system" | "internal",
 *     "bunVersion": "1.3.6",
 *     "uvVersion": "0.6.17",
 *     "pinnedPythonVersion": "cpython-3.10.12-macos-aarch64-none" | null
 *   }
 * }
 *
 * Migration rules (integrityEnsure):
 *   If runtimeEnvironment is absent in app.json, migrate it from {userData}/runtimeConfig.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { log } from '@main/log';
import { mainWindow, anyVisibleWindow } from '@main/startup/wins';
import {
  AppConfig,
  RuntimeMode,
  DEFAULT_RUNTIME_ENVIRONMENT,
  DEFAULT_APP_CONFIG,
  DEFAULT_SCREENSHOT_SETTINGS,
  isAppConfig,
} from '@shared/types/appConfig';
import type { ScreenshotSettings } from '@shared/types/appConfig';
import { mainToRender as appMainToRender } from '@shared/ipc/app';
import { getAppDataPath, getAppJsonPath } from '@main/persist/lib/path';

// Re-export types so external callers can import them directly from appCacheManager
export { DEFAULT_RUNTIME_ENVIRONMENT, DEFAULT_APP_CONFIG, DEFAULT_SCREENSHOT_SETTINGS, isAppConfig } from '@shared/types/appConfig';
export type { ScreenshotSettings } from '@shared/types/appConfig';

const logger = log;

const APP_CONFIG_FILENAME = 'app.json';
const DEFAULT_ZOOM_LEVEL = 0;
const ZOOM_MIN = -3;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.5;

function sanitizeZoomLevel(value: unknown, fallback: number = DEFAULT_ZOOM_LEVEL): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;

  const clamped = Math.min(Math.max(value, ZOOM_MIN), ZOOM_MAX);
  return Math.round(clamped / ZOOM_STEP) * ZOOM_STEP;
}

function getElectronApp(): Electron.App {
  try {
    if ((global as any).electron?.app) {
      return (global as any).electron.app;
    }
    return app;
  } catch {
    throw new Error('[AppCacheManager] Electron app not available');
  }
}

// ─── AppCacheManager ──────────────────────────────────────────────────────────

/**
 * AppCacheManager — singleton
 *
 * Responsibilities:
 * 1. Read / write {userData}/app.json
 * 2. Keep an in-memory cache of the latest config
 * 3. integrityEnsure on read (migrate from legacy runtimeConfig.json when runtimeEnvironment is missing)
 * 4. appConfigSanitize on write (strip invalid fields and enforce type safety)
 * 5. Notify the frontend AppDataManager via IPC after data updates
 */
export class AppCacheManager {
  private static instance: AppCacheManager;

  private cache: AppConfig = {};
  private initialized = false;

  // Debounce timer for batched frontend notifications
  private notifyTimer: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): AppCacheManager {
    if (!AppCacheManager.instance) {
      AppCacheManager.instance = new AppCacheManager();
    }
    return AppCacheManager.instance;
  }

  // ── Paths ──────────────────────────────────────────────────────────────────

  private getUserDataPath(): string {
    return getAppDataPath();
  }

  private getAppConfigPath(): string {
    return getAppJsonPath();
  }



  // ── Load ───────────────────────────────────────────────────────────────────

  /**
   * Initialize: read app.json (including integrity check and data migration)
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const raw = this.readRawConfig();
      const ensured = this.integrityEnsure(raw);
      this.cache = ensured;

      // Persist synchronously if the integrity check produced changes
      if (this.needsWrite(raw, ensured)) {
        await this.writeConfigToDisk(ensured);
      }

      this.initialized = true;
      logger.info({ msg: '[AppCacheManager] Initialization complete', mod: 'AppCacheManager', config: this.cache });
    } catch (error) {
      logger.error({ msg: '[AppCacheManager] Initialization failed', mod: 'AppCacheManager', err: error });
    }
  }

  /**
   * Read the raw JSON from disk without any transformation.
   */
  private readRawConfig(): Partial<AppConfig> {
    const configPath = this.getAppConfigPath();
    if (!fs.existsSync(configPath)) {
      logger.info({ msg: '[AppCacheManager] app.json not found, using empty config', mod: 'AppCacheManager' });
      return {};
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content) as Partial<AppConfig>;
    } catch (error) {
      logger.warn({ msg: '[AppCacheManager] Failed to read app.json, using empty config', mod: 'AppCacheManager', err: error });
      return {};
    }
  }

  // ── integrityEnsure ────────────────────────────────────────────────────────

  /**
   * Integrity check: 缺字段填默认；不读任何 legacy 路径。
   */
  private integrityEnsure(raw: Partial<AppConfig>): AppConfig {
    const result: AppConfig = { ...raw };

    if (!result.runtimeEnvironment) {
      result.runtimeEnvironment = { ...DEFAULT_RUNTIME_ENVIRONMENT };
    } else {
      result.runtimeEnvironment = {
        ...DEFAULT_RUNTIME_ENVIRONMENT,
        ...result.runtimeEnvironment,
      };
    }

    if (!result.screenshotSettings) {
      result.screenshotSettings = { ...DEFAULT_SCREENSHOT_SETTINGS };
    } else {
      result.screenshotSettings = { ...DEFAULT_SCREENSHOT_SETTINGS, ...result.screenshotSettings };
    }

    if (typeof result.leftSidebarCollapsed !== 'boolean') {
      result.leftSidebarCollapsed = DEFAULT_APP_CONFIG.leftSidebarCollapsed;
    }

    // leftSidebarWidth: clamp to [288, 400], default 288
    if (typeof result.leftSidebarWidth !== 'number' || !Number.isFinite(result.leftSidebarWidth)) {
      result.leftSidebarWidth = DEFAULT_APP_CONFIG.leftSidebarWidth;
    } else {
      result.leftSidebarWidth = Math.round(Math.min(400, Math.max(288, result.leftSidebarWidth)));
    }

    // zoomLevel: fill with default if missing and normalize persisted values
    result.zoomLevel = sanitizeZoomLevel(result.zoomLevel, DEFAULT_ZOOM_LEVEL);

    if (typeof result.mainWindowMaximized !== 'boolean') {
      result.mainWindowMaximized = DEFAULT_APP_CONFIG.mainWindowMaximized;
    }

    return result;
  }
  /**
   * Check whether the integrity check produced any changes (determines whether persistence is needed).
   */
  private needsWrite(before: Partial<AppConfig>, after: AppConfig): boolean {
    return JSON.stringify(before) !== JSON.stringify(after);
  }

  // ── appConfigSanitize ──────────────────────────────────────────────────────

  /**
   * Pre-write sanitization: filter invalid types and fill in required fields.
   */
  private appConfigSanitize(config: Partial<AppConfig>): AppConfig {
    const sanitized: AppConfig = {};

    // updaterVersion: string | undefined
    if (typeof config.updaterVersion === 'string') {
      sanitized.updaterVersion = config.updaterVersion;
    }

    // runtimeEnvironment: RuntimeEnvironment | undefined
    const re = config.runtimeEnvironment;
    if (re && typeof re === 'object') {
      sanitized.runtimeEnvironment = {
        mode:
          re.mode === 'internal' || re.mode === 'system'
            ? re.mode
            : DEFAULT_RUNTIME_ENVIRONMENT.mode,
        bunVersion:
          typeof re.bunVersion === 'string' && re.bunVersion
            ? re.bunVersion
            : DEFAULT_RUNTIME_ENVIRONMENT.bunVersion,
        uvVersion:
          typeof re.uvVersion === 'string' && re.uvVersion
            ? re.uvVersion
            : DEFAULT_RUNTIME_ENVIRONMENT.uvVersion,
        pinnedPythonVersion:
          typeof re.pinnedPythonVersion === 'string'
            ? re.pinnedPythonVersion
            : re.pinnedPythonVersion === null
            ? null
            : DEFAULT_RUNTIME_ENVIRONMENT.pinnedPythonVersion ?? '3.10.12',
      };
    }

    // screenshotSettings: ScreenshotSettings | undefined
    const ss = config.screenshotSettings;
    if (ss && typeof ss === 'object') {
      sanitized.screenshotSettings = {
        enabled: typeof ss.enabled === 'boolean' ? ss.enabled : DEFAULT_SCREENSHOT_SETTINGS.enabled,
        shortcut: typeof ss.shortcut === 'string' ? ss.shortcut : DEFAULT_SCREENSHOT_SETTINGS.shortcut,
        shortcutEnabled: typeof ss.shortcutEnabled === 'boolean' ? ss.shortcutEnabled : DEFAULT_SCREENSHOT_SETTINGS.shortcutEnabled,
        savePath: typeof ss.savePath === 'string' ? ss.savePath : DEFAULT_SCREENSHOT_SETTINGS.savePath,
        freRejected: typeof ss.freRejected === 'boolean' ? ss.freRejected : DEFAULT_SCREENSHOT_SETTINGS.freRejected,
      };
    }

    if (typeof config.leftSidebarCollapsed === 'boolean') {
      sanitized.leftSidebarCollapsed = config.leftSidebarCollapsed;
    }

    // leftSidebarWidth: number, clamp to [288, 400]
    if (typeof config.leftSidebarWidth === 'number' && Number.isFinite(config.leftSidebarWidth)) {
      sanitized.leftSidebarWidth = Math.round(Math.min(400, Math.max(288, config.leftSidebarWidth)));
    }

    sanitized.zoomLevel = sanitizeZoomLevel(config.zoomLevel, DEFAULT_ZOOM_LEVEL);

    if (typeof config.mainWindowMaximized === 'boolean') {
      sanitized.mainWindowMaximized = config.mainWindowMaximized;
    }

    return sanitized;
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Persist AppConfig data to app.json.
   * appConfigSanitize is applied before writing.
   */
  private async writeConfigToDisk(config: AppConfig): Promise<void> {
    const sanitized = this.appConfigSanitize(config);
    const configPath = this.getAppConfigPath();
    try {
      await fs.promises.writeFile(configPath, JSON.stringify(sanitized, null, 2), 'utf-8');
      logger.info({ msg: '[AppCacheManager] app.json persisted', mod: 'AppCacheManager', path: configPath });
    } catch (error) {
      logger.error({ msg: '[AppCacheManager] Failed to write app.json', mod: 'AppCacheManager', err: error });
      throw error;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Return a read-only copy of the current in-memory AppConfig.
   */
  public getConfig(): AppConfig {
    return { ...this.cache };
  }

  /**
   * Update AppConfig (partial updates supported). Persists and then notifies the frontend.
   * @param updates Fields to update (shallow merge; runtimeEnvironment supports partial field updates)
   */
  public async updateConfig(updates: Partial<AppConfig>): Promise<void> {
    const merged: AppConfig = {
      ...this.cache,
      ...updates,
      // Deep-merge runtimeEnvironment
      runtimeEnvironment:
        updates.runtimeEnvironment || this.cache.runtimeEnvironment
          ? {
              ...(this.cache.runtimeEnvironment ?? DEFAULT_RUNTIME_ENVIRONMENT),
              ...(updates.runtimeEnvironment ?? {}),
            }
          : undefined,
      // Deep-merge screenshotSettings
      screenshotSettings:
        updates.screenshotSettings || this.cache.screenshotSettings
          ? {
              ...(this.cache.screenshotSettings ?? DEFAULT_SCREENSHOT_SETTINGS),
              ...(updates.screenshotSettings ?? {}),
            }
          : undefined,
      // zoomLevel: simple scalar, no deep-merge needed
      zoomLevel: updates.zoomLevel !== undefined ? updates.zoomLevel : this.cache.zoomLevel,
      mainWindowMaximized:
        updates.mainWindowMaximized !== undefined
          ? updates.mainWindowMaximized
          : this.cache.mainWindowMaximized,
    };

    const sanitized = this.appConfigSanitize(merged);
    this.cache = sanitized;

    await this.writeConfigToDisk(sanitized);
    this.scheduleNotifyFrontend();

    logger.info({ msg: '[AppCacheManager] Config updated', mod: 'AppCacheManager', updates });
  }

  // ── Frontend Notification ──────────────────────────────────────────────────

  /**
   * Debounced frontend notification (150 ms).
   */
  private scheduleNotifyFrontend(): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
    }
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.sendConfigToFrontend();
    }, 150);
  }

  /**
   * Immediately send the current cache to the frontend via IPC.
   */
  private sendConfigToFrontend(): void {
    try {
      const targetWindow = mainWindow() ?? anyVisibleWindow();

      if (!targetWindow || targetWindow.isDestroyed()) {
        logger.warn({ msg: '[AppCacheManager] Main window unavailable, skipping notification', mod: 'AppCacheManager' });
        return;
      }

      appMainToRender.bindWebContents(targetWindow.webContents).configUpdated({
        config: { ...this.cache },
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.error({ msg: '[AppCacheManager] Failed to notify frontend', mod: 'AppCacheManager', err: error });
    }
  }

  // ── Screenshot Settings Public API ────────────────────────────────────────

  /**
   * Get the current screenshot settings (read-only copy).
   */
  public getScreenshotSettings(): ScreenshotSettings {
    return { ...(this.cache.screenshotSettings ?? DEFAULT_SCREENSHOT_SETTINGS) };
  }

  /**
   * Update screenshot settings (partial updates supported). Persists and notifies frontend.
   */
  public async updateScreenshotSettings(settings: Partial<ScreenshotSettings>): Promise<boolean> {
    try {
      await this.updateConfig({
        screenshotSettings: {
          ...(this.cache.screenshotSettings ?? DEFAULT_SCREENSHOT_SETTINGS),
          ...settings,
        },
      });
      return true;
    } catch (err) {
      logger.error({ msg: '[AppCacheManager] Failed to update screenshotSettings', mod: 'AppCacheManager', err: err });
      return false;
    }
  }
}

/** Global singleton export */
export const appCacheManager = AppCacheManager.getInstance();
