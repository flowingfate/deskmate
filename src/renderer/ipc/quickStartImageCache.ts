import { renderToMain } from '@shared/ipc/quickStartImageCache';

export const quickStartImageCacheApi = renderToMain.bindRender(window.electronAPI.quickStartImageCache.invoke);
