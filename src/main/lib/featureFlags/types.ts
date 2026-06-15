/**
 * Feature Flag type definitions
 */

export type { FeatureFlagName, FeatureFlagsValues } from '@shared/types/featureFlagTypes';
import type { FeatureFlagName } from '@shared/types/featureFlagTypes';

/**
 * Context used for dynamically computing default values
 */
export interface FeatureFlagContext {
  /** Whether this is a development environment */
  isDev: boolean;
  /** Current brand name */
  brandName: string;
  /** Platform (darwin, win32, linux) */
  platform: NodeJS.Platform;
  /** CPU architecture (arm64, x64, ia32) */
  arch: NodeJS.Architecture;
}

/**
 * Default value type: can be a boolean, or a function that computes based on context
 */
export type FeatureFlagDefaultValue = boolean | ((ctx: FeatureFlagContext) => boolean);

/**
 * Feature Flag configuration
 */
export interface FeatureFlagConfig {
  /** Flag name */
  name: FeatureFlagName;
  /** Description */
  description: string;
  /**
   * Default value: can be a static boolean, or a function that dynamically computes based on context
   * @example
   * // Static value
   * defaultValue: false
   *
   * // Dynamic logic
   * defaultValue: (ctx) => ctx.isDev
   */
  defaultValue: FeatureFlagDefaultValue;
}

/**
 * Feature Flag state
 */
export interface FeatureFlagState {
  /** Flag name */
  name: FeatureFlagName;
  /** Current value */
  enabled: boolean;
  /** Source: default or cli (command line) */
  source: 'default' | 'cli';
}

/**
 * State map for all Feature Flags
 */
export type FeatureFlagsMap = Record<FeatureFlagName, FeatureFlagState>;

