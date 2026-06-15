// src/renderer/lib/chat/index.ts
// Renderer 端 chat / agent / session 编排模块的 barrel 出口。

// Agent Configuration Operations（兼容层；详见 agentOps.ts 文件头）
export * from './agentOps';

// ChatSession Operations
export * from './chatSessionOps';

// Agent Session Cache Manager（按 agent → sessions 维护渲染端缓存）
export { agentSessionCacheManager } from './agentSessionCacheManager';
export * from './agentSessionCacheManager';

// 架构说明：
// - 主进程持有 AgentChat 引擎；前端只通过 IPC 与之交互
// - agentOps 提供 agent 维度的配置 CRUD（compat shim,详见文件头）
// - chatSessionOps 提供单 chat session 的 CRUD（fork / delete / 等）
// - agentSessionCacheManager 是渲染端 chat session 的统一状态/缓存入口
