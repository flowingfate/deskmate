/**
 * GitHub Copilot `/models` API response schema —— 与 GHC 后端契约 1:1。
 *
 * 历史：原在 `src/shared/types/ghcChatTypes.ts`，2026-06-07 因 renderer 端无消费者，
 * 改为 pi 内部局部类型；老 chat engine 协议字段（`GhcModel` / `OpenAiFunctionTool` /
 * `ToolMode` 等）一并下线。
 */
export interface GhcCopilotModel {
  billing: {
    is_premium: boolean;
    multiplier: number;
    restricted_to?: string[];
  };
  capabilities: {
    family: string;
    limits?: {
      max_context_window_tokens?: number;
      max_non_streaming_output_tokens?: number;
      max_output_tokens?: number;
      max_prompt_tokens?: number;
      max_inputs?: number; // For embeddings
      vision?: {
        max_prompt_image_size: number;
        max_prompt_images: number;
        supported_media_types: string[];
      };
    };
    object: 'model_capabilities';
    supports: {
      adaptive_thinking?: boolean;
      parallel_tool_calls?: boolean;
      reasoning_effort?: string[]; // e.g. ['low','medium','high']
      streaming?: boolean;
      structured_outputs?: boolean;
      tool_calls?: boolean;
      vision?: boolean;
      max_thinking_budget?: number;
      min_thinking_budget?: number;
      dimensions?: boolean; // For embeddings
    };
    tokenizer: string;
    type: 'chat' | 'completion' | 'embeddings';
  };
  id: string;
  is_chat_default: boolean;
  is_chat_fallback: boolean;
  model_picker_category?: 'versatile' | 'lightweight' | 'powerful';
  model_picker_enabled: boolean;
  name: string;
  object: 'model';
  policy?: {
    state: 'enabled' | 'disabled';
    terms: string;
  };
  preview: boolean;
  supported_endpoints?: string[]; // API endpoints supported by this model
  vendor: string;
  version: string;
  warning_message?: string;
}
