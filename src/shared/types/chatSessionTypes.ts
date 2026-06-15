/**
 * 历史 ChatSession-flavored 公共类型 —— Phase 5 之后只剩 `AgentUnreadSummary`
 * 还在 renderer (`useAgentUnreadSummary` / sidebar) 和 IPC 契约里使用。
 *
 * 之前这里还堆了 `ChatSession` / `CreateChatSessionParams` /
 * `UpdateChatSessionFileParams` 等基于老 chatTypes.Message 的 interface,但全仓
 * 都没有消费者(grep 0 命中,功能已迁到 `Profiles` / `ChatSession (profileTypes)`
 * / `Session (persist)`)。因此本文件不再依赖 `chatTypes.Message`,Phase 5 删
 * Message 部分时跟随收敛。
 */
export type SchedulerExecutionStatus = 'running' | 'completed' | 'failed';
export type ChatSessionReadStatus = 'read' | 'unread';

/**
 * 单 agent 的未读计数快照(renderer 端形态;主进程返的是 `{ agentId, ... }`,
 * renderer 的 useAgentUnreadSummary 把 `agentId` 改名为 `agentId` 与 UI 模型对齐)。
 */
export interface AgentUnreadSummary {
  agentId: string;
  userUnreadCount: number;
  scheduledUnreadCount: number;
  /** ISO timestamp;按 recency 合并增量更新时取较大者。 */
  updatedAt: string;
}
