import { ipcMain } from 'electron';

import type { Context } from './shared';
import { FileNameLlmGenerator, McpConfigLlmFormatter, SystemPromptLlmWriter } from '@main/pi';
import { renderToMain } from '@shared/ipc/llm';
import { requireProfileForSender } from './profileContext';

export default function(ctx: Context) {

  // ===============================
  // LLM related IPC handlers
  // ===============================

  const handle = renderToMain.bindMain(ipcMain);

  // System Prompt optimization
  handle.improveSystemPrompt(async (event, userInputPrompt) => {
    try {
      const result = await SystemPromptLlmWriter.improveSystemPrompt(userInputPrompt, requireProfileForSender(event).id);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // MCP config formatting
  handle.formatMcpConfig(async (event, userInputMcpConfig) => {
    try {
      const result = await McpConfigLlmFormatter.formatMcpConfig(userInputMcpConfig, requireProfileForSender(event).id);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // File name generation (auto-generate file name and extension based on content)
  handle.generateFileName(async (event, content) => {
    try {
      const result = await FileNameLlmGenerator.generateFileName(content, requireProfileForSender(event).id);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
