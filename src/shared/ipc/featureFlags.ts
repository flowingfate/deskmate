import { connectRenderToMain } from './base';
import type { FeatureFlagsValues } from '../types/featureFlagTypes';

type RenderToMain = {
  getAllFlags: {
    call: [];
    return: { success: true; data: FeatureFlagsValues } | { success: false; error: string };
  };
};

export const renderToMain = connectRenderToMain<RenderToMain>('featureFlags');
