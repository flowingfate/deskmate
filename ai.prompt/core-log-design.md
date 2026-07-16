<!-- Last verified: 2026-07-16 (Step 9：delegated run 复用标准 Pi trace，旧 SubAgent trace 已删除) -->
# 核心链路日志设计 — 聊天 / Agent 回复 端到端 Trace

> 目标：在 **用户发消息 → 主进程编排 → LLM 流式响应 → 工具调用 → 前端渲染收尾** 这条主链路上，
> 用 `tid`（trace id）+ `sid`（span id）+ `psid`（parent span id）建立可重放的端到端时间线，
> 让 doctor / Log Viewer / CLI 拿到一个 `tid` 就能完整回放一轮对话。
>
> 设计原则：**精准而非密集**。每个 span 表达"一次有意义的工作"，
> 不在循环 / 流式 hot path 里逐条 log；每条 log 都能回答一个具体的故障问题。

---

## 1. 现状盘点

### 1.1 日志基础设施（已就绪，无需改动）

| 能力 | 来源 |
|------|------|
| 结构化字段 `mod / tid / sid / psid / dur / err` | `src/main/log/index.ts` + `src/main/log/sqlite-transport.cjs` |
| sqlite 索引 `idx_logs_trace ON (trace_id)` | `sqlite-transport.cjs` DDL |
| Renderer 桥 `log:write` / `log:writeBatch`（50ms 批 / warn+ 立即） | `src/renderer/log/index.ts` + `src/main/startup/ipc/log.ts` |
| Trace 查询入口 | `bun scripts/log.ts trace <tid>` / Log Viewer Traces 视图 / Doctor `trace_timeline` |
| `life_id` 隔离单次运行 | `sqlite-transport.cjs`（cross-trace 维度） |
| ULID 生成器 `ulid()`（仅持久化 entity id 用） | `src/shared/persist/id.ts:50`；trace 体系**不复用**，见 §2.1 |

**结论：基础设施完备，缺的是"主链路上谁来生成 tid、谁来传 tid、谁在关键节点 log"。**

### 1.2 核心链路上的现有 log（盘点结果）

| 节点 | 现有 log | 评价 |
|------|--------|------|
| Renderer `sendUserMessage`（`sendUserMessageOptimistically.ts`） | 进出 2 条 debug + 失败 1 条 error | ✅ 留 / 改造为带 tid |
| Renderer `session-manager.handleStreamingChunk` | 仅 `streamingMessageId` 切换 1 条 debug + unknown chunk warn | ⚠️ 已足够，**不要**改成逐 chunk log |
| IPC `agent-chat` handler（`streamMessage / retryChat / editUserMessage / cancel`） | **零** log | ❌ 主入口空白，必须补 |
| `pi.RegularSession.startStream / retryStream / editUserMessage` | **零** log | ❌ turn loop 入口空白 |
| `pi.BaseSession.runTurnLoop`（含压缩 / overflow 重试 / 取消） | **零** log | ❌ 压缩 / 重试 / 取消事件不可见 |
| `pi.RegularSession.streamOneRound`（pi.stream） | **零** log | ❌ LLM 调用本身不可见（成功/失败/耗时） |
| `pi.tool.executeToolCall` | **零** log | ❌ 工具执行不可见 |
| `pi.compression.checkAndCompress` | **零** log（仅 `contextCompressionLlmSummarizer` LLM 调用打 2 条） | ⚠️ 决策点缺，仅 LLM 调用有 |
| `pi.utility.runUtilityCompletion` | **零** log（utility 自己打） | 与主链路弱相关 |

### 1.3 整条链路图（带要新增的 span）

```
[Renderer]                       [Main IPC]              [pi.Session]                    [pi.Tool / pi.stream]
 user submits ─── tid=newTraceId() ─► streamMessage(tid) ─► startStream(tid) ─► runTurnLoop
   │  sid=chat.send                   sid=chat.ipc            sid=chat.turn iter=0..N
   │                                                         │
   │                                                         ├─► checkAndCompress  ── (sid=compress, 仅 applied 时记)
   │                                                         │      └─► utility LLM (compressionSummarizer)
   │                                                         │
   │                                                         ├─► streamOneRound  ───► pi.stream() (sid=llm.stream)
   │                                                         │      ├─ first token  (用 dur 衡量 TTFT)
   │                                                         │      └─ result/error
   │                                                         │
   │                                                         ├─► handleToolCalls
   │                                                         │      └─► executeToolCall × N (sid=tool.exec，并行：共享 psid)
   │                                                         │
   ◄────── streamingChunk × M (IPC，**不打 log**) ──────────┘
   handleStreamingChunk (renderer，仅 status_changed/complete 关键节点 log)
   │
   complete / error / cancelled ──► UI 关闭 stream（renderer 收尾 1 条 info）
```

---

## 2. Trace / Span 命名与传递

### 2.1 `tid`：一次"用户触发的请求"全程唯一

- **生成位置**：Renderer `sendUserMessage` / `retryChat` / `editUserMessage` 入口（用户动作起点）。
- **格式**：**6 字符 Crockford32**（如 `k7m2pq`），由 `crypto.getRandomValues` 取 6 字节、每字节低 5 bit 索引字母表。无前缀。
  - 唯一性范围：**单 `life_id` 内**。`life_id` 已经隔离单次 app 运行，不同 life 下 tid 重名无影响。
  - 6 字符 × 32 字母表 = 10.7 亿空间，单 life 内 ~38000 tid 才有 50% 碰撞概率;实际单 life 远不会到 500 turn,余量充足。
  - 不复用 `userMessage.id`(28 字符 entity id):消息 id 是持久化标识,trace id 是"本次执行"的标识;一条 user message 可被 `retryChat` 再触发(新 tid 同消息 id)。
  - **不**用时间戳作 id:① `Promise.all` 内并行 span 在同毫秒大量碰撞;② `performance.now()` 跨 V8 isolate(main/renderer)基准点不同,人眼会误以为是同一 span;③ 时间已在 `ts` 列且 trace_timeline 按 ts 排序,id 再带时间是冗余且语义混淆。
- **传递方式**：
  - **R→M**：renderer 入口 `Tracer.startWithSpan()` 起出顶层 chat.send tracer，调 IPC 时
    传 `tracer.serialize()`（→ `TraceContext = { tid, sid, psid?, startAt }`，详见 §3.1）。
    main 端 `Tracer.deserialize(ctx).derive().bind({ mod: 'chat.ipc' })` 把上游 sid 还原成
    parent，下游 `chat.turn / chat.llm / chat.tool` 的 `derive` 链自动接上 psid。缺省
    `trace` 参数时 main 端 `Tracer.start().derive()` 兜底新起，trace 树仍成立但 tid
    与 renderer 无关。
  - **M 内**：从 IPC handler 把 `tracer` 透传到 `runOrchestrator` → `session.startStream(..., tracer)` →
    `BaseSession.prepareSessionTracer(parent)`，`runTurnLoop` 内 `sessionTracer.derive()` 出 chat.turn。
    形参直接是 `Tracer` 实例，**不要**只传 tid —— 那是先前断链的根源（chat.turn 拿不到 parent.sid）。
  - **stream chunk 不带 trace 字段**：避免给每条 chunk 加字段；renderer 已在 `sendUserMessage`
    路径上把 tracer 暂存到 `traceContext` Map（按 chatSessionId 索引），status=idle 时取回拼 chat.recv。

### 2.2 `sid`:一次有边界的"操作"

`sid` 是 span 内部维度,每个 span 在创建时 `newSpanId()` 一次(**4 字符 Crockford32**)。**psid** 仅在嵌套时填上一层的 `sid`,让 trace 树可重建。

- 4 字符 × 32 = 105 万空间;单 life 内总 span 数(保守 500 turn × 20 span ≈ 10000)碰撞概率不到 5%。
- 即便偶发碰撞,重建 trace 树时复合 `(ts, psid)` 两个维度仍可分辨——单条 span 错位是可恢复故障,不是数据损坏。
- 同样**不**用 `ulid()`:26 字符过长,FTS5 + trace_id 列每条都占空间,人眼读 CLI 输出也累。

下表列出**所有要新增的 span**（命名稳定，对应 `mod` 即下表 component 字段）：

| 阶段 | mod | sid 来源 | psid | 何时记 | 说明 |
|------|-----|--------|------|--------|------|
| Renderer 入口 | `chat.send` | `newSpanId()` | — | sendUserMessage 起点(始) + 失败 | 起点 = INFO;失败 = WARN |
| IPC handler | `chat.ipc` | `newSpanId()` | 无(顶层) | 入口(始)+ 返回(终) | 始末同 sid,dur 表达 R→M 全程;用户取消、HTTP 错误归 WARN |
| Session turn | `chat.turn` | `newSpanId()` | `chat.ipc.sid` | turn 开始 + turn 结束(含 stopReason + iters) | 1 条入 + 1 条出(dur) |
| 压缩决策 | `chat.compress` | `newSpanId()` | `chat.turn.sid` | **仅当 applied=true** 记 1 条 INFO(含原/新 token 数 + dur) | 跳过时不 log(避免噪音) |
| LLM 流式 | `chat.llm` | `newSpanId()` | `chat.turn.sid` | 开始(始)+ first token(夹击:用 `ttft` 字段,**不**单独成 span) + 终(dur, in/out tokens, stopReason) | 失败 → ERROR + classifyError 结果 |
| 工具执行 | `chat.tool` | `newSpanId()`(每个 toolCall 一个) | `chat.turn.sid` | 始 + 终(含 toolName / isError / dur) | 并行执行:sibling span 共享 psid |
| Renderer 收尾 | `chat.recv` | 沿用 R 端 tid 链路 | `chat.send.sid` | 收到 `complete` 或 `status_changed=IDLE` 时 1 条 INFO(含 dur 从 send 起算) | 用户感知耗时 |

> **sub-agent / utility 链路 与主 trace 关系**：
> - `spawn_subagents` 在主 turn 中以工具调用形式出现，会先有 `chat.tool` span（psid=主 turn sid）；
>   sub-agent 内部 `SubAgentSession.runTurn` 用**同一 tid**，新开 `chat.subturn` span（psid=对应 `chat.tool` sid）。
> - 压缩用的 `contextCompressionLlmSummarizer` 已有自己的 INFO log；本设计把它升级为 **child span**：
>   `mod=chat.compress.summary`，psid=`chat.compress.sid`，复用 tid。
> - 其他 utility（chat title / file name 等）**与主链路无关**，保留现有 log，不挂 tid。

### 2.3 字段约定（强制）

| 字段 | 类型 | 何时必填 | 来源/说明 |
|------|------|----------|---------|
| `mod` | string | 永远 | 上表 component 名（如 `chat.turn`） |
| `msg` | string | 永远 | 短动作描述（10-40 字符），见 §4 命名示例 |
| `tid` | string | 主链路日志永远 | 从入口透传 |
| `sid` | string | span 起 + span 终 | span 自身 id |
| `psid` | string | 非顶层 span | 上一层 sid |
| `dur` | number(ms) | span 终 | `performance.now()` 或 `Date.now()` 差值 |
| `err` | Error / string | error 路径 | 由 `normalize` 抽 message/stack |
| `chatSessionId` | string | 主链路日志永远 | 业务字段，落 `fields` JSON |
| `agentId` | string | 主链路日志永远 | 业务字段 |
| `profileId` | string | 主链路日志永远 | 业务字段 |
| `iter` | number | turn loop 内 | 0-based |
| `toolName` | string | tool span | |
| `stopReason` | string | llm/turn span 终 | pi.stopReason 原值 |
| `ttft` | number(ms) | `chat.llm` 终（仅成功） | first token 时延 |
| `inputTokens` / `outputTokens` | number | `chat.llm` 终 | `pi.usage` |
| `originalTokens` / `compressedTokens` | number | `chat.compress` 终 | |
| `isError` | boolean | `chat.tool` 终 | 工具是否 throw |
| `errClass` | string | error 路径 | `classifyError()` 结果 (`overflow / network / rate / auth / unknown`) |

---

## 3. 实施清单（按文件）

### 3.1 `src/shared/log/trace.ts` —— Tracer + 跨进程信封

导出（**稳定 API**，调用方按"trace id / span id / 序列化"语义使用）：

| 导出 | 说明 |
|------|------|
| `newTraceId()` / `newSpanId()` | Crockford32 字母表（去 i/l/o/u，与 ULID 同源），各取 6/4 字节随机数低 5 bit 索引；唯一性范围 life_id，长度依据见 §2.1 / §2.2 |
| `class Tracer` | 实例化要走 `Tracer.start() / startWithSpan() / from(tid,sid?) / deserialize(ctx)` 四个工厂；`derive(sid?)` 起子 span（自动浅拷贝 bindings 防串扰），`bind(fields)` 累积业务字段，`fields(extra, withDur?)` 输出给 `log.info` |
| `interface TraceContext` | 跨进程信封：`{ tid, sid, psid?, startAt }`。renderer `tracer.serialize()` → main `Tracer.deserialize(ctx)`，让接收端 `derive` 出的子 span 自动以 ctx.sid 作为 psid，trace 树跨进程接得上 |
| `Tracer.noop` | "调用方没有主链路 tracer，但仍要写完整业务 log"的兜底；fields 省 trace 字段，业务字段全保留 |

设计要点（**修改时必读**）：
- `Tracer` 是日志体系的内部抽象，与持久化 `ulid()` (`src/shared/persist/id.ts`) 严格分离。
- `derive()` 总是浅拷贝 bindings 给子 → 父子 bindings 互不污染。
- `TraceContext` 只送够"重建 parent.sid 链路"的最小信息，**不**带 bindings / mod：业务
  字段由接收端在新 span 上 `bind` 即可。把 mod 顺便带过去会让 chat.send 的 mod 漏进
  接收端的 chat.ipc log 行。
- `serialize()` 调用前 tracer 必须持有 sid（`Tracer.startWithSpan()` 或链上某层 `derive()`
  之后），否则 trace 链少一节，接收端 derive 出的子 span 没法挂 psid。

### 3.2 Shared IPC 契约（`src/shared/ipc/agentChat.ts`）

`streamMessage / retryChat / editUserMessage / cancelChatSession` 的 `call` 元组**末尾**
加可选 `trace?: TraceContext`（来源：`@shared/log/trace`）：
- 向后兼容：tail-optional 参数；老 renderer 调用不带也能工作。
- 协变：`renderer/lib/chat/agentIpc.ts` 薄包装方法形参签名 `trace?: TraceContext`
  透传给 `agentChatApi`；`src/main/startup/ipc/agent-chat.ts` handler 接收后
  `Tracer.deserialize(trace)` 重建上游 sid 链。

### 3.3 Renderer 侧

| 文件 | 变更 |
|------|------|
| `src/renderer/lib/chat/sendUserMessageOptimistically.ts` | 入口 `Tracer.startWithSpan().bind({mod:'chat.send', chatSessionId, agentId, msgId})` → 起 1 条 `chat.send enqueue` INFO → 把 `tracer.serialize()` 传给 `agentIpc.streamMessage`；catch 路径 1 条 WARN `enqueue failed`；同时 `traceContext.start(chatSessionId, tracer)` 把 tracer 暂存供 chat.recv 接力 |
| `src/renderer/lib/chat/agentIpc.ts` | `streamMessage / editUserMessage / cancelChatSession` 末尾形参 `trace?: TraceContext` 透传给 `agentChatApi` |
| `src/renderer/lib/chat/session-manager.ts` | **不**在 `handleStreamingChunk` 内逐 chunk log。`handleStatusChangedChunk` 收到 `status_changed=idle` 时 `traceContext.consume(chatSessionId)` 取走 chat.send tracer，`derive().bind({mod:'chat.recv'})` 起新 span 写 1 条 INFO；`fields(..., 'root')` 把 dur 算到 chat.send.startAt（用户感知耗时） |
| `src/renderer/components/chat/chat-input/ComposeInput.tsx` | `onCancelChat` 用 `traceContext.peek` 拿 in-flight tracer，`tracer.serialize()` 传给 `cancelChatSession`，让 cancel 事件挂同 trace |
| 新增 `src/renderer/lib/chat/traceContext.ts`（轻量） | 维护 `Map<chatSessionId, Tracer>`，sendUserMessage 入口 `start`，handleStatusChangedChunk / catch 路径 `consume`；不写入 ChatSessionCache（避免污染数据结构 / 落 jsonl） |

> Renderer **不增加**任何 hot-path 日志（chunk 处理 / 滚动 / 输入框等都不动）。

### 3.4 Main 进程侧（**核心改动区**）

| 文件 | 变更 |
|------|------|
| `src/main/startup/ipc/agent-chat.ts` | `streamMessage / retryChat / editUserMessage / cancelChatSession` handler 内：① `(msgTrace ? Tracer.deserialize(msgTrace) : Tracer.start()).derive().bind({mod:'chat.ipc', chatSessionId, agentId, profileId})` 起 chat.ipc tracer ② INFO `stream start` / `cancel start` ③ try/finally 出口 INFO 带 dur='self'；catch WARN ④ `runOrchestrator` 把整个 `tracer` 透传给 `session.startStream / retryStream / editUserMessage`（**形参直接是 Tracer 实例，不再是 tid 字符串**） |
| `src/main/pi/session/base.ts` `BaseSession` 抽象 | ① `sessionTracer: Tracer = Tracer.noop`，入口（`startStream / retryStream / editUserMessage / JobRun.run`）调 `prepareSessionTracer(parent?: Tracer)`：parent 提供时 sessionTracer = parent（即 chat.ipc tracer），否则 `Tracer.start().bind({chatSessionId, agentId, profileId})` 兜底 ② `runTurnLoop` 起点 `turnTracer = sessionTracer.derive().bind({mod:'chat.turn'})`，psid 自动 = chat.ipc.sid ③ INFO start / finally INFO done（含 iters / stopReason / dur）/ cancelled / failed ④ overflow 重试路径单独 WARN `overflow retry` ⑤ doCompress 起 `chat.compress` 子 span，applied=true 时记 1 条 INFO（带 originalTokens / compressedTokens / dur） |
| `src/main/pi/session/regular.ts` `RegularSession.streamOneRound` | `streamOneRoundArgs.parent: Tracer` → `tracer = parent.derive().bind({mod:'chat.llm'})`：① 起 INFO（modelId, toolsCount） ② first delta 同步算 `ttft = tracer.dur` ③ 终 INFO（ttft, inputTokens, outputTokens, stopReason）/ WARN（pi 内部 error event）/ ERROR（throw）；用 `__chatLlmLogged` sentinel 避免双写 |
| `src/main/pi/session/job.ts` `JobRun.streamOneRound` | 同 RegularSession（job 场景同样要 trace） |
| `src/main/pi/tool.ts` `executeToolCall` | `ToolContext.tracer: Tracer` → `(ctx.tracer ?? Tracer.noop).derive().bind({mod:'chat.tool', toolName, callId, ...})` 起 chat.tool span;并行 sibling 共享 psid（chat.turn.sid）;ToolContext.tracer 一路传给 handler,sub-agent / 嵌套 LLM 复用同一棵 trace 树 |
| `src/main/pi/utils/llm-services/contextCompressionLlmSummarizer.ts` | `summarize({tracer?})` 接收主链路 tracer，每个 attempt 起子 span `chat.compress.summary`，psid = chat.compress.sid；缺省 `Tracer.noop` 仍写完整业务 log |
| `src/main/pi/subagent/session.ts` | delegated run 复用标准 `chat.turn` / `chat.llm` / `chat.tool` span；manager 不另造不连续的 trace 树 |

### 3.5 持久化（**不需要**）

> tid / sid 仅用于运行时分析与故障排查，**不**进 messages.jsonl 或 data.json。
> 任何一次 retry / edit 会重新生成 tid；旧 tid 通过日志库自然保留 200k 行内可查。

---

## 4. 日志条目命名速查（msg 字段）

> 命名规则：`<动词> <名词>`，全小写，可缩写到 1-3 词。避免 emoji / 装饰。

| span 起 | span 终（成功） | span 终（失败/特殊） |
|---------|-----------------|----------------------|
| `chat.send` `enqueue` | — | `enqueue failed` |
| `chat.ipc` `stream start` / `cancel start` | `stream done` / `cancel done` | `stream failed`, `cancel failed` |
| `chat.turn` `turn start` | `turn done` | `turn failed`, `turn cancelled` |
| `chat.compress` (无起) | `compress applied` | — |
| `chat.compress.summary` `llm start` | `llm ok` | `llm failed` |
| `chat.llm` `stream start` | `stream ok` | `stream failed`, `overflow` |
| `chat.tool` `tool start` | `tool ok` | `tool failed` |
| `chat.subturn` `subturn start` | `subturn done` | `subturn failed` |
| `chat.recv` (无起) | `render complete` | `render error` |

---

## 5. 噪音控制（必须遵守）

- **NEVER** 在 `pi.stream` events 循环里 log。`text_delta / toolcall_delta` 每秒上百条，会把 sqlite 撑爆。
- **NEVER** 在 `handleStreamingChunk` 的 chunk 处理 switch 里 log（同上）。
- **NEVER** 给每条 `streamingChunk` IPC 调用 log。
- **NEVER** 在 `messageBridge.toPiContext / fromPi*` 里 log（纯函数翻译层）。
- **NEVER** 在 utility（chat title / file name / mcp config）里追加 tid —— 与主链路无关，独立分析。
- 压缩跳过路径**不** log（绝大多数 turn 都不压缩，跳过路径会喧宾夺主）；只 log "applied=true" 的决策。
- compression / tool / llm 三个 span 的"始 + 终"已经能合成时间线，**不**再加中间 progress 日志。
- error 路径全部 `err: error` 走 `normalize` 抽 message/stack；**禁止** `msg: \`failed: ${e.message}\`` 这种格式（重复存储 + 失去 stack）。
- level 选择：
  - **INFO**：正常 span 起/终（trace 重建必须）；
  - **WARN**：业务可恢复（overflow 触发 force-compress、用户 cancel、HTTP 4xx）；
  - **ERROR**：失败外抛（pi.stream throw、tool throw 且未被吞、compression 整链失败）；
  - **DEBUG**：仅 dev 关心的细节（如压缩跳过原因），主链路上**几乎不出现**。
- 单条 fields JSON 控制在 ~1KB 内：工具 args 用 `argsBytes` 长度统计而非原文；error stack 已由 sqlite 专列存。

---

## 6. 验证手段

实施后必须能跑通三个验证：

1. **CLI trace**:发送一条聊天 → `bun scripts/log.ts trace <tid>`(tid 是 6 字符,无前缀;实际取值看 `chat.send` 行 fields) 应返回 6-12 行(chat.send → chat.ipc → chat.turn → chat.llm → chat.tool × N → chat.turn done → chat.ipc done → chat.recv),按 ts 升序排列。
2. **Doctor agent**：`trace_timeline(traceId=...)` 输出可读时间线，psid 链能拼回 chat.turn → chat.tool 树。
3. **Log Viewer Traces 视图**：能看到这个 tid 跨 main/renderer 两个通道的 SVG 时间线，dur 字段渲染为条带宽度。

性能验证：
- 普通 chat 流（10 chunk + 1 工具）总新增 log 行数 ≤ **8 行**；
- 压缩触发的 turn：+2 行（compress + summary）；
- 取消的 turn：+1 行（cancelled）；
- 失败的 turn：+1 行（failed，带 errClass）。

---

## 7. 实施顺序（推荐）

1. **骨架（最小可验证）**
   1.1 新建 `src/shared/log/trace.ts`;
   1.2 改 IPC 契约 + renderer agentIpc + main runOrchestrator 透传 tid；
   1.3 在 `chat.ipc` + `chat.turn` + `chat.llm` 三个核心 span 落 log；
   ✅ 跑一条普通 chat → CLI `trace` 能看到 6 行。

2. **工具 / 压缩**
   2.1 `chat.tool` span（含并行 sibling psid 共享）；
   2.2 `chat.compress` + `chat.compress.summary` child span；
   ✅ 触发工具 + 触发压缩，trace 树完整。

3. **error 路径覆盖**
   3.1 cancel / overflow / pi.stream error / tool throw 四条；
   ✅ 手动制造 overflow（贴大文本），timeline 看到 `chat.turn overflow_retry` + `chat.compress applied(force)`。

4. **sub-agent**
   4.1 `chat.subturn` + 工具→子 turn 的 psid 链；
   ✅ spawn_subagents 工具触发的二级 trace 树。

5. **renderer 收尾**
   5.1 `chat.send`（起点） + `chat.recv`（终点）；
   ✅ 用户感知耗时 = `chat.recv.dur`（从 `chat.send` 算起，可在 viewer 直接看 trace 总跨度）。

每一步独立可发布，后一步依赖前一步的 tid 透传链。

---

## 8. 协变映射（实施时同步更新）

| 修改 | 同步检查 |
|------|----------|
| 新建 `src/shared/log/trace.ts` | renderer / main 各引入;在 `src/shared/log/ai.prompt.md` 「关键文件」表加一行 `trace.ts \| newTraceId / newSpanId (6/4 字符 Crockford32, 唯一性范围 life_id)`,并注明"不复用 `src/shared/persist/id.ts` 的 `ulid()`(那是持久化 entity id 专用)" |
| IPC 契约 `agentChat.ts` 加 `traceId` 形参 | `src/renderer/lib/chat/agentIpc.ts` 透传；`src/main/startup/ipc/agent-chat.ts` 接收；`src/shared/ipc/ai.prompt.md` 标注 R→M 契约扩展 |
| `pi/session/base.ts` 新增 `currentTid` | `src/main/pi/ai.prompt.md` 标注"主链路 tid 在 session 内透传，不入 persist" |
| `ToolExecutionScope` 新增 `traceId / parentSpanId` | `src/main/pi/tool.ts` 类型 + `RegularSession.handleToolCalls` / `JobRun.handleToolCalls` 注入 |
| 新增 mod 命名 `chat.send / chat.ipc / chat.turn / chat.compress / chat.llm / chat.tool / chat.subturn / chat.recv` | `ai.prompt/log-analysis.md`「常见场景 § 聊天 / Agent 错误」段补常用命令示例 `--component "chat.*"` |
| 文档 | 本文件实施完结后翻修 `ai.prompt/log-analysis.md` 增加"按 tid 追一次聊天"小节 |
