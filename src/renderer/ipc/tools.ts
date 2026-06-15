import { renderToMain } from '@shared/ipc/tools';

export const toolsApi = renderToMain.bindRender(window.electronAPI.tools.invoke);
