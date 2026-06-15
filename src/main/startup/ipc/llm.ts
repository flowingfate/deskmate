import { ipcMain } from 'electron';

import type { Context } from './shared';
import { SystemPromptLlmWriter } from "@main/pi/utils/systemPromptLlmWritter";
import { McpConfigLlmFormatter } from "@main/pi/utils/mcpConfigLlmFormatter";
import { FileNameLlmGenerator } from "@main/pi/utils/fileNameLlmGenerator";
import { Profiles } from '@main/persist';
import { renderToMain } from '@shared/ipc/llm';

export default function(ctx: Context) {

  // ===============================
  // LLM related IPC handlers
  // ===============================

  const handle = renderToMain.bindMain(ipcMain);

  // System Prompt optimization
  handle.improveSystemPrompt(async (_event, userInputPrompt) => {
    try {
      const result = await SystemPromptLlmWriter.improveSystemPrompt(userInputPrompt, Profiles.get().activeProfileId);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // MCP config formatting
  handle.formatMcpConfig(async (_event, userInputMcpConfig) => {
    try {
      const result = await McpConfigLlmFormatter.formatMcpConfig(userInputMcpConfig, Profiles.get().activeProfileId);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // File name generation (auto-generate file name and extension based on content)
  handle.generateFileName(async (_event, content) => {
    try {
      const result = await FileNameLlmGenerator.generateFileName(content, Profiles.get().activeProfileId);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
