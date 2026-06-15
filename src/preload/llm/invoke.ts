import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/llm';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'improveSystemPrompt',
  'formatMcpConfig',
  'generateFileName',
]);

export default invoke;
