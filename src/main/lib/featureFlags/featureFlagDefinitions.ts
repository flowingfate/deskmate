/**
 * Feature Flag Definitions
 *
 * All feature flag configurations are defined in this file.
 *
 * Naming convention: deskmateFeatureXXXXX
 *
 * When adding a new feature flag:
 * 1. Add the name to FeatureFlagName in types.ts
 * 2. Add the configuration in this file
 *
 * defaultValue supports two forms:
 * 1. Static boolean: defaultValue: false
 * 2. Dynamic function: defaultValue: (ctx) => ctx.isDev
 */

import { FeatureFlagConfig, FeatureFlagName, FeatureFlagContext, FeatureFlagDefaultValue } from './types';

/**
 * Feature Flag configuration list
 *
 * Grouped by feature module for easier maintenance
 */
export const FEATURE_FLAG_DEFINITIONS: FeatureFlagConfig[] = [
  // ============== Screenshot ==============
  {
    name: 'deskmateFeatureScreenshot',
    description: 'Screenshot feature (enabled in all environments)',
    defaultValue: true,
  },


  // ============== Git Integration ==============
  {
    name: 'deskmateUseGit',
    description: 'Git integration feature for version control operations',
    defaultValue: (ctx) => ctx.isDev,
  },

  // ============== Scheduler ==============
  {
    name: 'deskmateFeatureScheduler',
    description: 'Cron-based scheduled task system',
    defaultValue: () => true,
  },

  // ============== Sub-Agent ==============
  {
    name: 'deskmateFeatureSubAgent',
    description: 'Sub-Agent system — spawn tools, settings UI, system prompt injection',
    defaultValue: (ctx) => ctx.isDev,
  },

  // ============== Doctor ==============
  {
    name: 'deskmateFeatureDoctor',
    description: 'Doctor (in-app self-diagnosis) Report Bug entry in UserMenu (dev environment only)',
    defaultValue: (ctx) => ctx.isDev,
  },


];

/**
 * Map for fast configuration lookup
 */
export const FEATURE_FLAG_CONFIG_MAP: Map<FeatureFlagName, FeatureFlagConfig> = new Map(
  FEATURE_FLAG_DEFINITIONS.map(config => [config.name, config])
);

/**
 * Get feature flag configuration
 */
export function getFeatureFlagConfig(name: FeatureFlagName): FeatureFlagConfig | undefined {
  return FEATURE_FLAG_CONFIG_MAP.get(name);
}

/**
 * Get all feature flag names
 */
export function getAllFeatureFlagNames(): FeatureFlagName[] {
  return FEATURE_FLAG_DEFINITIONS.map(config => config.name);
}

/**
 * Resolve default value (supports both static values and dynamic functions)
 */
export function resolveDefaultValue(
  defaultValue: FeatureFlagDefaultValue,
  context: FeatureFlagContext
): boolean {
  if (typeof defaultValue === 'function') {
    return defaultValue(context);
  }
  return defaultValue;
}
