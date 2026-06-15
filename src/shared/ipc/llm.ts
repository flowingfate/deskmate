import { connectRenderToMain } from './base';
import type {
  SystemPromptWriterResponse,
  McpConfigFormatterResponse,
  FileNameGeneratorResponse,
} from '../types/llmTypes';

type IpcResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

type RenderToMain = {
  improveSystemPrompt: {
    call: [userInputPrompt: string];
    return: IpcResult<SystemPromptWriterResponse>;
  };
  formatMcpConfig: {
    call: [userInputMcpConfig: string];
    return: IpcResult<McpConfigFormatterResponse>;
  };
  generateFileName: {
    call: [content: string];
    return: IpcResult<FileNameGeneratorResponse>;
  };
};

export const renderToMain = connectRenderToMain<RenderToMain>('llm');
