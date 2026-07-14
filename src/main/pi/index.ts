// pi 子树的唯一外部入口。只导出 src/main/pi 外部实际使用的符号；子树内部仍按
// 依赖方向直接引用具体模块，避免 barrel 反向依赖自身。
//
// 注意：不要在这里 `import './tools'`。那会在 scheduler / subAgentManager 等
// 下游 import `@main/pi` 时触发工具注册，并经 SchedulerManager 回引本入口形成循环。
// `ensureToolsRegistered()` 保持动态 import `./tools/index.ts`，只有真正需要工具
// catalog 或 tools IPC 时才注册。

// 基础设施先导出。`contextCompressionLlmSummarizer` 必须早于 compression/session，
// 因为 lib/compression 的默认摘要实现通过本入口消费它。
export { jsonSchema } from './tools/schema';
export { tools, ensureToolsRegistered } from './tools/registry';
export type { ToolContext } from './tools/types';
export { contextCompressionLlmSummarizer } from './utils/llm-services/contextCompressionLlmSummarizer';

// `internal-urls` 入口会幂等注册内置 protocol handlers；保留既有 quick-access 语义。
export { InternalUrlRouter } from './internal-urls';
export type { ResolveContext } from './internal-urls';
export { LocalProtocolHandler } from './internal-urls/handlers/local-protocol';
export { KnowledgeProtocolHandler } from './internal-urls/handlers/knowledge-protocol';

export { getPiAuthManager } from './auth';
export {
  resolveModel,
  resolveCredentials,
  listModels,
  getModelInfo,
  type ResolvedModel,
} from './model';

export { runUtilityCompletion, runUtilityChat } from './utils/utilityCompletion';
export { SystemPromptLlmWriter } from './utils/llm-services/systemPromptLlmWriter';
export { McpConfigLlmFormatter } from './utils/llm-services/mcpConfigLlmFormatter';
export { FileNameLlmGenerator } from './utils/llm-services/fileNameLlmGenerator';
export { wrapInSystemReminder } from './utils/systemReminderUtils';
export { classifyError } from './utils/errors';

export { toPiContext, fromPiAssistantMessage } from './utils/messageBridge';
export {
  ToolCatalog,
  buildToolCatalogForSubAgent,
  deriveToolTracer,
  executeToolCall,
} from './tool';
export { checkAndCompress } from './compression';

export { Agent } from './agent';
export { RegularSession, JobRun, type PersistSessionLike } from './session';