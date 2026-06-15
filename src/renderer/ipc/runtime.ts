import { renderToMain } from '@shared/ipc/runtime';

export const runtimeApi = renderToMain.bindRender(window.electronAPI.runtime.invoke);
