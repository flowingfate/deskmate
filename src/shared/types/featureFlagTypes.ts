/**
 * All known Feature Flag names
 * Naming convention: deskmateFeatureXXXXX
 * Add new feature flags here
 */
export type FeatureFlagName =
  | 'deskmateUseGit'                    // Git integration feature
  | 'deskmateFeatureSubAgent'           // Sub-Agent system

  // Add more feature flags here...
  ;

/**
 * Simplified Feature Flags value map
 */
export type FeatureFlagsValues = Record<FeatureFlagName, boolean>;
