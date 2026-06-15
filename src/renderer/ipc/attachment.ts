import { renderToMain } from '@shared/ipc/attachment';

export const attachmentApi = renderToMain.bindRender(window.electronAPI.attachment.invoke);
