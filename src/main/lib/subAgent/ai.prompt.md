<!-- Last verified: 2026-07-14 (SubAgentConfig schema 收敛至 shared/persist/types/) -->
# Sub-Agent System

> 在父 agent 对话中按需 spawn / 控制生命周期 / 报告结果的轻量 sub-agent。

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `subAgentManager.ts` | 单例：生命周期 + 并行/总数限制 + 父子追踪 + IPC 节流推送 | medium |
| `subAgentChat.ts` | Sub-agent runner wrapper：稳定的 4 层 system prompt + Phase 0 消息计数压缩 + 请求尾部 turn-progress reminder + 工具结果蒸馏 + follow-up 引导 + deliverables 跟踪 | medium |
| `subAgentSession.ts` | 一轮对话最小单元：纯内存 messages 数组 + 复用 pi 原子（stream / executeToolCall / checkAndCompress / overflow 重试）；将 `transientReminder` 仅附到本次请求的消息尾部 | medium |
| `types.ts` | 运行时类型（`SubAgent`、`SubAgentChatOptions`、`SubAgentStepUpdate`），依赖 shared persist 的 `SubAgentConfig` | small |

## Architecture
- **SubAgentManager** 是单例（`getInstance()`），硬限制来自 `shared/types/profileTypes` 的 `SUB_AGENT_LIMITS`：最多 5 个并行实例，每个父 session 最多 20 次 spawn。超出向父 LLM 返回错误而非抛异常。
- **SubAgentChat** 持有一个 `SubAgentSession`。每次 wrapper 调一次 `session.runTurn({ systemPrompt, catalog, signal, hooks })` = 一次 LLM 调用 + 跟随的 tool batch。wrapper 在 turn 间：
  - 跑 **Phase 0 消息计数压缩**：context 超过 20 条 → 头 15 条蒸馏为单条 user summary（走 `runUtilityCompletion` + claude-haiku-4.5）
  - 将动态 **turn-progress hint**（"Turn N/M, 还剩 K 轮"）作为不落盘的 `transientReminder` 附在请求消息尾部，保持 system prompt prefix 可缓存
  - 决策 **follow-up**：纯文本响应若像 intent（"Let me…"），追加 "Please execute…" 再跑一轮
  - **追踪 deliverables**：两条来源 —— ① `write`（顶层工具）按 `toolArgs.fileUri` 入册；② shell 命令（`web download` 等）经**结构化 `ToolResult.deliverables` 回流**入册（`AppCmdContext.addDeliverable` → dispatcher → facade → `executeToolCall` → hook，toolName 无关，不解析 cmdline）。最终结果末尾汇报。`present_deliverables` 工具已下线，UI 端改为扫描 assistant 收尾文字里的 URI 渲染卡片；后台 audit 仍由这两条自动追踪兜底。
- **SubAgentSession** 自己维护内存 messages 数组（不落盘）。不继承 `BaseSession` —— sub-agent 是 wrapper 控 turn 节奏，借不到 30-轮 for loop 抽象，自己写 ~200 行 turn loop 复用 pi 原子能力：
  - `pi.stream`（动态 import）做 SSE 解析与 tool call args parse
  - `pi/compression.checkAndCompress` —— 阈值通过构造参数注入 0.60（vs 主 chat 0.85）
  - `pi/tool.executeToolCall(scope)` 透传 `isSubAgent: true`，让 `app subagent ...` 的递归保护生效
  - `pi/model.resolveModel + resolveCredentials` 跨 provider 解析（baseUrl 按 fresh OAuth credentials 派生，GHC enterprise 账户必经；`resolveApiKey` 不要用，stream 路径只用 `resolveCredentials`）
- **模型解析**：sub-agent `model` 字段为空 / `'inherit'` → 取父 `pi.RegularSession.getCurrentModelId()`；不是合法 `provider::id` 复合 key → 回退到父模型并打 warn；父没模型 → spawn 直接 fail。
- **工具来源**:走 `pi/toolCatalog.buildToolCatalogForSubAgent(cfg, mcpSelections)` —— 父继承 + 本地 `tools` 白名单 + `disallowTools` 二次过滤。MCP tool 以 `serverName/toolName` 给 LLM，route 精确保留原始 server / tool 名；sub-agent 历史由 `messageBridge.fromPiAssistantMessage(final, catalog)` demux 回自然 toolName + MCP server（出境回放由 `toLlmToolName` 再限定），**不**按 `/` 反解。**`app` 工具不再被按 name 移除**(`app` 是 sub-agent 触达全部应用能力的唯一入口,移除等于禁掉所有应用能力);递归保护下沉到 `app subagent ...` 命令内部 `ensureSpawnPrerequisites`,sub-agent 调 spawn 时 exit 1 + stderr。MCP 工具按 server-scoped 路由到 `executeToolOnServer`,本地工具按 `route.kind === 'local'` 路由到 `pi/tools/registry.tools.execute(name, args, ctx)`。
- **取消传播**：sub-agent 共享父 `cancellationSignal` —— 取消父 session 自动终止所有运行中 sub-agent；超大 LLM 摘要走 `Promise.race` 超时兜底。
- **不持久化**：results 仅记录在父 `AgentChat` 的 tool-result 消息中。
- **状态推送**：`SubAgentStepUpdate` → `SubAgentManager.sendStateUpdate` → IPC `subAgent:stateUpdate`，100ms 节流（leading + trailing），terminal 状态 force=true 直发。

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| 改 spawn 限制 | `shared/types/profileTypes.ts` (`SUB_AGENT_LIMITS`) | Manager 从此处读 |
| 加 sub-agent 配置字段 | `shared/persist/types/subAgent.ts`（经 `types/index.ts` 导出）+ `persist/lib/subAgentMarkdown.ts` | 更新 YAML 序列化和迁移 |
| 改单轮 / 单任务上限 | `subAgentChat.ts` 文件顶部常量 (`DEFAULT_MAX_TURNS`, `MSG_COUNT_*`, `TOOL_RESULT_SUMMARIZE_*`) | 同时检查 `SUB_AGENT_LIMITS.DEFAULT_MAX_TURNS` |
| 改压缩阈值 | `subAgentChat.ts` (`SUB_AGENT_COMPRESSION_THRESHOLD`) 传入 `SubAgentSession` 构造 | 主 chat 的 0.85 在 `pi/compression.DEFAULT_COMPRESSION_THRESHOLD` |
| 改 follow-up 启发式 | `subAgentChat.ts` (`INTENT_PATTERNS` / `shouldContinueAfterTextResponse`) | 不要下沉到 pi |
| 向渲染进程暴露新 step type | `types.ts` (`SubAgentStepUpdate`) + `subAgentManager.ts` (onStepUpdate 分支) + `subAgentChat.ts` (调用点) | 注意 step 列表 FIFO 30 上限 |

## Gotchas
- ⚠️ **`isSubAgent` 标志必须透传**:sub-agent 调 `executeToolCall` 时 `scope.isSubAgent = true`,否则 `app subagent ...` 命令的递归保护失效,会无限 spawn。`SubAgentSession.handleToolCalls` 已默认带上。
- ⚠️ **不发 StreamingChunk**：sub-agent 走 `SubAgentStepUpdate` IPC（`subAgent:stateUpdate`），不要往其上接 StreamingChunk 链路。
- ⚠️ **AGENT.md 写锁**：通过 `writeLock` Map 串行化（与 `RuntimeManager.installLocks` 同模式）。并发 spawn 绕过会损坏文件。
- ⚠️ **pi-ai stream 已经处理截断 tool call**：老 SubAgentChat 自带的 `normalizeToolCalls` / `detectTruncatedToolCalls` / `repairToolCallArguments` 整条 fallback 链已下线。`pi.stream` 给的 `ToolCall.arguments` 已 parse 完整；只在 SubAgent wrapper 收到 `stopReason: 'length'` 时把这一轮当作"text 截断 → 继续 follow-up"处理。
- ⚠️ **`isSubAgent` 与递归保护**:`app subagent spawn` / `spawn-many` 子命令通过 `ensureSpawnPrerequisites(ctx)` 在 `ctx.isSubAgent === true` 时拒绝(exit 1 + "recursion not allowed");dispatcher 透传 `isSubAgent` 字段,链路完整。

## Related
- 依赖：[pi 子树](../../pi/ai.prompt.md)（model + session + compression + tool + utility）、[MCP Runtime](../mcpRuntime/ai.prompt.md)、[Skill](../skill/ai.prompt.md)
- 被依赖:`app subagent` AppCommand(`appcmd/builtins/subagent/`),`spawn_subagent` / `spawn_subagents` LocalTool 已于 2026-06 物理删除并迁入 `app subagent spawn` / `spawn-many`。
