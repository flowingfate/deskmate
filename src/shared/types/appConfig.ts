/**
 * Type definitions for App configuration (app.json)
 *
 * app.json is stored at {userData}/app.json, saving application-level global configuration
 * unrelated to user profiles. Read/write is handled by AppCacheManager.
 */

import type { ScreenshotSettings } from '../ipc/screenshot';
export type { ScreenshotSettings };

// ─── Runtime Environment ──────────────────────────────────────────────────────

/**
 * Runtime environment configuration
 * Corresponds to the `runtimeEnvironment` field in app.json.
 * App-managed only — bun / uv / Python are always provided by the app.
 * Legacy configuration was stored in {userData}/runtimeConfig.json and is auto-migrated on read.
 */
export interface RuntimeEnvironment {
  /** Built-in bun version number, e.g., "1.3.6" */
  bunVersion: string;
  /** Built-in uv version number, e.g., "0.6.17" */
  uvVersion: string;
  /**
   * Pinned Python version
   * Supports two formats:
   * - Short version: "3.10.12"
   * - Full platform identifier: "cpython-3.10.12-macos-aarch64-none"
   * null means no lock, use the latest installed version
   */
  pinnedPythonVersion?: string | null;
}

/**
 * Default Runtime Environment configuration
 */
export const DEFAULT_RUNTIME_ENVIRONMENT: RuntimeEnvironment = {
  bunVersion: '1.3.6',
  uvVersion: '0.6.17',
  pinnedPythonVersion: '3.10.12',
};

// ─── Screenshot ──────────────────────────────────────────────────────────────

/**
 * App-level Screenshot configuration (stored in app.json).
 * Migrated from profile-level screenshotSettings — now shared across all profiles.
 */
export const DEFAULT_SCREENSHOT_SETTINGS: ScreenshotSettings = {
  enabled: true,
  shortcut: 'CommandOrControl+Shift+S',
  shortcutEnabled: false,
  savePath: '',
  freRejected: false,
};

// ─── AppConfig ────────────────────────────────────────────────────────────────

/**
 * Full data structure for app.json
 *
 * All fields are optional; missing fields are filled in by integrityEnsure on read.
 */
export interface AppConfig {
  /**
   * Updater version number, e.g., "0.0.5"
   * Written by Deskmate Updater; the App only reads this field and should not modify it.
   */
  updaterVersion?: string;

  /**
   * Runtime environment configuration.
   * If this field is missing, AppCacheManager will migrate data from the legacy runtimeConfig.json.
   */
  runtimeEnvironment?: RuntimeEnvironment;


  /**
   * Screenshot feature configuration (global, unrelated to user profile).
   * On first read, if missing, AppCacheManager will migrate from the first profile's profile.json; otherwise uses defaults.
   */
  screenshotSettings?: ScreenshotSettings;

  /**
   * Whether the left sidebar is collapsed (global application-level layout preference)
   */
  leftSidebarCollapsed?: boolean;

  /**
   * Left sidebar width (CSS pixels, global application-level layout preference)
   * Range 288 ~ 576, default 288
   */
  leftSidebarWidth?: number;

  /**
   * Whether the right sidebar is collapsed (global application-level layout preference)
   */
  rightSidebarCollapsed?: boolean;

  /**
   * Right sidebar width (CSS pixels, global application-level layout preference)
   * Range 280 ~ 520, default 360
   */
  rightSidebarWidth?: number;

  /**
   * Page zoom level (global, unrelated to user profile)
   * 0 means 100%; each ±0.5 is approximately ±10%; range -3 ~ 3
   */
  zoomLevel?: number;

  /**
   * Whether the main window is maximized (global application-level window preference)
   */
  mainWindowMaximized?: boolean;
}

/**
 * Default AppConfig (minimal usable configuration)
 */
export const DEFAULT_APP_CONFIG: AppConfig = {
  runtimeEnvironment: { ...DEFAULT_RUNTIME_ENVIRONMENT },
  screenshotSettings: { ...DEFAULT_SCREENSHOT_SETTINGS },
  leftSidebarCollapsed: false,
  leftSidebarWidth: 288,
  rightSidebarCollapsed: true,
  rightSidebarWidth: 360,
  zoomLevel: 0,
  mainWindowMaximized: false,
};

// ─── Type Guards ──────────────────────────────────────────────────────────────

/**
 * Determine whether an object is a valid RuntimeEnvironment
 */
export function isRuntimeEnvironment(obj: unknown): obj is RuntimeEnvironment {
  if (obj === null || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.bunVersion === 'string' &&
    typeof o.uvVersion === 'string' &&
    (o.pinnedPythonVersion === undefined ||
      o.pinnedPythonVersion === null ||
      typeof o.pinnedPythonVersion === 'string')
  );
}

/**
 * Determine whether an object is a valid AppConfig (lenient check, allows missing fields)
 */
export function isAppConfig(obj: any): obj is AppConfig {
  if (obj === null || typeof obj !== 'object') return false;
  if (obj.updaterVersion !== undefined && typeof obj.updaterVersion !== 'string') return false;
  if (obj.runtimeEnvironment !== undefined && !isRuntimeEnvironment(obj.runtimeEnvironment)) return false;
  if (obj.leftSidebarCollapsed !== undefined && typeof obj.leftSidebarCollapsed !== 'boolean') return false;
  if (obj.rightSidebarCollapsed !== undefined && typeof obj.rightSidebarCollapsed !== 'boolean') return false;
  if (obj.rightSidebarWidth !== undefined && (!Number.isFinite(obj.rightSidebarWidth) || typeof obj.rightSidebarWidth !== 'number')) return false;
  if (obj.zoomLevel !== undefined && (!Number.isFinite(obj.zoomLevel) || typeof obj.zoomLevel !== 'number')) return false;
  if (obj.mainWindowMaximized !== undefined && typeof obj.mainWindowMaximized !== 'boolean') return false;
  return true;
}
