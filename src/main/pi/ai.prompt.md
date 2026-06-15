<!-- Last verified: 2026-06-15 (Phase 5 Domain Message + Resume + chatTypes Message 下线) -->
# pi 模块 — Chat 引擎（pi-ai 底座）

> Deskmate 的 chat orchestrator，基于 `@earendil-works/pi-ai` 适配多 provider。
> chat / auth / models 的唯一生产路径。完整 turn loop 架构图见
> [`ai.prompt/agent-loop.md`](../../../ai.prompt/agent-loop.md)。

## 关键文件

| 文件 | 职责 | 规模 |
|------|------|------|
| `agent.ts` | Agent 注册表 + getOrCreateSession | 小 |
| `prompt.ts` | system prompt 拼装(identity + knowledge + skills + sub-agents + global) | 小 |
| `session.ts` | `BaseSession` 抽象基类 + `RegularSession`(UI 流式)+ `JobRun`(scheduler 静默);turn loop + tool 并行 + 压缩 + overflow 兜底 + 取消;**per-turn 构建 `ToolCatalog`** 并把 `ToolContext` 显式透传给 `executeToolCall` | 中 |
| `toolCatalog.ts` | per-turn `ToolCatalog` 构建器(`buildToolCatalogForAgent` / `buildToolCatalogForSubAgent`);同时持 `pi.Tool[]`(给 LLM)与 `routes: Map<toolName, ToolRoute>`(`'local' | 'mcp'+serverName`);冲突检测(local∩mcp 同名立即抛) | 小 |
| `tool.ts` | `executeToolCall(call, catalog, ctx)`:按 `route.kind` 分发到本地 registry 或 `executeMcpToolOnServer`;`ask` follow-up;tracer 起 `chat.tool` span | 中 |
| `tools/` | **本地工具子系统** —— `LocalTool` registry + `ToolContext` + `lazy(spec, loader)` + 所有具体工具文件。**chat 主链路直接调 `tools.execute(name, args, ctx)`,不再绕 MCP 假 server**。详见 [`tools/ai.prompt.md`](./tools/ai.prompt.md) | 见子目录 |
| `auth.ts` | PiAuthManager:OAuth + apiKey 存取 + expires-based refresh + inflight dedup | 中 |
| `compression.ts` | 压缩决策(usage 来自 pi.usage.input)+ 内置 compressWithFullMode 调用 | 小 |
| `errors.ts` | classifyError + overflow / network / rate / auth 分类 | 小 |
| `utility.ts` | 非 streaming 后台调用 `runUtilityCompletion`(doctor / eval / 后台 LLM utility 共用入口) | 小 |
| `mcp.ts` | external MCP 工具薄包装:`listAllMcpTools()`(给 catalog 列举外部工具)/ `executeMcpToolOnServer(serverName, toolName, args, signal)`(server-scoped 执行,**不再**有按裸 toolName 查全局 map 的路径) | 小 |
| `utils/messageBridge.ts` | Domain `Message`(`@shared/types/message`)↔ `pi.Message` **唯一翻译点**:入境 `fromPiAssistantMessage`(把 ThinkingPart / TextPart / ToolCallPart 折成单串 `think` + `content` + `tool_calls[]`),出境 `toPiContext` 1→N 展开 `assistant.tool_calls[i].response` 为 `pi.toolResult` 行 | 中 |
| `utils/fileAnnotation.ts` | 附件文本渲染 | 小 |
| `utils/config.ts` | agent 配置读取(`readAgentConfig` + `readAgentRuntimeConfig`,返回 `{agent, parsedModel}` 元组;capability 派生不在这里,见 `model.ts`) | 小 |
| `utils/buildLlmContext.ts` | 压缩快照回放 → 完整 LLM 上下文 | 小 |
| `utils/globalSystemPrompt.ts` | 全局 system prompt 拼装 | 中 |
| `utils/systemReminderUtils.ts` | system reminder 注入 | 小 |
| `utils/promptTemplates.ts` | prompt.ts 用到的拼接模板(identity / knowledge / skills / sub-agents) | 中 |
| `utils/systemPromptLlmWritter.ts` | LLM 润色 system prompt(IPC `improveSystemPrompt`) | 中 |
| `utils/mcpConfigLlmFormatter.ts` | LLM 解析 MCP server 配置(IPC `formatMcpConfig`) | 中 |
| `utils/fileNameLlmGenerator.ts` | LLM 生成下载文件名(IPC `generateFileName`) | 小 |
| `utils/contextCompressionLlmSummarizer.ts` | 压缩摘要 LLM 调用(主链路压缩) | 中 |
| `providers/ghc/` | **当前未被 model registry 消费**(已让位给 pi-ai 内置 model 表)。`config.ts`(GHC_CONFIG —— OAuth 流程引用 USER_AGENT/Editor-Version)+ `models.ts`(ghcModelsManager 单例,被 `main.ts` import 触发构造,构造内 fire-and-forget refreshFromRemote 维护 `models/github-copilot.json` 本地缓存,留作未来恢复"动态 `/models`"路径的备用)+ `types.ts`(GhcCopilotModel) | 中 |

## 架构

**数据流**:renderer → `ipc/agent-chat` → `pi.Agent` → `pi.Session` → `pi.streamSimple()` → `messageBridge` → IPC chunk → renderer

**依赖规则**:

```
agent → session → prompt / tool / mcp / compression → utils/internal
```

无环、无双向回调、按需注入纯函数 hook。

**Domain Message 是事实源**:`src/shared/types/message.ts` 是主进程内存的 canonical 形态(也是 IPC 契约的入参/出参)。`pi.Message` 仅作 LLM 协议适配。`shared/types/chatTypes.ts` 在 Phase 5 后只剩 LlmApi / 文件常量,不再承载 Message shape。

**bridge 单点**:`utils/messageBridge.ts` 是 Domain Message ↔ pi.Message 唯一翻译点。其他任何模块(renderer / IPC / persist / skill / prompt)都不感知 pi。

**Resume**:`BaseSession.restore()` 在 `SessionDataFile.turn?.status === 'running'` 时调 `resume.ts:planResume` 算出 `pendingResume` 缓存到自身。下次 entry(`startStream` 等)在常规工作前消化它,把所有非平凡分支(runMissingTools / continueLoop / startTurn)统一收敛为 `aborted + idle`(终态设计,不再扩展自动续跑)。异常状态由 `loadChatSessionSnapshot` 在 `turn=running` 时填 `errorMessage` 透到 UI,渲染端 ErrorBar + Retry 让用户手动重试。详见 [`agent-loop.md` §4.5](../../../ai.prompt/agent-loop.md#45-resume崩溃后续跑)。

**Auth 隔离**:每个 `profileId` 一个 `PiAuthManager`,绑定 `{userData}/profiles/{profileId}/auth.pi.json`(磁盘文件名 `auth.pi.json`,目录名 `p_{ulid}`)。同 provider 并发 refresh 用 inflightRefresh Map 去重。

**主链路 tracer**:`BaseSession.sessionTracer: Tracer`(不是裸 tid)。IPC handler 在 `agent-chat.ts` 用 `Tracer.deserialize(msgTrace).derive().bind({mod:'chat.ipc',...})` 起 chat.ipc tracer,整个 tracer 透传给 `session.startStream / retryStream / editUserMessage / JobRun.run`。`BaseSession.prepareSessionTracer(parent?: Tracer)` 把 chat.ipc tracer 挂到 sessionTracer;`runTurnLoop` 起 chat.turn = `sessionTracer.derive()`;`streamOneRound` 起 chat.llm span;`executeToolCall` 起 chat.tool span(`ToolExecutionScope.tracer?: Tracer`);`checkAndCompress({tracer})` 让 chat.compress / chat.compress.summary 共链。tid / sid 仅运行时使用,**不入 persist**。

## 常见变更

### 新增 provider
1. **provider 必须在 pi-ai 内置 model 表里**(`@earendil-works/pi-ai/dist/models.generated.ts` 的 `MODELS[provider]`)。pi-ai 不识别的 provider,`listModels(provider)` 会返空数组、`resolveModel` 会抛"Unknown model"。pi-ai 版本升级时新模型会自动出现;服务商真发了 pi-ai 还没收录的新模型,等 npm 升级。
2. **登录路径**:在 `pi/auth.ts` 把 provider 加进相应的 OAuth / apiKey 白名单。`resolveCredentials` 不需要动 —— 它按 `model.provider` 查 `PiAuthManager.getOAuthCredentials` / `getApiKey`,OAuth 路径会自动套用 pi-ai `provider.modifyModels` hook(若有)派生 baseUrl。
3. 在 `renderer/components/settings/auth/providerRegistry.ts` 加 UI 入口。
4. 跑 `pi:listModelsForProvider` IPC 验证模型列表;`pi:getModelInfo` 验证单个 model 的 capability 派生(reasoningLevels / tools / images / temperature)。
5. **想要"动态拉服务商 `/models` 端点"**(像历史 GHC 路径):参考 `providers/ghc/`(留作蓝本) —— 写一个 manager 单例做远程拉取 + 本地缓存 + 启动时刷新,然后在 `pi/model.ts` 加一层"如果 provider 命中本地缓存,从本地表投影成 `pi.Model`,否则走 pi-ai"的分支。**只在 pi-ai 收录不及时、服务商真有 `/models` 接口的情况下才值得做** —— 默认走 pi-ai 内置表是更省事的选择。

### 新增本地(deskmate-native)工具
1. 见 [`tools/ai.prompt.md`](./tools/ai.prompt.md)的 "Common Changes" 表 ——
   新建 `pi/tools/<name>.ts`(spec + handler),在 `pi/tools/index.ts` 加 register。
2. **不要**创建 "thin bridge" wrapper 形态。所有本地工具都 inline 在
   `pi/tools/<name>.ts`;重模块走 `pi/tools/impl/<name>.ts` + `lazy(...)`。
3. `pi/tool.ts::executeToolCall` 不需要改 —— catalog route 自动分发。

### 改压缩阈值
- `compression.ts` 内 `COMPRESSION_THRESHOLD = 0.85`

### 改 turn loop
- `session.ts` 是单一权威;务必维持 stop / overflow / error 分支语义;新增形态在 `BaseSession` 上扩子类,不要回到老的两条平行 turn loop

### 后台 utility 新增 LLM 调用
- 用 `utility.runUtilityCompletion({ modelKey, profileId, ... })`

### 新增 reasoning 相关字段 / 改 thinking level 行为
- `pi.streamSimple` / `pi.completeSimple` 接受 `reasoning: ThinkingLevel`（`minimal/low/medium/high/xhigh`），pi-ai 内部按 provider 翻译为 `reasoning_effort` / `thinkingEnabled+thinkingBudgetTokens` / `thinking.{level,budgetTokens}` / `enable_thinking` 等。**不要回退到 `pi.stream` + 手写 provider 分支** —— 重复 pi-ai 的桥接逻辑会立刻失同步。
- agent 持久化字段叫 `thinkingLevel`（AGENT.md front-matter + `AgentDetail` + `AgentConfig`），值是 pi-ai `ThinkingLevel` 联合（`@shared/types/thinkingLevel` 自定义同枚举，避免 renderer 引 pi-ai）。`undefined` 表示"不传 reasoning，让 provider 走默认"；UI 端的 "Auto" 用 `null` sentinel 走 `AgentFrontPatch` 三态写回 `undefined`。
- 渲染端唯一选择器：`renderer/components/chat/chat-input/ThinkingLevelSelector.tsx`。**不要**在前端做 "Claude→high / GPT→medium" 这种 provider heuristic，pi-ai 已知道每个 model 的 `thinkingLevelMap`。
- turn loop 在 `session.ts::runTurnLoop` 把 `agentCfg.thinkingLevel` 透传给 `streamOneRound({ thinkingLevel })`；子类 `RegularSession` / `JobRun` 都在 `pi.streamSimple({ reasoning: thinkingLevel })` 处把它接到出站请求。两条形态都接，保证交互聊天 vs schedule run 的 reasoning 强度一致（同一 agent 不会因运行形态不同回复风格漂移）。
- **切 model 自动清 thinkingLevel**：`Agent.patchFront({ model })` 在检测到 model 实际变化时把 `thinkingLevel` 清掉（同 patch 同时显式给 thinkingLevel 时以显式为准）。原因是 pi-ai `thinkingLevelMap` per-model：旧 level 在新 model 下要么不支持要么语义不等价（OpenAI `high` token budget ≠ Claude `high`），不清的话 pi-ai 会 `clampThinkingLevel` 静默兜底，UI 显示 "Auto" 而 runtime 实际发 clamp 后的等级——三条入口（renderer ModelSelector / agent editor BasicTab / `update_agent` builtin tool）全部走 `patchFront`，invariant 写一处即可覆盖。回归用例见 `persist/__tests__/agent.test.ts`。

## 注意事项

- **不要在 messageBridge 之外 `import '@earendil-works/pi-ai'`**。一旦泄漏,Domain Message 是事实源的设计就破了。例外:`session.ts` / `model.ts` / `tool.ts` / `auth.ts` / `utility.ts` 是 pi 适配器自身,必须 import。
- **`ContextState.compressions` 由 session 持久化,buildLlmContext 回放**。修改 compression schema 时务必同步两侧。
- **tool schema 用 `Type.Unsafe(jsonSchema)` 包装**,参数校验责任留给 MCP 服务端。
- **取消语义**:`stopStream` 只 abort,不 close stream。让 turn loop 自然走完 catch → setStatus(IDLE) → 推 status_changed → 再 close。在 stopStream 中提前 close 会让按钮卡在"取消"形态。
- **`getOrCreateSession` 走 lazy create**:persist 找不到该 sessionId 时不再硬抛,改为调 `persistAgent.createSession({ id: sessionId })` 用 renderer 持有的 id 首次落盘。renderer 端 "New Chat" 不再触发 IPC,仅 `newEntityId('s')` 本地生成 id 后 navigate;首次 `streamMessage` / `retryChat` / `editUserMessage` 走到这里才真正落盘 data.json + sessions/index.json,避免反复点新建却不发消息留下空壳 session。
- **`pi-ai` 用动态 import**:electron-vite 把 dependencies 默认 external,pi-ai 又是 ESM-only 包,静态 `import` 在生产 main bundle 里会触发 ESM/CJS interop 问题。`scripts/check-mixed-imports.js` 会拦"同模块静态+动态混用"(以及测试期间常见的 mock 漂移),所以 pi-ai 必须**全仓库统一用 dynamic import**(根包 + `@earendil-works/pi-ai/oauth` 子路径都一样)。
- **`OAuth provider` 从子路径 `@earendil-works/pi-ai/oauth` 引入**,根 index 只 re-export 了 *types*。
- **pi/auth 是唯一认证路径,profile 永远存在**。不要恢复"全局 auth manager 单例"模式 —— 多 provider 体系下应用启动不要求登录任何 provider,profile 总是存在,登录只是给 profile 贴身份。
- **`agentName` 字段保留但内部不再使用**:`CheckAndCompressArgs.agentName` 历史接口,新代码不应依赖。
- **tracer 形参一律 `parentTracer?: Tracer`**,不要降级回传 tid 字符串 —— 那样 `derive()` 在接收端拿不到 parent.sid,trace 树在 chat.ipc → chat.turn 之间断链。
- **model registry 唯一入口是 `pi/model.ts`**。renderer / IPC / utility / session / subAgent 一律走 `resolveModel` / `getModelInfo` / `listModels` / `resolveCredentials`(stream 调用前)/ `resolveApiKey`(只查 token、不打网络);listModels / getModelInfo / resolveModel 内部统一走 pi-ai 内置 model 表,**不允许**为某 provider 在三个入口里写 `if (provider === 'xxx')` 分支(包括 github-copilot)。
- **`resolveModel` 拿的是 catalog 原始 model**(`baseUrl` 是 pi-ai 写死的 fallback,GHC 全部硬编码 `api.individual.githubcopilot.com`)。**stream 路径必须再过 `resolveCredentials`** 让 OAuth provider 用 fresh access token 重派生 baseUrl,否则 GHC enterprise / business 账户立刻撞 421 Misdirected Request(Cloudflare/H2 层 token 与 host 不匹配)。`resolveApiKey` 只是 thin wrapper,**stream 路径不要用**。
- **GHC 数据源已废弃**:`providers/ghc/` 的 ghcModelsManager 仍在启动时拉一次 `/models` 并维护本地缓存,但 model registry 不再消费它的数据(github-copilot 直接走 pi-ai 内置 20 个 model)。意味着用户在 github-copilot 下看到的列表跟 pi-ai 内置一致(含 mini/flash/haiku)且 model 集合随 pi-ai 升级更新。若日后需要恢复"动态 `/models`"路径,见"新增 provider"第 5 条。

## 相关模块

- 依赖:
  - `persist`(Profile + Agent + Session 一等公民)
  - `lib/mcpRuntime`(external MCP server runtime,见 [ai.prompt.md](../lib/mcpRuntime/ai.prompt.md))
  - `pi/tools`(本地工具子系统,见 [ai.prompt.md](./tools/ai.prompt.md))
  - `lib/compression/fullModeCompressor`
  - `lib/token`
- 被依赖:
  - `startup/ipc/agent-chat`
  - `startup/ipc/pi`(auth + models 列表)
  - `startup/ipc/llm`(消费 `utils/{systemPromptLlmWritter, mcpConfigLlmFormatter, fileNameLlmGenerator}`)
