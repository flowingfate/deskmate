import { connectRenderToMain, connectMainToRender } from './base';
import type {
  SubAgentConfig,
  SubAgentRuntimeState,
} from '../types/profileTypes';

type SubAgentRenderToMain = {
  getAll: { call: []; return: { success: boolean; data?: SubAgentConfig[]; error?: string } };
  add: { call: [config: Partial<SubAgentConfig>]; return: { success: boolean; error?: string } };
  update: { call: [name: string, config: Partial<SubAgentConfig>]; return: { success: boolean; error?: string } };
  delete: { call: [name: string]; return: { success: boolean; error?: string } };
  importFromFile: { call: [filePath: string]; return: { success: boolean; data?: SubAgentConfig; error?: string } };
  exportAsClaudeCode: { call: [name: string]; return: { success: boolean; data?: string; error?: string } };
  openInExplorer: { call: [name: string]; return: { success: boolean; error?: string } };
  syncFromDisk: { call: []; return: { success: boolean; data?: SubAgentConfig[]; error?: string } };
};

type SubAgentMainToRender = {
  stateUpdate: SubAgentRuntimeState;
};


export const subAgentRenderToMain = connectRenderToMain<SubAgentRenderToMain>('subAgent');
export const subAgentMainToRender = connectMainToRender<SubAgentMainToRender>('subAgent');
