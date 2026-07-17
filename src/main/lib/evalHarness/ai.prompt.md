<!-- Last verified: 2026-07-17 (Step 13：旧嵌套委派 transcript 评测字段已删除) -->
# Eval Harness

> 用于与 AgenticEval（外部 agent 评估系统）集成的 HTTP 服务器。暴露 `/eval/health`、`/eval/run` 和 `/eval/judge` 接口，支持单轮和多轮评估会话。

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `evalHttpServer.ts` | 带评估接口的 HTTP 服务器：请求路由、JSON body 解析、AbortSignal 超时、生命周期管理 | ~230 LOC |
| `evalProtocol.ts` | 请求/响应校验用的 TypeScript 类型 + Zod schema | ~70 LOC |
| `evalAgentRunner.ts` | `run_test` 处理器：管理内存 `RegularSession`，支持多轮会话缓存、每会话轮次串行化、空闲驱逐；响应只扁平化当前 turn 的 Domain messages 与工具结果 | ~280 LOC |
| `evalJudgeRunner.ts` | `judge` 处理器：使用调用方提供的消息直接调用 LLM，不走 agent 循环 | ~60 LOC |

## Architecture
- 通过 `main.ts` 中 `onReady()` 的 `--eval-mode` 标志激活。跳过窗口创建、分析和自动更新，仅初始化 auth、profile、MCP 和 chat 单例。启动逻辑位于 `src/main/startup/evalMode.ts`。
- eval 模式下绕过单实例锁（允许与 GUI 同时运行）。
- HTTP 服务器绑定到 `127.0.0.1:8100`（可通过 `--eval-port=NNNN` 配置），使用原生 `http.createServer`。
- **认证：** 除 `/eval/health` 外，所有接口均需 `Authorization: Bearer <token>`。token 从 `EVAL_AUTH_TOKEN` 环境变量读取，必须由调用方（AgenticEval）在启动 Deskmate 前设置。未设置时服务器拒绝启动。
- **无 CORS 头** — localhost 到 localhost 不需要 CORS，省略 header 可阻止浏览器发起的跨域请求。
- **单轮：** 不带 `session_id` 的 `run_test` 创建一个内存 `RegularSession`，以 `PersistSessionLike` no-op shim 隔离磁盘；成功后缓存供多轮续接，并返回其 `session_id`。
- **多轮：** 带 `session_id` 的 `run_test` 复用缓存的 `RegularSession`。每个会话通过基于 Promise 的锁串行化轮次，防止并发修改。会话在闲置 15 分钟后或超出容量（10 个会话）时被驱逐。
- **超时安全：** 首轮请求传入 `AbortSignal`，防止超时的运行泄漏到会话缓存。若信号在缓存前被终止，session 不进入缓存。
- **无持久化：** Eval 会话只经 no-op persistence shim 保留内存状态，不向磁盘写入会话数据，也无需 UI 过滤。
- `judge` 走 `@main/pi` 导出的 `runUtilityChat`（实现位于 `pi/utils/utilityCompletion.ts`；多 provider；非流式；不带工具）。

## Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/eval/health` | 健康检查 — 返回 `{ "status": "ok" }` |
| POST | `/eval/run` | 完整 agent 端到端循环 — body `{ "prompt": "...", "metadata": {}, "session_id": "..." (optional) }` |
| POST | `/eval/judge` | 原始 LLM 调用 — body `{ "messages": [{ "role": "...", "content": "..." }] }` |

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| 新增接口 | `evalHttpServer.ts`（路由）、`evalProtocol.ts`（schema） | 遵循现有处理器模式 |
| 修改默认端口 | `evalHttpServer.ts`（`DEFAULT_PORT` 常量） | 当前为 8100 |
| 修改使用的 agent | `evalAgentRunner.ts`（`getDefaultChatId`） | 当前使用 profile 的 `primaryAgent` |
| 修改 judge 模型 | `evalJudgeRunner.ts`（`getAgentModelId`） | 当前使用 agent 配置的模型 |
| 修改会话限制 | `evalAgentRunner.ts`（`MAX_SESSIONS`、`SESSION_IDLE_TIMEOUT_MS`） | 当前为 10 个会话、15 分钟空闲 |

## Gotchas
- ⚠️ `EVAL_AUTH_TOKEN` 环境变量**必须设置** — 未设置时服务器启动时抛出异常。AgenticEval 通过其 adapter 配置自动设置该变量。
- ⚠️ 用户必须通过 GUI 至少登录一次，eval 模式才能正常工作 — auth token 从持久化会话中读取。
- ⚠️ `EvalAgentRunner` 直接构造内存 `RegularSession`。若其构造签名或 `startStream` 生命周期变化，必须同步评估 runner。
- ⚠️ 端口 8100 不得与其他服务冲突。
- ⚠️ 每会话的轮次锁可防止并发修改，但**不会**取消正在进行的 LLM 调用。卡住的轮次会阻塞同一会话上的后续轮次，直到超时/驱逐。
- ⚠️ `runOneShot` 是公开方法（由 `evalHttpServer.ts` 直接调用以支持 AbortSignal）。`runWithSession` 保持私有。

## Related
- 依赖：[Chat Engine](../chat/ai.prompt.md)、[LLM](../llm/ai.prompt.md)、`@main/persist`（profile/auth 读取）、[MCP Runtime](../mcpRuntime/ai.prompt.md)、[Auth](../auth/ai.prompt.md)
- 入口点：`src/main/startup/evalMode.ts` → `src/main/main.ts`（`onReady()`）
