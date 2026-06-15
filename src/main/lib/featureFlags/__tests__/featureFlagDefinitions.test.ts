import { getFeatureFlagConfig, resolveDefaultValue } from '../featureFlagDefinitions';
import type { FeatureFlagContext } from '../types';

describe('featureFlagDefinitions', () => {
  const productionContext: FeatureFlagContext = {
    isDev: false,
    brandName: 'deskmate',
    platform: 'darwin',
    arch: 'arm64',
  };

  it('keeps deskmateFeatureSubAgent dev-only', () => {
    const config = getFeatureFlagConfig('deskmateFeatureSubAgent');

    expect(config).toBeDefined();
    expect(resolveDefaultValue(config!.defaultValue, productionContext)).toBe(false);
  });
});
