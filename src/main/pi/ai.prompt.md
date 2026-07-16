<!-- Last verified: 2026-07-16 (Step 6：Subrun persist store 已为未来 delegated session 就绪) -->
# pi 模块 — Chat 引擎（pi-ai 底座）

> Deskmate 的 chat orchestrator，基于 `@earendil-works/pi-ai` 适配多 provider。
> chat / auth / models 的唯一生产路径。完整 turn loop 架构图见
> [`ai.prompt/agent-loop.md`](../../../ai.prompt/agent-loop.md)。

## 关键文件

| 文件 | 职责 | 规模 |
|------|------|------|
| `index.ts` | **pi 子树唯一外部入口**。`src/main/pi/` 之外只能从 `@main/pi` 导入；使用显式 named export，只暴露仓库中真实存在的外部消费面。子树内部仍按依赖方向直接引用具体模块，避免 barrel 自引用；工具注册仍由 `ensureToolsRegistered()` 动态触发，根入口不得静态导入 `tools/index.ts` | 小 |
| `agent.ts` | Agent 注册表 + getOrCreateSession | 小 |
| `prompt.ts` | system prompt 拼装(identity + knowledge + skills + sub-agents + global) | 小 |
| `session/` | turn loop 单一权威。RegularSession/JobRun 保持既有无 scope 行为；未来 delegated session 在最外层建立 delegate context | 中 |
| `tool.ts` | **catalog + 执行**两段同住一文件。delegate context 存在时仅过滤交互式 `ask` LocalTool；Step 9 加入真实 `subagent` 对象禁止嵌套。其它工具与 MCP OAuth 保持普通能力；`web research` 与已知 shell device-auth 在各自执行边界拒绝 | 中 |
| `tools/` | **本地工具子系统** —— `LocalTool` registry + `ToolContext` + `lazy(spec, loader)` + 所有具体工具文件。delegate capability 在 scope 存在时于执行点收紧 | 见子目录 |
| `subagent/` | **建设中**的 Agent 委派运行时边界。已有 shared run contract、parent-scoped subrun persist store、未注册 cmdline facade 与 delegate-only capability boundary；manager/session 仍未接线，旧 `lib/subAgent` 仍是生产路径 | 中 |
| `auth.ts` | PiAuthManager:OAuth + apiKey 存取 + expires-based refresh + inflight dedup | 中 |
| `compression.ts` | 压缩决策(usage = pi.usage.totalTokens,含 output,与 badge 同口径)+ 内置 compressWithFullMode 调用 | 小 |
| `mcp.ts` | external MCP 工具薄包装:`listAllMcpTools()`(给 catalog 列举外部工具)/ `executeMcpToolOnServer(serverName, toolName, args, signal)`(server-scoped 执行,**不再**有按裸 toolName 查全局 map 的路径) | 小 |
| `utils/messageBridge.ts` | Domain `Message`(`@shared/persist/types`)↔ `pi.Message` **唯一翻译点**:入境 `fromPiAssistantMessage(final, catalog)`(把 ThinkingPart / TextPart / ToolCallPart 折成单串 `think` + `content` + `tool_calls[]`；MCP 的 LLM 限定名经 `catalog.resolveIdentity` 精确 demux 回自然 `name` + `mcp` server，与出境 `toLlmToolName` 对称)，出境以 `ToolCall.mcp` 重新组装 MCP LLM 名称，1→N 展开每个 `assistant.tool_calls[i].response` 为 `pi.toolResult` 行；内部把首个 user message 的持久化 `time` 投影为固定 reminder，`transientReminder` 仅附本次请求尾部，二者均不落盘 | 中 |
| `utils/fileAnnotation.ts` | 附件文本渲染 | 小 |
| `utils/localTime.ts` | 客户端本地 ISO 时间、IANA timezone 与 UTC offset 的共享格式化；`app time` 和会话时间锚点复用 | 小 |
| `utils/config.ts` | agent 配置读取(`readAgentConfig` + `readAgentRuntimeConfig`,返回 `{agent, parsedModel}` 元组;capability 派生不在这里,见 `model.ts`) | 小 |
| `utils/errors.ts` | classifyError + overflow / network / rate / auth 分类 | 小 |
| `utils/resume.ts` | `planResume(messages)` 纯函数:看 messages 尾部算 `ResumeAction`;`BaseSession.restore` 在 `turn=running` 时调,子类入口消费 | 小 |
| `utils/utilityCompletion.ts` | 非 streaming 后台调用 `runUtilityCompletion` / `runUtilityChat`(doctor / eval / 后台 LLM utility 共用入口) | 小 |
| `utils/buildLlmContext.ts` | 压缩快照回放 → 完整 LLM 上下文 | 小 |
| `utils/globalSystemPrompt.ts` | 稳定的全局 system prompt；首条 user message 的固定发送时间是默认锚点，只有需要晚于该锚点的时间才调用 `app("time")` | 中 |
| `utils/systemReminderUtils.ts` | system reminder 注入 | 小 |
| `utils/promptTemplates.ts` | prompt.ts 用到的拼接模板(identity / knowledge / skills / sub-agents) | 中 |
| `utils/llm-services/systemPromptLlmWriter.ts` | LLM 润色 system prompt(IPC `improveSystemPrompt`) | 中 |
| `utils/llm-services/mcpConfigLlmFormatter.ts` | LLM 解析 MCP server 配置(IPC `formatMcpConfig`) | 中 |
| `utils/llm-services/fileNameLlmGenerator.ts` | LLM 生成下载文件名(IPC `generateFileName`) | 小 |
| `utils/llm-services/contextCompressionLlmSummarizer.ts` | 压缩摘要 LLM 调用(主链路压缩) | 中 |
| `utils/llm-services/` | IPC 触发的独立 one-shot LLM 服务(上 4 个)统一归档于此,与 turn loop 内部 helper(messageBridge / buildLlmContext / localTime / ...)分居 | — |

## 架构

**数据流**:renderer → `ipc/agent-chat` → `pi.Agent` → `pi.Session` → `pi.streamSimple()` → `messageBridge` → IPC chunk → renderer

**依赖规则**:

```
agent → session → prompt / tool / mcp / compression → utils/internal
```

无环、无双向回调、按需注入纯函数 hook。

**公共边界**:`src/main/pi/` 外部禁止深层导入 `@main/pi/*` 或相对路径 `../pi/*`，统一从 `@main/pi` 取值/类型。`index.ts` 不做 `export *`，新增导出前必须先有真实外部调用方；外部调用删除后同步移除对应导出。pi 子树内部不经过根 barrel，继续按上图直接依赖具体文件。

**Domain Message 是事实源**:`src/shared/persist/types/message.ts` 定义主进程内存 canonical 形态（也是 IPC 契约的入参/出参），并由 `src/shared/persist/types/index.ts` 统一导出。`pi.Message` 仅作 LLM 协议适配。`shared/types/chatTypes.ts` 在 Phase 5 后只剩 LlmApi / 文件常量,不再承载 Message shape。

**bridge 单点**:`utils/messageBridge.ts` 是 Domain Message ↔ pi.Message 唯一翻译点。其他任何模块(renderer / IPC / persist / skill / prompt)都不感知 pi。

**流式用量契约**:`RegularSession.streamOneRound()` 在本次 provider 返回 `final` 后，将 `final.usage` 映射为 Domain `TokenUsage` 并随 `complete` chunk 发送。此 payload 与稍后 `fromPiAssistantMessage()` 落盘到 assistant message 的 `usage` 同口径；renderer 可在当前流式消息完成时立刻累计，无需重拉 snapshot。

**时间与缓存**:`messageBridge` 内部读取当前 LLM context 的首个 user message 的持久化 `time`，将它投影为固定 reminder；调用者不感知时间锚点。该文本不写回 Domain / persist，当前 context 不变时字节稳定；实时当前时间才按需调用 `app time`。

**Resume**:`BaseSession.restore()` 在 `SessionDataFile.turn?.status === 'running'` 时调 `resume.ts:planResume` 算出 `pendingResume` 缓存到自身。下次 entry(`startStream` 等)在常规工作前消化它,把所有非平凡分支(runMissingTools / continueLoop / startTurn)统一收敛为 `aborted + idle`(终态设计,不再扩展自动续跑)。异常状态由 `loadChatSessionSnapshot` 在 `turn=running` 时填 `errorMessage` 透到 UI,渲染端 ErrorBar + Retry 让用户手动重试。详见 [`agent-loop.md` §4.5](../../../ai.prompt/agent-loop.md#45-resume崩溃后续跑)。

**Auth 隔离**:每个 `profileId` 一个 `PiAuthManager`,绑定 `{userData}/profiles/{profileId}/auth.pi.json`(磁盘文件名 `auth.pi.json`,目录名 `p_{ulid}`)。同 provider 并发 refresh 用 inflightRefresh Map 去重。

**主链路 tracer**:`BaseSession.sessionTracer: Tracer`(不是裸 tid)。IPC handler 在 `agent-chat.ts` 用 `Tracer.deserialize(msgTrace).derive().bind({mod:'chat.ipc',...})` 起 chat.ipc tracer,整个 tracer 透传给 `session.startStream / retryStream / editUserMessage / JobRun.run`。`BaseSession.prepareSessionTracer(parent?: Tracer)` 把 chat.ipc tracer 挂到 sessionTracer;`runTurnLoop` 起 chat.turn = `sessionTracer.derive()`;`streamOneRound` 起 chat.llm span;`executeToolCall` 起 chat.tool span(`ToolExecutionScope.tracer?: Tracer`);`checkAndCompress({tracer})` 让 chat.compress / chat.compress.summary 共链。tid / sid 仅运行时使用,**不入 persist**。

## 常见变更

### 新增 provider
1. **provider 必须在 pi-ai 内置 model 表里**(`@earendil-works/pi-ai/dist/models.generated.ts` 的 `MODELS[provider]`)。pi-ai 不识别的 provider,`listModels(provider)` 会返空数组、`resolveModel` 会抛"Unknown model"。pi-ai 版本升级时新模型会自动出现;服务商真发了 pi-ai 还没收录的新模型,等 npm 升级。
2. **登录路径**:在 `pi/auth.ts` 把 provider 加进相应的 OAuth / apiKey 白名单。`resolveCredentials` 不需要动 —— 它按 `model.provider` 查 `PiAuthManager.getOAuthCredentials` / `getApiKey`,OAuth 路径会自动套用 pi-ai `provider.modifyModels` hook(若有)派生 baseUrl。
3. 在 `renderer/components/settings/auth/providerRegistry.ts` 加 UI 入口。
4. 跑 `pi:listModelsForProvider` IPC 验证模型列表;`pi:getModelInfo` 验证单个 model 的 capability 派生(reasoningLevels / tools / images / temperature)。
5. **想要"动态拉服务商 `/models` 端点"**:写一个 manager 单例做远程拉取 + 本地缓存 + 启动时刷新,然后在 `pi/model.ts` 加一层"如果 provider 命中本地缓存,从本地表投影成 `pi.Model`,否则走 pi-ai"的分支。**只在 pi-ai 收录不及时、服务商真有 `/models` 接口的情况下才值得做** —— 默认走 pi-ai 内置表是更省事的选择。历史上 `providers/ghc/` 曾是这条路径的蓝本(远程拉 `/models` + 缓存 `models/github-copilot.json`),已随 github-copilot 收敛到 pi-ai 内置表而整体移除,需要时从 git 历史取回参考。

### 新增本地(deskmate-native)工具
1. 见 [`tools/ai.prompt.md`](./tools/ai.prompt.md)的 "Common Changes" 表 ——
   新建 `pi/tools/<name>.ts`(spec + handler),在 `pi/tools/index.ts` 加 register。
2. **不要**创建 "thin bridge" wrapper 形态。所有本地工具都 inline 在
   `pi/tools/<name>.ts`;重模块走 `pi/tools/impl/<name>.ts` + `lazy(...)`。
3. `pi/tool.ts::executeToolCall` 不需要改 —— catalog route 自动分发。

### 改压缩阈值
- `compression.ts` 内 `COMPRESSION_THRESHOLD = 0.85`

### 改 turn loop
- `session/base.ts` 是单一权威(turn loop 全在 `BaseSession`);务必维持 stop / overflow / error 分支语义;新增形态在 `BaseSession` 上扩子类(`session/regular.ts` / `session/job.ts`),不要回到老的两条平行 turn loop

### 后台 utility 新增 LLM 调用
- 用 `utilityCompletion.runUtilityCompletion({ modelKey, profileId, ... })`(`utils/utilityCompletion.ts`)

### 新增 reasoning 相关字段 / 改 thinking level 行为
- `pi.streamSimple` / `pi.completeSimple` 接受 `reasoning: ThinkingLevel`（`minimal/low/medium/high/xhigh`），pi-ai 内部按 provider 翻译为 `reasoning_effort` / `thinkingEnabled+thinkingBudgetTokens` / `thinking.{level,budgetTokens}` / `enable_thinking` 等。**不要回退到 `pi.stream` + 手写 provider 分支** —— 重复 pi-ai 的桥接逻辑会立刻失同步。
- agent 持久化字段叫 `thinkingLevel`（AGENT.md front-matter + `AgentDetail` + `AgentConfig`），值是 `@shared/persist/types` 的 `ThinkingLevel` 联合（避免 renderer 引 pi-ai）。`undefined` 表示"不传 reasoning，让 provider 走默认"；UI 端的 "Auto" 用 `null` sentinel 走 `AgentFrontPatch` 三态写回 `undefined`。
- 渲染端唯一选择器：`renderer/components/chat/chat-input/ThinkingLevelSelector.tsx`。**不要**在前端做 "Claude→high / GPT→medium" 这种 provider heuristic，pi-ai 已知道每个 model 的 `thinkingLevelMap`。
- turn loop 在 `session/base.ts::runTurnLoop` 把 `agentCfg.thinkingLevel` 透传给 `streamOneRound({ thinkingLevel })`；子类 `RegularSession` / `JobRun` 都在 `pi.streamSimple({ reasoning: thinkingLevel })` 处把它接到出站请求。两条形态都接，保证交互聊天 vs schedule run 的 reasoning 强度一致（同一 agent 不会因运行形态不同回复风格漂移）。
- **切 model 自动清 thinkingLevel**：`Agent.patchFront({ model })` 在检测到 model 实际变化时把 `thinkingLevel` 清掉（同 patch 同时显式给 thinkingLevel 时以显式为准）。原因是 pi-ai `thinkingLevelMap` per-model：旧 level 在新 model 下要么不支持要么语义不等价（OpenAI `high` token budget ≠ Claude `high`），不清的话 pi-ai 会 `clampThinkingLevel` 静默兜底，UI 显示 "Auto" 而 runtime 实际发 clamp 后的等级——三条入口（renderer ModelSelector / agent editor BasicTab / `update_agent` builtin tool）全部走 `patchFront`，invariant 写一处即可覆盖。回归用例见 `persist/__tests__/agent.test.ts`。

## 注意事项

- **不要在 messageBridge 之外 `import '@earendil-works/pi-ai'`**。一旦泄漏,Domain Message 是事实源的设计就破了。例外:`session/{base,regular,job}.ts` / `model.ts` / `tool.ts` / `auth.ts` / `utils/utilityCompletion.ts` 是 pi 适配器自身,必须 import。
- **`ContextState.compressions` 由 session 持久化,buildLlmContext 回放**。修改 compression schema 时务必同步两侧。
- **tool schema 用 `Type.Unsafe(jsonSchema)` 包装**,参数校验责任留给 MCP 服务端。
- **取消语义**:`stopStream` 只 abort,不 close stream。让 turn loop 自然走完 catch → setStatus(IDLE) → 推 status_changed → 再 close。在 stopStream 中提前 close 会让按钮卡在"取消"形态。
- **`getOrCreateSession` 走 lazy create**：persist 找不到该 sessionId 时调 `persistAgent.createSession({ id: sessionId })` 用 renderer 持有的 id 首次落盘。若该 id 已存在于 `job_runs`，必须拒绝而不能同 ID 创建 regular session；用户只能先通过 persist 的 schedule-run conversion 取得新 regular id。renderer 端 “New Chat” 不再触发 IPC，仅 `newEntityId('s')` 本地生成 id 后 navigate；首次 `streamMessage` / `retryChat` / `editUserMessage` 才落盘 data.json + sessions 索引，避免反复点新建却不发消息留下空壳 session。
- **`pi-ai` 用动态 import**:electron-vite 把 dependencies 默认 external,pi-ai 又是 ESM-only 包,静态 `import` 在生产 main bundle 里会触发 ESM/CJS interop 问题。`scripts/check-mixed-imports.js` 会拦"同模块静态+动态混用"(以及测试期间常见的 mock 漂移),所以 pi-ai 必须**全仓库统一用 dynamic import**(根包 + `@earendil-works/pi-ai/oauth` 子路径都一样)。
- **`OAuth provider` 从子路径 `@earendil-works/pi-ai/oauth` 引入**,根 index 只 re-export 了 *types*。
- **pi/auth 是唯一认证路径,profile 永远存在**。不要恢复"全局 auth manager 单例"模式 —— 多 provider 体系下应用启动不要求登录任何 provider,profile 总是存在,登录只是给 profile 贴身份。
- **`agentName` 字段保留但内部不再使用**:`CheckAndCompressArgs.agentName` 历史接口,新代码不应依赖。
- **tracer 形参一律 `parentTracer?: Tracer`**,不要降级回传 tid 字符串 —— 那样 `derive()` 在接收端拿不到 parent.sid,trace 树在 chat.ipc → chat.turn 之间断链。
- **model registry 唯一入口是 `pi/model.ts`**。renderer / IPC / utility / session / subAgent 一律走 `resolveModel` / `getModelInfo` / `listModels` / `resolveCredentials`(stream 调用前)/ `resolveApiKey`(只查 token、不打网络);listModels / getModelInfo / resolveModel 内部统一走 pi-ai 内置 model 表,**不允许**为某 provider 在三个入口里写 `if (provider === 'xxx')` 分支(包括 github-copilot)。
- **`resolveModel` 拿的是 catalog 原始 model**(`baseUrl` 是 pi-ai 写死的 fallback,GHC 全部硬编码 `api.individual.githubcopilot.com`)。**stream 路径必须再过 `resolveCredentials`** 让 OAuth provider 用 fresh access token 重派生 baseUrl,否则 GHC enterprise / business 账户立刻撞 421 Misdirected Request(Cloudflare/H2 层 token 与 host 不匹配)。`resolveApiKey` 只是 thin wrapper,**stream 路径不要用**。
- **GHC 独立数据源已移除**:曾经的 `providers/ghc/ghcModelsManager`(启动拉 `/models` + 本地缓存)已整体删除,github-copilot 直接走 pi-ai 内置 model 表。用户在 github-copilot 下看到的列表与 pi-ai 内置一致(含 mini/flash/haiku)且随 pi-ai 升级更新。若日后需要恢复"动态 `/models`"路径,见"新增 provider"第 5 条。

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
  - `startup/ipc/llm`(消费 `utils/llm-services/{systemPromptLlmWriter, mcpConfigLlmFormatter, fileNameLlmGenerator}`)
