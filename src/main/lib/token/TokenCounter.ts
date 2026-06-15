/**
 * TokenCounter main class
 * Unified token calculation interface
 */

import { TextTokenCalculator } from './calculators/TextTokenCalculator';
import { ImageTokenCalculator } from './calculators/ImageTokenCalculator';
import { ToolsTokenCalculator } from './calculators/ToolsTokenCalculator';
import type { Message } from '@shared/types/message';
import {
  TokenCounterConfig,
  ImageTokenResult,
  ImageTokenOptions,
  ToolDefinition,
  ToolsTokenResult,
  CacheStats
} from './types';

// Per-message and per-completion token overhead constants
const BASE_TOKENS_PER_MESSAGE = 3;     // Base overhead per message
const BASE_TOKENS_PER_COMPLETION = 3;  // Completion overhead (once per conversation)
const TOOL_CALLS_SAFETY_MARGIN = 1.5;  // tool_calls safety factor

export class TokenCounter {
  private textCalculator: TextTokenCalculator;
  private imageCalculator: ImageTokenCalculator;
  private toolsCalculator: ToolsTokenCalculator;

  constructor(config: TokenCounterConfig = {}) {
    // Support both defaultEncoding and encoding naming
    const encoding = config.defaultEncoding || config.encoding;

    this.textCalculator = new TextTokenCalculator({
      encoding: encoding,
      enableCache: config.enableCache,
      cacheSize: config.cacheSize
    });

    this.imageCalculator = new ImageTokenCalculator();
    this.toolsCalculator = new ToolsTokenCalculator(this.textCalculator);
  }

  /**
   * Count text tokens
   */
  countTextTokens(text: string): number {
    return this.textCalculator.countTokens(text);
  }

  /**
   * Count image tokens
   */
  countImageTokens(options: ImageTokenOptions): ImageTokenResult {
    return this.imageCalculator.calculateTokens(options);
  }

  /**
   * Count tokens for a Message
   */
  countMessageTokens(message: Message): number {
    let totalTokens = 0;

    // Message base overhead
    totalTokens += BASE_TOKENS_PER_MESSAGE;

    // 文本主体 —— Domain `content` 是单串字符串,user/assistant 通用
    totalTokens += this.textCalculator.countTokens(message.content);

    if (message.role === 'user') {
      // 图片附件:仅 image kind 计入视觉 token;file/office/opaque 走 LLM 文本路径,
      // 已经在生成 prompt 时被序列化进 content,这里不再重复计费。
      for (const att of message.attachments) {
        if (att.kind === 'image') {
          const result = this.imageCalculator.calculateFromAttachment({
            detail: att.detail,
            width: att.width,
            height: att.height
          });
          totalTokens += result.tokens;
        }
      }
      return totalTokens;
    }

    // assistant: think 也属于模型输出文本,需计费
    totalTokens += this.textCalculator.countTokens(message.think);

    // tool_calls — apply ×1.5 safety factor.
    // Domain ToolCall 形如 { id, name, time, args, response? };JSON.stringify
    // 序列化整个对象,response 若已落盘也一并计入。
    if (message.tool_calls.length > 0) {
      let toolCallTokens = 0;
      for (const toolCall of message.tool_calls) {
        const toolCallJson = JSON.stringify(toolCall);
        toolCallTokens += this.textCalculator.countTokens(toolCallJson);
      }
      totalTokens += Math.ceil(toolCallTokens * TOOL_CALLS_SAFETY_MARGIN);
    }

    return totalTokens;
  }

  /**
   * Count tokens for multiple messages
   */
  countMessagesTokens(messages: Message[]): number {
    // Initialize total to the per-completion base overhead
    let totalTokens = BASE_TOKENS_PER_COMPLETION;

    for (const message of messages) {
      totalTokens += this.countMessageTokens(message);
    }

    return totalTokens;
  }

  /**
   * Count tokens for tools
   */
  countToolsTokens(tools: ToolDefinition[]): ToolsTokenResult {
    return this.toolsCalculator.calculateAllToolsTokens(tools);
  }

  /**
   * Count tokens for System Prompt + Tools
   */
  countSystemPromptWithTools(
    systemPrompt: string,
    tools: ToolDefinition[]
  ): ToolsTokenResult {
    return this.toolsCalculator.calculateSystemPromptWithTools(systemPrompt, tools);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.textCalculator.clearCache();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return this.textCalculator.getCacheStats();
  }

  /**
   * Get current encoder type
   */
  getEncoding(): 'cl100k_base' | 'o200k_base' {
    return this.textCalculator.getEncoding();
  }
}