# Agent Loop（pi chat 引擎）

<!-- Last verified: 2026-07-17 (Step 13：唯一 delegated run 路径与历史 prompt/trace 残留已清理) -->

## 1. 范围

本文档覆盖 DESKMATE chat orchestrator 的运行时 —— 从用户发消息到模型回复落盘的完整 turn loop,以及围绕它的 model resolve / auth / tool / 压缩 / 错误兜底链路。

代码位置:`src/main/pi/`。chat / auth / models 的**唯一生产路径**,基于 `@earendil-works/pi-ai` 适配多 provider。

模块级深度文档(class 关系、常见变更、注意事项):[src/main/pi/ai.prompt.md](../src/main/pi/ai.prompt.md)。

---

## 2. 设计约束

| 约束 | 说明 |
|---|---|
| **Domain Message 是事实源** | `src/shared/persist/types/message.ts` 定义主进程内存 canonical 形态（IPC 契约也直接消费），并由 `types/index.ts` 统一导出。`pi.Message` 仅作 LLM 协议适配,不为它给 Domain 加字段。`shared/types/chatTypes.ts` 在 Phase 5 后只剩 LlmApi / 文件常量,**不再承载 Message shape**。 |
| **bridge 单点** | Domain Message ↔ pi.Message 翻译唯一发生在 `pi/utils/messageBridge.ts`(入境 `fromPiAssistantMessage`、出境 `toPiContext` 1→N 展开 ToolCall.response)。renderer / IPC / persist / skill / prompt 都不感知 pi。 |
| **持久化形态独立** | `messages.jsonl` 行类型是 `PersistedJsonLine = PersistedUserMessage \| PersistedAssistantMessage \| PersistedToolResponse`(`shared/persist/types/message.ts`),与 Domain Message 通过 `main/persist/messageWire.ts` 的 `rehydrate` / `dehydrate` 互转。Persisted 只是空字段省略后的 Domain。 |
| **pi-ai 只在 pi/ 内 import** | 例外清单:`session/{base,regular,job}.ts` / `model.ts` / `tool.ts` / `auth.ts` / `utils/utilityCompletion.ts`。其它任何模块 `import '@earendil-works/pi-ai'` 一律违规。 |
| **profile 永远存在,登录是给 profile 贴身份** | 不要求用户登录任何 provider 才能启动;profile bootstrap 永远成功,认证态由 `pi/auth.ts` 一处管理。 |
| **依赖规则** | `agent → session → prompt / tool / mcp / compression → utils/internal`。无环、无双向回调、按需注入纯函数 hook。 |
| **tracer 入口注入,不入 persist** | `BaseSession.sessionTracer` 是 `Tracer` 实例,IPC 入口透传,内部 `derive` 出 chat.turn / chat.llm / chat.tool / chat.compress span。`messages.jsonl` / `data.json` 不写 tid/sid。 |

---

## 3. 类骨架

```
pi.Agent                                src/main/pi/agent.ts
  ├─ static Map<agentId, Agent>         进程内缓存
  ├─ sessions: Map<sessionId,           Lazy create:首次 streamMessage 才落盘
  │             RegularSession>           sessions/{ym}/{s}/data.json
  └─ getOrCreateSession(sessionId)
        ├─ 命中 cache 直接返
        └─ Profiles.active().getAgent().getSession(sid)
             ?? createSession({ id: sid })
             → new RegularSession(注入 persistSession)

BaseSession (abstract)                  src/main/pi/session/base.ts
  ├─ messages: Message[]                来自 messages.jsonl
  ├─ contextState: ContextState         来自 data.json,含 compressions[] 压缩栈
  ├─ lastUsage: PiUsage | null          上一轮模型 usage,作下一轮压缩决策
  ├─ sessionTracer: Tracer              入口注入,runTurnLoop 内 derive chat.turn
  ├─ persistSession: PersistSessionLike 持久化最小依赖面(可换内存实现)
  │
  ├─ runTurnLoop()                      ← 核心 turn loop,详见 §4
  ├─ prepareRunEnvironment()            ← 默认 regular/job config；delegated session 覆盖执行 Agent/prompt/catalog/maxTurns
  ├─ abstract streamOneRound()          ← 子类决定推不推流 / 推到哪
  ├─ abstract handleToolCalls()         ← 子类决定发不发 tool_result chunk
  └─ abstract failTurn / onTurnComplete / onTurnCancelled / onTurnFinally / onCompressionApplied

  ├── RegularSession extends BaseSession
  │     ├─ activeStream: Stream<StreamingChunk>           UI 推流通道
  │     ├─ activeEventSender: Electron.WebContents        builtin tool 反查窗口
  │     └─ startStream / retryStream / editUserMessage
  │
  ├── JobRun extends BaseSession
  │     ├─ run(userMessage)                               scheduler 唯一入口
  │     └─ streamOneRound drain 所有 delta 静默
  │
  └── SubAgentSession extends BaseSession                 pi/subagent/session.ts
        ├─ 仅运行一个 pending Subrun；scope 内执行 delegate config/catalog
        ├─ submit_result / missing-submit → formal terminal result
        └─ 以 `{ onStep?, onResult? }` 向未来 manager 输出有限进度
```

**`PersistSessionLike`**(`session/base.ts`)是 pi 拥有的最小契约,不是 persist 暴露的细节:`config.{title,updatedAt,contextState,turn}` + `loadDomainMessages / appendDomainMessage / appendToolResponse / rewriteMessages / flushMessages / persist`。`appendDomainMessage` 写 user / assistant 行,`appendToolResponse` 单独追加 `tool_res` 行(对应 `PersistedToolResponse`),`rewriteMessages` 用于 edit / retry 整段重写。默认实现是 `@main/persist` 的 `Session` 类(落盘);eval / 测试可以注入内存实现,pi 不感知差异。

---

## 4. Turn Loop

`BaseSession.runTurnLoop()` —— 一次 user message 触发的完整循环，RegularSession / JobRun / SubAgentSession 复用。封装在 `try/finally` 内，任何路径（配置失败、SDK throw、cancel、子类钩子抛错）都过 `onTurnFinally`。

```
runTurnLoop()                                                 session/base.ts
  │
  ├─ 起 turnTracer = sessionTracer.derive().bind({ mod: 'chat.turn' })
  │
  ├─ 一次性准备
  │   prepareRunEnvironment()                            ← 默认读取 config/model/prompt/catalog/30 turns
  │                                                        ← delegated session 覆盖执行 Agent、私有 submit catalog、request maxTurns
  │
  ├─ for iter in 0..environment.maxTurns:
  │     │
  │     ├─ doCompress() ─────────────────────────────────────────────────┐
  │     │   checkAndCompress(...)                                        │
  │     │     ├─ lastUsage.input ?? roughEstimate(...)                   │
  │     │     ├─ < contextWindow * 0.85 → applied=false                  │
  │     │     ├─ else → onWillCompress() 推 COMPRESSING_CONTEXT          │
  │     │     │        compressWithFullMode → buildCompressionSnapshot   │
  │     │     │        nextContextState.compressions.push(snapshot)      │
  │     │     └─ 失败 → 保留旧 state,applied=false(不影响 turn)        │
  │     │   if applied: onCompressionApplied() 推 COMPRESSED_CONTEXT     │
  │     └                                                                │
  │                                                                       │
  │     ├─ resolveCredentials(baseModel, profileId)    ← 留在循环内,每轮拿 fresh
  │     │     ↳ { apiKey, model }  apiKey + 按当前 OAuth credentials 派生过
  │     │                          baseUrl/headers 的 model(GHC 必须走这条,
  │     │                          token 里 proxy-ep 字段决定真实 endpoint)
  │     ├─ piContext = toPiContext(llmContext, systemPrompt, piTools)
  │     │
  │     ├─ streamOneRound(...) ─────────────────── catch overflow ──────┐
  │     │   pi.stream(model, piContext, { signal, apiKey, toolChoice })  │
  │     │   for await evt: text_delta / toolcall_delta / toolcall_end…   │
  │     │     (RegularSession 推 chunk;JobRun drain)                     │
  │     │   final = await events.result()                                │
  │     │     ├─ stopReason='error' → throw(让 overflow / failTurn 接住)│
  │     │     └─ return final                                            │
  │     │                                                                │
  │     │   .catch(err => {                                              │
  │     │     if classifyError(err) !== 'overflow' → re-throw            │
  │     │     forced = await doCompress(true)  // force 跳阈值           │
  │     │     if !forced.applied → throw 原始 err                        │
  │     │     重新 toPiContext + streamOneRound 一次                     │
  │     │   })                                                           │
  │     └──────────────────────────────────────────────────────────────┘
  │     │
  │     ├─ if stopReason === 'aborted': push partial → break
  │     ├─ assistantMsg = fromPiAssistantMessage(final, catalog)  ← MCP 限定名 demux 回 name+mcp
  │     │   appendAssistantMessage(assistantMsg)             ← 写 PersistedAssistantMessage
  │     ├─ lastUsage = final.usage    (供下一轮压缩决策 + ContextBadge)
  │     │
  │     ├─ if stopReason !== 'toolUse' → break
  │     ├─ toolCalls = final.content 中的 toolCall(**限定名**,非 demux 副本 → 保证 executeToolCall 查表命中)
  │     ├─ if signal.aborted → throw CancellationError
  │     └─ handleToolCalls(toolCalls, signal, turnTracer)
  │           Promise.all([ executeToolCall(...) ])      ← 并行
  │
  │     BaseSession 不读取 submit_result、不能在 tool batch 后提前 break，也不注入 follow-up user message。
  │     SubAgentSession 在本次完整 loop 返回后才检查 controller，必要时 append user reminder 并再启动一个完整 loop。
  │
  ├─ try 正常 break: onTurnComplete({ iterations, stopReason })
  ├─ catch CancellationError: onTurnCancelled()
  ├─ catch other:        failTurn(err)
  └─ finally: onTurnFinally() + log 'turn done|cancelled|failed'
```

**关键设计点**:

1. **doCompress 嵌入 for 循环**:每 iter 都有机会触发,尤其当上一轮 `usage.input` 已经超阈;不依赖 turn 入口预压缩。
2. **overflow 单点重试**:仅 `streamOneRound` 这层 catch,且只触发一次 force compress;不嵌套循环避免 oscillation。其它 error(network / auth / rate)走外层 `failTurn`。
3. **stopReason 三态**:`stop` → break;`toolUse` → 调 toolCalls 进入下一 iter;`aborted` → break(partial 已落 `outcome: { kind: 'aborted', partial }`)。
4. **stopStream 只 abort**:不 close stream。turn loop 自然走到 `stopReason='aborted'` → `onTurnCancelled` → `setStatus(IDLE)` 推 status_changed → 自行 close stream。在 stopStream 中提前 close 会让 status chunk 发不出,UI 按钮卡在"取消"形态。
5. **toolCall 并行 + 顺序回填**:`Promise.all` 同时发起所有 toolCall,全部回来后按下标顺序逐条 `appendToolResponse` + 推 tool_result chunk;assistant/tool 配对的回放顺序稳定。
6. **iter cap = 30**:`MAX_TURN_ITERATIONS`(session/base.ts),模型刷工具死循环 / 模型生成空 toolCall 时兜底。

## 4.5 Resume(崩溃后续跑)

`SessionDataFile.turn: { status: 'idle' | 'running'; startedAt? }` 是 resume 触发的 1-bit flag。turn 入口(`startStream` / `retryStream` / `editUserMessage` / `JobRun.run`)在开 turn 时把 `turn.status='running'` 持久化;`onTurnComplete` / `onTurnCancelled` / `failTurn` 任意终态都把它扣回 `'idle'`。中途 crash → 盘上停在 `'running'`。

下次进程启动 `BaseSession.restore()` 完毕时:

```
if persistSession.config.turn?.status === 'running':
    pendingResume = planResume(messages)        // pi/utils/resume.ts 纯函数
else:
    pendingResume = { kind: 'markIdle' }
```

`planResume` 看 messages 尾部:

| 尾部消息 | outcome / tool_calls | ResumeAction |
|---|---|---|
| 空 / user | — | `startTurn` |
| assistant + stop + 无 tool_calls | — | `markIdle` |
| assistant + stop + 有 call 缺 response | — | `runMissingTools(toolCallIds)` |
| assistant + stop + 所有 call 都有 response | — | `continueLoop` |
| assistant + aborted/error/maxIter | — | `markTerminal(outcome)` |

`pendingResume` 缓存在 `BaseSession.pendingResume`,通过 `ChatSessionCacheInitialData.pendingResume` 透传给 renderer 显示"正在续跑..." banner。下一个 entry(`startStream` 等)在常规工作前调一次 `consumePendingResume` 消化它。

**当前实现**:Phase 5 落地的 `consumePendingResume` 是最小版本 —— `markIdle` 直接放过;`markTerminal` 把 outcome 落到内存并标 turn=idle;`runMissingTools` / `continueLoop` / `startTurn` 一律先标 `aborted(partial=true)` + idle,等用户下一次主动 entry 触发新 turn,而不是后台自动续跑 tool。"真正裸跑 tool 补结果"作为单独议题(算法整体迁 Domain 之后再做),目前足够保证"crash 后 session 不卡死"。

测试:`pi/__tests__/resume.test.ts`(planResume 5 分支纯函数)+ `pi/__tests__/resume-flow.test.ts`(BaseSession.restore 集成,7 个分支覆盖 turn.status × 尾部状态)。

---

## 5. 上下文压缩

`pi/compression.ts:checkAndCompress(args)` 是唯一压缩入口。每个 iter 进入循环时调一次。

**决策输入**:`messages` / `contextState.compressions[]` / `lastUsage` / `contextWindow`(默认 128k)/ `force` / `compressionThreshold`(默认 `DEFAULT_COMPRESSION_THRESHOLD = 0.85`;sub-agent 可注入更激进值如 0.60)。

```
estimatedTokens = lastUsage?.input ?? roughEstimate(...)
if !force && estimatedTokens < contextWindow * threshold:
    return { applied: false, llmContext: buildLlmContext(messages, contextState) }

onWillCompress?.()                                     // 推 COMPRESSING_CONTEXT
result = await compressWithFullMode(contextHistory, sharedCompressor, profileId, tracer)
  → FullModeCompressor → contextCompressionLlmSummarizer.runUtilityCompletion(...)
if !result.success: return { applied: false }         // 失败保留旧 state

snapshot = buildCompressionSnapshot(messages, result.compressedMessages)
  // earlyPreservedCount = 早期保留消息数
  // summary = AssistantMessage(LLM 摘要 + thinking)
  // compressedBeforeIndex = 这条之前的消息可丢
nextContextState = { ...contextState, compressions: [...prev, snapshot] }
return { applied: true, nextContextState, llmContext: buildLlmContext(messages, nextContextState) }
```

**buildLlmContext** 折叠算法(`pi/utils/buildLlmContext.ts`):

```
if no compressions: return [...messages]
topSnapshot = compressions[last]
return [
  ...messages.slice(0, earlyPreservedCount),   // 保留早期(系统初始化 / 首条 user)
  summary,                                      // 中间一团 → 一条 AssistantMessage 摘要
  ...messages.slice(compressedBeforeIndex),    // 保留尾部(最近上下文)
]
```

压缩栈每 push 一层只折叠一次;多次压缩后 `messages[]` 没变,但 `llmContext` 越来越短。回放算法 O(1),不需要遍历整栈。

**overflow 兜底**(session/base.ts:runTurnLoop):pi.stream 抛错 → `classifyError === 'overflow'`(模式见 `utils/errors.ts:OVERFLOW_PATTERNS`,跨 anthropic / google / openai-compat)→ `doCompress(true)` 强制再压一次 → forced.applied 为 false 时(已经压无可压)抛原始错误 → 否则用 forced.llmContext 重新 streamOneRound 一次。

---

## 6. Tool 执行

`pi/tool.ts` 三件事:列工具、翻译为 pi.Tool、执行 + interactive 弹窗。

**列工具 + per-turn catalog**:`buildToolCatalogForAgent(agentCfg)`(`pi/tool.ts` 的 catalog 段)合并 agent 顶层 `tools?: string[]`(本地工具白名单,空 / 不设 = 全开)与 `agentCfg.mcpServers[]`(外部 MCP 显式启用集)产出 `ToolCatalog` class。`specs`(公开只读)直接喂 `pi.streamSimple({ tools })`;私有 routes 对 local 直接持有已选 `LocalTool`，对 MCP 持有 server/tool name，经 `getRoute(name)` 精确路由。完整 LLM 限定名冲突在 build 时即抛 —— **不做静默优先级、不做 namespace**。

**执行单个 tool call**(`executeToolCall(call, catalog, ctx)`,`tool.ts` 执行段):

```
tracer = ctx.tracer.derive({ mod: 'chat.tool', toolName, callId, ... })

route = catalog.getRoute(name)          // 必存在,否则 LLM 出错叫了不在 list 里的 tool

try:
  rawContent = route.kind === 'local'
               ? await executeLocalTool(route.tool, args, ctx)  // handler 显式拿 ctx 参数
               : await executeMcpToolOnServer(route.serverName, route.toolName, args, ctx.signal)
  content = rawContent   // ask 的 human-loop 卡片派发已内聚到 ask 工具 handler 内部
  return { toolCallId, toolName, content, isError: false }
catch e:
  return { toolCallId, toolName, content: e.message, isError: true }   // 不抛
```

**关键不变量**:

- **handler 显式拿 ctx**：`ToolContext` 用 `mode:'agent' | 'delegate'` 区分执行角色；`agentId/sessionId` 固定 parent session，delegate 分支必填 `delegateId`。其它字段仍显式注入，禁止回读全局执行上下文。
- **错误不抛,以字符串回填**:assistant/tool 配对必须完整,否则下一轮 LLM 看到孤儿 toolCall 会报 schema 错。
- **递归保护**：delegate context 下 catalog 结构性移除真实 `subagent` LocalTool；不存在第二个委派入口。
- **`eventSender=null` 模式**:JobRun(scheduler 静默)走这条;`ask` / 选择 / 表单 类工具自动返回 cancel 默认应答 = "用户拒绝",turn 自然收敛。
- **`chunkStream=null` 模式**:JobRun / 测试路径无可推流端,工具内 `if (!ctx.chunkStream) return` 早返,跳过 partial-result 推流。

**推流契约**(仅 RegularSession,详见 `session/regular.ts::streamOneRound`):`toolcall_delta` → `tool_call` chunk(argument 增量);`toolcall_end` → 再发一次完整 JSON(应对 unicode 切断);`handleToolCalls` 完成 → `tool_result` chunk;turn 末尾 → `complete` chunk;`setStatus` → `status_changed` chunk。

---

## 7. Auth

`pi/auth.ts` —— 每个 profile 一份 `PiAuthFile`(`auth.pi.json`)与 `PiAuthManager` 单例。

```
auth.pi.json 磁盘 schema(shared/persist/types/auth.ts)
{
  version: 'pi-v1',
  providers: {
    'github-copilot': { type: 'oauth',  credentials: { access, refresh, expires } },
    'anthropic':      { type: 'apiKey', apiKey: 'sk-...' },
  }
}

PiAuthManager(profileId)                              auth.ts:48
  ├─ cached: PiAuthFile | null                       进程内缓存
  ├─ inflightRefresh: Map<provider, Promise<string>> 并发 refresh 去重
  │
  ├─ getApiKey(provider) ──────────── 热路径,每次 LLM 调用前都跑
  │     ├─ apiKey 类:直接回原值
  │     ├─ oauth + expires > now + REFRESH_SKEW_MS → 回 access
  │     └─ 否则 refreshProvider(provider)
  │           ├─ inflight 命中 → 复用同一 promise
  │           ├─ pi.oauth.refreshToken(credentials)
  │           └─ writeProvider → 写盘 + 更新 cached
  │
  ├─ startLogin(provider, callbacks)   device-code / 浏览器 OAuth
  ├─ setApiKey / logout / listProviders
  └─ 全局 singleton registry: Map<profileId, PiAuthManager>
```

**关键不变量**:

- 每个 `profileId` 一份独立实例,绑定 `{userData}/profiles/{p_ulid}/auth.pi.json`。
- `REFRESH_SKEW_MS = 60_000`(auth.ts:28):expires 在这个安全垫内视为有效,否则提前 refresh。
- `refresh` 不由后台 monitor 主动跑,只在 `getApiKey` 命中 expired 时按需触发 —— 避免后台 monitor 与请求路径竞写 `auth.json`。
- 老 `MainAuthManager` 已下线;`shared/persist/types/index.ts#LegacyAuthFile` 仅供 `persist/auth.ts#LegacyAuth.load` 兼容读取磁盘残留(只读)。
- OAuth provider 实现从 `@earendil-works/pi-ai/oauth` 子路径 import(根 index 只 re-export 类型)。

---

## 8. Model 解析

```
parseAgentModel('github-copilot::claude-sonnet-4.6')   shared/utils/agentModelId.ts
  → { provider: 'github-copilot', modelId: 'claude-sonnet-4.6' }

resolveModel(parsed) → Model<Api>                       model.ts:90
  → pi.getModel(provider, modelId)
  → 找不到:throw 'Unknown model "<id>" under provider "<provider>"'
  ★ 不分 provider 分支,catalog 是 pi-ai 编译时常量 `models.generated.ts`
    (~960 model 跨 32 provider,含 github-copilot 全部 20 个)
  ★ 这里的 model.baseUrl 是 catalog 硬编码(GHC 写死 individual 端点),
    **不能直接拿去打 LLM** —— 必须再过 resolveCredentials 让 OAuth provider
    用当前 access token 重派生(详见下)

resolveCredentials(baseModel, profileId) → { apiKey, model }   model.ts:138
  ├─ auth.getOAuthCredentials(provider):
  │     ├─ 有效 → 整个 credentials 对象(含 .access + provider 自定义字段)
  │     └─ 过期 → 触发 refresh + 回写 + 取新 credentials
  ├─ if credentials:
  │     impl = await import('pi-ai/oauth').getOAuthProvider(provider)
  │     model = impl.modifyModels?.([baseModel], credentials)[0] ?? baseModel
  │     return { apiKey: credentials.access, model }
  └─ else (apiKey-only / 未登录):
        apiKey = auth.getApiKey(provider) ?? throw 'No credentials'
        return { apiKey, model: baseModel }

resolveApiKey(model, profileId) → string                 model.ts:178
  → resolveCredentials(...).apiKey   ← thin wrapper,**不要用于实际 stream**
    (用它会让 GHC enterprise 账户撞 421 Misdirected;只剩测试 / 不打网络的
    工具脚本场景)
```

**为什么 `model.baseUrl` 必须按 token 动态派生**:GHC OAuth access token 形如
`tid=xx;exp=xx;proxy-ep=proxy.enterprise.githubcopilot.com;sku=...`,`proxy-ep`
字段编码了 user 账户对应的真实后端(individual / business / enterprise / 自有
企业域)。pi-ai 提供 `provider.modifyModels(models, credentials)` hook 让调用方
在每次 LLM 调用前用 access token 改写 baseUrl;catalog 里写死的 `baseUrl:
api.individual.githubcopilot.com` 仅作 fallback。**不调 modifyModels 直接拿
catalog model 打 enterprise 账户 token,Cloudflare 会在 TLS/H2 层立刻返回
`421 Misdirected Request`**(token 不属于该 host)。

**注意**:

- agent.model 必须是复合 key `${provider}::${modelId}`。读到不含 `::` 的值 UI 提示 "Model misconfigured, please select a model",由用户重选(裸 modelId 是历史格式,新代码一律拒绝)。
- pi-ai 是 **ESM-only 包**,electron-vite v6 把 dependencies 标记为 external 并产出 `require()`,所以**必须** `await import('@earendil-works/pi-ai')` 动态 import。ESM module registry 自带缓存,同一 specifier 只 evaluate 一次。
- 历史路径(`ghcModelsManager.getModelById` + `ghcToPiModel`)已经下线,改由 pi-ai 内置 catalog + `modifyModels` hook 承担;曾经的 `providers/ghc/` 目录(`GHC_CONFIG` OAuth 常量 + `ghcModelsManager` 启动拉 `/models` 缓存)已整体移除,github-copilot 直接走 pi-ai 内置表。

---

## 9. System Prompt 拼装

`pi/prompt.ts:buildSystemPrompt({ agentCfg, profileId, agentId, sessionId })` —— turn loop 准备阶段调一次,每轮重算(skill snapshot 不持久化)。

```
identityBlock      role + emoji + name + agent.system_prompt
knowledgeBlock     `knowledge://` URI 描述(KB 路径已固定为 `${agentRoot}/knowledge`)
fsSkillsBlock      扫 knowledge/.claude/skills/ 子目录,每个一行 metadata
boundSkillsBlock   profile.skills 注册表中按 agent.skills[] 过滤
getGlobalSystemPrompt   ~/.deskmate/.claude/global.md(全 agent 共享)
```

`expandPlaceholders` 把 `{deskmate.cwd}` / `{deskmate.platform}` 等动态值实时代入。

---

## 10. 入口与外部流

**IPC 入口**(`startup/ipc/agent-chat.ts`)。`renderToMain` 契约见 `src/shared/ipc/agentChat.ts`。3 个 chat 入口共用 `runOrchestrator()`:

```
streamMessage    → session.startStream(userMsg, stream, sender, tracer)
retryChat        → session.retryStream(stream, sender, tracer)         // 从最后一条 user 截断重发
editUserMessage  → session.editUserMessage(msgId, newMsg, ...)         // 从该 msg 之前截断,改后重发
cancelChatSession → session.stopStream()                                // 只 abort
```

`runOrchestrator()`:取 active profileId → `Tracer.deserialize(msgTrace).derive().bind({mod:'chat.ipc'})` → `Agent.getOrCreate(profileId, agentId).getOrCreateSession(chatSessionId)`(首次 lazy create persist 行)→ new `Stream<StreamingChunk>` → `responseStream(sender, stream)` 后台 drain 把 chunk `mainToRender('streamingChunk', ...)` → 调 `fn(session, stream, sender, tracer)`。返回 `{success: true, data: []}` —— 实际消息走流式 chunk,不在 IPC 返回值里。

**持久化**:user / assistant 消息走 `appendDomainMessage`(buffer)→ `flushMessages`(append 一行 `PersistedUserMessage` / `PersistedAssistantMessage` 到 `messages.jsonl`);tool 结果单独走 `appendToolResponse`(写一行 `PersistedToolResponse`,`role: 'tool_res'`,`id` 与上条 assistant 的某 `tool_calls[i].id` 对齐)。Turn 结束 / 压缩成功后走 `persist(title, updatedAt)`:`data.json` 更新 `title / updatedAt / contextState / turn.status`(turn.status='running' 是 resume 触发条件,见 §4.5)。`messages.jsonl` 是 append-only;edit / retry 用 `rewriteMessages` 整段覆盖写。详见 [persist.md §3](persist.md)。

**渲染管线**:renderer 端 `AgentIpc.onStreamingChunk` → `AgentSessionCacheManager` 直接回调(绕开 React);详见 [data-flow.md "流式渲染管线"](data-flow.md)。

---

## 11. Tracer 链

主链路 trace 在内存中以 span 树形式存在,日志侧通过 `tid / sid / psid` 字段拼回。**不入 persist**。

```
renderer 发起 → TraceContext(tid/sid)
   ↓ deserialize + derive + bind(mod: 'chat.ipc')
chat.ipc                                                       agent-chat.ts:58
   ↓ session.prepareSessionTracer(parent) → sessionTracer
   ↓ runTurnLoop 内 sessionTracer.derive().bind(mod: 'chat.turn')
chat.turn                                                       session/base.ts
   ├─ derive(mod: 'chat.compress')
   │   └─ FullModeCompressor → contextCompressionLlmSummarizer  → chat.compress.summary
   ├─ derive(mod: 'chat.llm')                                    session/{regular,job}.ts
   │   └─ pi.stream(...)
   └─ derive(mod: 'chat.tool', toolName, callId)                tool.ts
       └─ 拷进 ToolContext.tracer,handler 直接消费
           └─ `subagent run` 以该 tracer 派生单次 delegated session 的 trace
```

形参一律 `parentTracer?: Tracer`。**不要**降级回传 tid 字符串 —— `derive()` 在接收端拿不到 `parent.sid`,trace 树在 chat.ipc → chat.turn 之间断链。eval / scheduler 等无外部上游入口:`prepareSessionTracer(undefined)` → 本地 `Tracer.start()` 起新 trace,chat.turn 为顶层 span。

详见 [core-log-design.md](core-log-design.md)。

---

## 12. 错误分类(`pi/utils/errors.ts`)

`classifyError(err) → 'overflow' | 'auth' | 'rateLimit' | 'network' | 'other'`,基于错误文本的模糊匹配(pi 没有结构化错误码字段)。每个 kind 的 pattern 列表见 `utils/errors.ts`,覆盖 anthropic / openai / google 实际错误文本。

| Kind | 处理 |
|---|---|
| `overflow` | turn loop 内 force-compress + 重试一次 |
| `auth` / `rateLimit` / `network` / `other` | 一期只识别,当 fail 抛到 UI;`rateLimit` 由 pi SDK 自身 maxRetries 兜底 |

扩 provider 时按需追加 pattern;每条 pattern 后面注释里写明它对应哪个 provider 的真实错误文本。

---

## 13. 非流式 utility(`pi/utils/utilityCompletion.ts`)

后台 LLM 调用(chat title / file name / doc summary / mcp config / compression summary / system prompt 润色 / eval judge / doctor)共用:

```
runUtilityCompletion({ modelKey, profileId, systemPrompt, userPrompt }) → string
  → parseAgentModel(modelKey) → resolveModel + resolveApiKey
  → pi.complete(model, { systemPrompt, messages: [{role:'user', content: userPrompt}] }, { apiKey })

runUtilityChat({ modelKey, profileId, messages: UtilityChatMessage[] }) → string
  → splitSystemAndChat:抽出第一个 system,其余转 pi.Message[]
  → pi.complete(model, { systemPrompt, messages: piMessages }, { apiKey })
```

**不带 tool**;turn 内固定调一次,无循环。消费方:`lib/compression/fullModeCompressor`(主链路压缩)、`startup/ipc/llm.ts`(renderer utility IPC)、`lib/doctor/llmClient.ts`、`lib/evalHarness/evalJudgeRunner.ts`。

---

## 14. ChatStatus 状态机

`shared/types/agentChatTypes.ts:ChatStatus`。RegularSession 在关键点用 `setStatus(...)` 推 `status_changed` chunk;JobRun 不推 status(无 UI)。

```
IDLE
  ↓ startStream / retryStream / editUserMessage
SENDING_RESPONSE              (streamOneRound 入口)
  ↓ 收到 first token(text_delta / toolcall_delta / thinking_delta)
RECEIVED_RESPONSE
  ↓ 决定需要压缩
COMPRESSING_CONTEXT
  ↓ 压缩 applied
COMPRESSED_CONTEXT
  ↓ 下一轮继续 SENDING_RESPONSE → RECEIVED_RESPONSE → ...
  ↓ stopReason !== 'toolUse'
onTurnComplete → IDLE
```

---

## 15. Agent 委派

生产路径为 `subagent` LocalTool → `SubAgentManager.forProfile(profile)` → parent-scoped persisted `Subrun` → `SubAgentSession`。每个 Profile 绑定唯一 manager；它授权 delegate、持久 reservation/parallel gate、timeout/cancel、stale-running recovery 与有界 runtime state。SubAgentSession 只运行一个 pending Subrun 并写正式结果。父 RegularSession stop 时先取得所属 Profile 的 manager，再按完整 parent identity 取消 active delegated runs；不存在第二套委派 backend。

---

## 16. 入门快查

| 想干啥 | 看哪 |
|---|---|
| 改 turn loop | `session/base.ts` 是单一权威;新形态在 `BaseSession` 上扩子类,不要回到两条平行 loop |
| 改压缩阈值 | `compression.ts:DEFAULT_COMPRESSION_THRESHOLD`(0.85);sub-agent 等可注入更激进值 |
| 改 iter 上限 | `session/base.ts:MAX_TURN_ITERATIONS`(30) |
| 改 OAuth refresh skew | `auth.ts:REFRESH_SKEW_MS`(60_000) |
| 加 provider | `model.ts:resolveModel` 分支 → `model.ts:resolveApiKey` 分支 → `renderer/components/settings/auth/providerRegistry.ts` UI 入口 |
| 加本地工具 | `pi/tools/<name>.ts` 新建 spec + handler;`pi/tools/index.ts` 加 register;详见 [`pi/tools/ai.prompt.md`](../src/main/pi/tools/ai.prompt.md) Common Changes 表 |
| 加后台 utility | 用 `utility.runUtilityCompletion({ modelKey, profileId, ... })` |
| 加 chunk 类型 | `shared/types/streamingTypes.ts` 加 type → `session/{regular,job}.ts:streamOneRound` / `handleToolCalls` 发 → renderer chunk 处理 |
| 加错误模式 | `utils/errors.ts:<KIND>_PATTERNS` 数组追加 regex,注释里写哪个 provider |

---

## 17. Related

- 模块深度文档:[`src/main/pi/ai.prompt.md`](../src/main/pi/ai.prompt.md)
- IPC 契约:[`src/shared/ipc/agentChat.ts`](../src/shared/ipc/agentChat.ts)、[`src/shared/ipc/pi.ts`](../src/shared/ipc/pi.ts)
- 流式渲染管线:[data-flow.md "流式渲染管线"](data-flow.md)
- 持久化:[persist.md](persist.md)、[`src/main/persist/ai.prompt.md`](../src/main/persist/ai.prompt.md)
- 日志 / 主链路 trace:[core-log-design.md](core-log-design.md)、[log-analysis.md](log-analysis.md)
- MCP 运行时:[`src/main/lib/mcpRuntime/ai.prompt.md`](../src/main/lib/mcpRuntime/ai.prompt.md)
