import { connectRenderToMain, connectMainToRender } from './base';
import type { ToolBarSettings } from '../types/profileTypes';

type RenderToMain = {
  show: { call: []; return: { success: boolean; error?: string } };
  hide: { call: []; return: { success: boolean; error?: string } };
  toggle: { call: []; return: { success: boolean; error?: string } };
  isVisible: { call: []; return: { success: boolean; data?: boolean; error?: string } };
  setAlwaysOnTop: { call: [flag: boolean]; return: { success: boolean; error?: string } };
  isAlwaysOnTop: { call: []; return: { success: boolean; data?: boolean; error?: string } };
  getPosition: { call: []; return: { success: boolean; data?: { x: number; y: number }; error?: string } };
  setPosition: { call: [x: number, y: number]; return: { success: boolean; error?: string } };
  getSettings: { call: []; return: { success: boolean; data?: ToolBarSettings; error?: string } };
  updateSettings: { call: [settings: Partial<ToolBarSettings>]; return: { success: boolean; error?: string } };
  updateShortcut: { call: [shortcut: string]; return: { success: boolean; error?: string } };
  resetPosition: { call: []; return: { success: boolean; data?: { x: number; y: number }; error?: string } };
};

type MainToRender = {
  settingsUpdated: Partial<ToolBarSettings>;
};

export const renderToMain = connectRenderToMain<RenderToMain>('toolbar');
export const mainToRender = connectMainToRender<MainToRender>('toolbar');
