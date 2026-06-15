import { renderToMain } from '@shared/ipc/internalUrls';

export const internalUrlsApi = renderToMain.bindRender(window.electronAPI.internalUrls.invoke);
