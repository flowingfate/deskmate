/**
 * IPC channel for the deskmate-native local tools subsystem.
 *
 * Three calls:
 *   - `execute(name, args)` — invoke a tool by name; **renderer 端目前没有
 *     消费者**,留作未来 UI debug / e2e 用。chat 主链路不走 IPC,直接走
 *     `pi/tool.ts::executeToolCall`。
 *   - `getAll()` — enumerate registered tools, used by `/settings/tools` 和
 *     agent editor `tools` tab。
 *   - `has(name)` — boolean check,renderer 校验 agent 配置中残留的 unknown
 *     tool name 用。
 */

import { connectRenderToMain } from './base';
import type { LocalToolInfo } from '../types/toolsTypes';

type RenderToMain = {
  execute: { call: [name: string, args: Record<string, unknown>]; return: { success: boolean; data?: unknown; error?: string } };
  getAll: { call: []; return: { success: boolean; data?: LocalToolInfo[]; error?: string } };
  has: { call: [name: string]; return: { success: boolean; data?: boolean; error?: string } };
};

export const renderToMain = connectRenderToMain<RenderToMain>('tools');
