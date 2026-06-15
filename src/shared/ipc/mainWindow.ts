import { connectRenderToMain } from './base';
import type { IpcResult } from './result';

type RenderToMain = {
  showWithAgent: { call: [agentId: string]; return: IpcResult };
};

export const renderToMain = connectRenderToMain<RenderToMain>('mainWindow');
