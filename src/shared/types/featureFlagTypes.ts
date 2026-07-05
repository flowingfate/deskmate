/**
 * All known Feature Flag names
 * Naming convention: deskmateFeatureXXXXX
 * Add new feature flags here
 */
export type FeatureFlagName =
  | 'deskmateFeatureScreenshot'         // Screenshot capture feature
  | 'deskmateUseGit'                    // Git integration feature
  | 'deskmateFeatureScheduler'          // Cron-based scheduled task system
  | 'deskmateFeatureSubAgent'           // Sub-Agent system

  // Add more feature flags here...
  ;

/**
 * Simplified Feature Flags value map
 */
export type FeatureFlagsValues = Record<FeatureFlagName, boolean>;
