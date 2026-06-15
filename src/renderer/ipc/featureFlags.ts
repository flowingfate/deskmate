import { renderToMain } from '@shared/ipc/featureFlags';

export const featureFlagsApi = renderToMain.bindRender(window.electronAPI.featureFlags.invoke);
