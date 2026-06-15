import { renderToMain } from '@shared/ipc/llm';

export const llmApi = renderToMain.bindRender(window.electronAPI.llm.invoke);
