<!-- Last verified: 2026-07-16 (冻结旧 runtime；仅记录 Step 9 前临时安全适配) -->
# Sub-Agent System（冻结旧实现）

> 本模块只在 Step 9 原子 cutover 前维持现有生产入口。新代码不得依赖、扩写或复制本模块；不为其新增测试和兼容契约。

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
  - `@main/pi` 导出的 `checkAndCompress` —— 阈值通过构造参数注入 0.60（vs 主 chat 0.85）
  - `@main/pi` 导出的 `executeToolCall` 临时接收 delegate mode；旧 runtime 没有普通 Agent delegate ID，故 `delegateId=agentId=父 Agent`。这是防止旧 `app subagent` 递归的过渡适配，Step 9 必须随旧入口一起删除，不属于新 runtime 契约
  - `@main/pi` 导出的 `resolveModel + resolveCredentials` 跨 provider 解析（baseUrl 按 fresh OAuth credentials 派生，GHC enterprise 账户必经；`resolveApiKey` 不在公共入口，stream 路径只用 `resolveCredentials`）
- **模型解析**：sub-agent `model` 字段为空 / `'inherit'` → 取父 `pi.RegularSession.getCurrentModelId()`；不是合法 `provider::id` 复合 key → 回退到父模型并打 warn；父没模型 → spawn 直接 fail。
- **工具来源**:走 `@main/pi` 导出的 `buildToolCatalogForSubAgent(cfg, mcpSelections)` —— 父继承 + 本地 `tools` 白名单 + `disallowTools` 二次过滤。MCP tool 以 `serverName/toolName` 给 LLM，route 精确保留原始 server / tool 名；sub-agent 历史由同一入口的 `fromPiAssistantMessage(final, catalog)` demux 回自然 toolName + MCP server（出境回放由 `toLlmToolName` 再限定），**不**按 `/` 反解。**`app` 工具不再被按 name 移除**(`app` 是 sub-agent 触达全部应用能力的唯一入口,移除等于禁掉所有应用能力);递归保护下沉到 `app subagent ...` 命令内部 `ensureSpawnPrerequisites`,sub-agent 调 spawn 时 exit 1 + stderr。MCP 工具按 server-scoped 路由到 `executeToolOnServer`,本地工具按 `route.kind === 'local'` 路由到 `pi/tools/registry.tools.execute(name, args, ctx)`。
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
- ⚠️ **临时 delegate bridge**：只为 Step 9 前的旧生产入口阻止递归；不得被新代码引用，cutover 时必须删除。
- ⚠️ **不发 StreamingChunk**：sub-agent 走 `SubAgentStepUpdate` IPC（`subAgent:stateUpdate`），不要往其上接 StreamingChunk 链路。
- ⚠️ **AGENT.md 写锁**：通过 `writeLock` Map 串行化（与 `RuntimeManager.installLocks` 同模式）。并发 spawn 绕过会损坏文件。
- ⚠️ **pi-ai stream 已经处理截断 tool call**：老 SubAgentChat 自带的 repair fallback 已下线。
- ⚠️ **递归保护**：冻结旧命令的 `ensureSpawnPrerequisites(ctx)` 暂按 `ctx.mode === 'delegate'` 拒绝；新 runtime 通过 reduced catalog 结构性移除 `subagent`。

## Related
- 依赖：[pi 子树](../../pi/ai.prompt.md)（model + session + compression + tool + utility）、[MCP Runtime](../mcpRuntime/ai.prompt.md)、[Skill](../skill/ai.prompt.md)
- 被依赖：冻结的 `app subagent` AppCommand（`appcmd/builtins/app/subagent/`），仅到 Step 9 cutover。
