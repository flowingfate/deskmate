import { connectRenderToMain } from './base';
import type { IpcResult } from './result';

type RenderToMain = {
  getOrCache: { call: [agentName: string, imageUrl: string]; return: IpcResult<string | null> };
  clearAgent: { call: [agentName: string]; return: IpcResult };
  clearAll: { call: []; return: IpcResult };
};

export const renderToMain = connectRenderToMain<RenderToMain>('quickStartImageCache');
