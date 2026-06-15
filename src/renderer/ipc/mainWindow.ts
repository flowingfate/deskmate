import { renderToMain } from '@shared/ipc/mainWindow';

export const mainWindowApi = renderToMain.bindRender(window.electronAPI.mainWindow.invoke);
