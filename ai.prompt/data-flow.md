# 数据流

<!-- Last verified: 2026-07-19 (sender-bound multi-window Profile routing; 集中 preload invoke 模块) -->

参考：`src/shared/ipc/base.ts`、`src/main/pi/`、`src/main/persist/`、`src/main/lib/mcpRuntime/`

---

## IPC 架构

所有 IPC 通道均已采用类型安全框架。框架核心在 `src/shared/ipc/base.ts`，通过两个工厂函数 + TypeScript 泛型 + Proxy，从单一共享类型定义自动对齐 main / preload / renderer 三层类型。

详见 [IPC Framework details](../src/shared/ipc/ai.prompt.md)

### 核心机制

| 工厂函数 | 方向 | 模式 | 用途 |
|----------|------|------|------|
| `connectRenderToMain<RM>(prefix)` | Renderer → Main | invoke / handle | R→M 请求-响应 |
| `connectMainToRender<MR>(prefix)` | Main → Renderer | send / on | M→R 事件推送 |

**R→M（Renderer → Main）**：
- 共享契约定义每个方法的 `call`（参数元组）和 `return`（返回类型）
- Main 侧 `renderToMain.bindMain(ipcMain)` 返回 Proxy，属性访问即注册 `ipcMain.handle('{prefix}:{method}', fn)`
- Preload 侧 `renderToMain.provideInvokeForPreload(ipcRenderer, whitelist[])` 创建通道过滤的 invoke 函数，白名单缺项会触发编译错误
- Renderer 侧 `renderToMain.bindRender(invokeFn)` 返回类型化 API 对象

**M→R（Main → Renderer）**：
- 共享契约定义每个事件名及其 payload 类型
- Main 侧 `mainToRender.bindWebContents(wc).eventName(payload)` 发送到指定窗口（`WeakMap<WebContents>` 缓存 proxy）
- Renderer 侧 `mainToRender.bindRender(on, off).eventName(handler)` 注册监听，返回取消订阅函数

### 文件结构

每个命名空间由 5 层文件组成：

```
src/shared/ipc/<name>.ts          ← 唯一类型真相源（R→M 方法签名 + M→R 事件 payload）
src/main/startup/ipc/<name>.ts    ← Main handler（bindMain 注册）
src/preload/invoke/<name>.ts      ← Preload 白名单 invoke
src/renderer/ipc/<name>.ts        ← Renderer 绑定（xxxApi / xxxEvents）
src/renderer/components/...       ← 业务代码通过 `import { xxxApi } from '@/ipc/<name>'` 调用
```

### 命名空间一览

共 30+ 个命名空间，覆盖所有 IPC 通道：app、window、auth、signin、featureFlags、misc（folder/debug）、profile、agentChat、chatSession、models、llm、fs、workspace、mcp/mcpAuth、navigate、skills、builtinTools、subagentRun、runtime、sync、update、logViewer（dev-only）。

**例外**：`log:write` 是 renderer → main 的**单向** `send`，不走类型化框架（每条日志加 invoke round-trip 太重）；见下文「日志流」。

### 特殊情况

- `fs.getPathForFile`：同步 webUtils 调用，不走 IPC，保留在 preload 直接暴露
- `electronAPI.platform`：静态属性（`process.platform`），非 IPC 通道
- `preload/screenshot.ts`：独立窗口的 preload 脚本，仅暴露所需的命名空间子集

### 新增 IPC 通道的步骤

1. 在 `src/shared/ipc/` 创建契约文件，定义 R→M 类型和/或 M→R 事件类型
2. 在 `src/main/startup/ipc/` 创建 handler 文件，使用 `renderToMain.bindMain(ipcMain)` 注册
3. 在 `src/preload/invoke/<name>.ts` 创建白名单 invoke
4. 在 `src/preload/main.ts` 的 `ElectronAPI` 接口和 `electronAPI` 对象中注册命名空间
5. 在 `src/renderer/ipc/<name>.ts` 创建 Renderer 绑定
6. 业务代码通过 `import { xxxApi } from '@/ipc/<name>'` 调用，**禁止直接使用 `window.electronAPI`**

---

## 聊天消息流

从用户输入到消息持久化，一共经过七步：

1. 用户发送消息 → Renderer 调用 `sendChatMessage` IPC
2. `agentChat` IPC 从 sender 所属主窗口解析 runtime `Profile`，再经 `Profile.getOrCreateAgent()` 取得 Pi Agent；Pi Session 后续以绑定的 `profileId` 精确访问 store / subagent manager，不重新读取 selection
3. `pi.complete` / `pi.stream` 调用 LLM，启用流式输出
4. 流式 chunk 通过 `onStreamingChunk` IPC 事件转发到 renderer
5. `AgentIpc` → `AgentSessionCacheManager` → 直接回调 → `AgentPage` 状态更新
6. `AssistantMessage` 把 `cleanedText` 喂给 `MarkdownView`（无打字机；流式与已完成走同一渲染路径）
7. 完成后的消息通过 `persist.Session.appendMessage()` append 到 `agents/{a_ulid}/sessions/{YYYYMM}/{s_ulid}/messages.jsonl`；data.json 由 PersistBase 节流写盘

**session 物理位置**：`~/.deskmate/profiles/p_{ulid}/agents/{a_ulid}/sessions/{YYYYMM}/{s_ulid}/`，含 `data.json`（元数据 + `contextState` 压缩栈）+ `messages.jsonl`（append-only）+ 可选 `files/`（session 私有 sandbox）。schedule run 隔离到 `agents/{a}/schedules/{j}/runs/{ym}/{s}/`。

聊天状态迁移：`IDLE → SENDING_RESPONSE → COMPRESSING_CONTEXT → COMPRESSED_CONTEXT → RECEIVED_RESPONSE`

详见 [agent-loop.md](agent-loop.md)（完整 turn loop 架构）和 [persist.md §3](persist.md)（磁盘布局 + Session 物理位置）。

---

## Persist 数据流（替代旧 Profile 防抖广播）

老 `ProfileCacheManager` + `ProfileDataManager` 双重 debounce（500ms + 200ms = ~700ms 全量 `profile:updated` 广播）已**整体退役**。新模型走"细粒度域 atom + 每域独立 150ms 防抖"。

### 写入路径

```
Renderer 触发写操作（如 agentOps.updateAgent）
  → 老 invoke 通道到 main（IPC 写路径短期内不重做）
  → 当前 UI selection 对应的 ProfileStore → ProfileStore.getAgent(id) → agent.patchFront(...) + agent.persist()
  → persist/lib/emit.ts 按写入域 emit 对应通道（150ms 防抖，按 id 维度）
  → mainWindow webContents 收到 persist:* 事件
  → 对应 src/renderer/states/<domain>.atom.ts 增量 reconcile
  → useXxx() hook 通过 useSyncExternalStore 触发组件重渲染
```

### 12 条细粒度通道

| 通道 | payload | 写入触发点 |
|---|---|---|
| `persist:agent:registry:updated` | `{profileId, kind, items, primaryAgentId?}` | agents.json (含 primaryAgentId) / skills / mcp 注册表写盘 |
| `persist:agent:updated` | `{profileId, agentId, record, detail}` | `Agent.persist()`（按 agentId 防抖）；record 含 hot description，detail 含 cold delegates，两层同时下推 |
| `persist:agent:removed` | `{profileId, agentId}` | `Agent.archive()` |
| `persist:session:index:updated` | `{profileId, agentId, month, entries}` | `Agent.sessionIndex` 月文件写盘 |
| `persist:session:updated` | `{profileId, agentId, sessionId, data}` | `Session.persistData()`（按 sessionId 防抖） |
| `persist:session:messages:appended` | `{profileId, agentId, sessionId, items}` | `Session.appendMessage()` |
| `persist:schedule:updated` | `{profileId, agentId, jobId, job}` | `Agent.upsertJob()` |
| `persist:schedule:removed` | `{profileId, agentId, jobId}` | `Agent.deleteJob()` |
| `persist:schedule:run:updated` | `{profileId, agentId, jobId, sessionId, status}` | `ScheduleJob.startRun/finishRun` |
| `persist:schedule:run:removed` | `{profileId, agentId, jobId, sessionId}` | `ScheduleJob.deleteRun()` |
| `persist:settings:updated` | `{profileId, settings}` | `Profile.settings` 写盘 |
| `persist:starred:updated` | `{profileId, items}` | `Starred.doPersist()` |

每个 renderer window 在创建时由 preload 注入固定 Profile ID，不存在 profile 切换时的新旧数据竞态。

### Renderer atom 一览

每个域一个 `src/renderer/states/<domain>.atom.ts`，订阅对应通道并维护只读视图。`atom/unit.ts` 提供 `get / use / listen / change`（只在 atom 文件内部用 `change` 写）：

```
agents.atom             ← agent:registry:updated[kind=agents] / agent:updated / agent:removed
                         （只持 `AgentRecord` hot 字段；description 供批量 delegation picker，含 primaryAgentId）
agentDetail.atom        ← agent:updated（拿 payload.detail 刷 cache） / agent:removed
                         （cold `AgentDetail` 含 systemPrompt / mcpServers / skills / delegates / ...；按 agentId
                         lazy fetch via `getAgentDetail` IPC，命中 cache 同步返；并发同 id 合并）
sessionIndex.atom       ← session:index:updated / session:updated（按 agentId slot）
sessionData.atom        ← session:updated（按 sessionId 按需 hydrate）
schedules.atom          ← schedule:*
settings.atom           ← settings:updated
starred.atom            ← starred:updated
skills.atom             ← agent:registry:updated[kind=skills]
mcp.atom                ← agent:registry:updated[kind=mcp]（同时驱动 mcpClientCacheManager 更新 runtime）
mcpRuntime.atom         ← 包 mcpClientCacheManager（runtime 状态不归 persist）
```

无独立 atom：messages 仍由 `agentSessionCacheManager` 通过 streaming chunk 维持（D5 跳过）。

scheduleRuns.atom 独立缓存 `ScheduleRunSessionDataFile[]` —— 与 sessionIndex.atom 物理分开（schedule_run 形态字段差异大，强行同表只会污染语义）。订阅 `persist:schedule:run:updated` / `persist:schedule:run:removed` / `persist:schedule:removed` 触发整 agent 重 fetch（payload 字段不全，不做增量 upsert）。

详见 [ai.prompt/persist.md §6](persist.md)（IPC 协议）。

---

## MCP 工具执行流

1. LLM 在生成聊天回复时请求一次 tool call
2. `pi/tool.ts::executeToolCall(call, catalog, ctx)` 用 `catalog.getRoute(toolName)` 取 route
3. 按 route 分发:
   - `route.kind === 'local'` → route 直接持有的 `LocalTool` 经 `pi/tools/registry.ts::executeLocalTool(tool, args, ctx)` 执行
   - `route.kind === 'mcp'` → `ToolContext.profileId → ProfileRegistry.require() → Profile.mcpManager.executeToolOnServer({ serverName, toolName, ... })`；client、OAuth cache / dedup 和 runtime state 均属于该 Profile
4. 工具结果返回给 LLM，继续生成后续回复
5. 需要路径访问的文件 / 命令类工具会先经过 `SecurityValidator`，并在必要时请求用户批准

详见 [MCP Runtime](../src/main/lib/mcpRuntime/ai.prompt.md)

---

## 子智能体执行流

1. 父 Agent 的 LLM 请求调用顶层 `subagent` LocalTool，并以同一 response 的多个 call 表达并行。
2. tool handler 以 `ToolContext.profileId` 精确取得 runtime `Profile`，再经 `Profile.getSubAgentManager()` 取得 command facade；`list` / `describe` 复用 `ProfileStore.resolveDelegates`，`run` 创建新 subrun，`continue` 从 parent-owned terminal subrun 取得 delegate 后重新授权。
3. manager 以完整 parent identity 短锁完成 stale recovery、parallel gate、initial reservation 或 continuation 的 terminal→running transition，再注册 active run。
4. `SubAgentSession` 在 delegate scope 内使用执行 Agent 的 config/catalog/prompt，初始 task 或 continuation message 都写入同一 hidden transcript，并以 `submit_result` 收敛当前 execution 的正式结果。
5. manager timeout/parent cancel 直接 abort 实际 run；`PersistSubrunDataFile.histories` 与 parent tool formal result 是 reload 事实源，`Subrun` getter 在内存中补回身份与状态语义。
6. `subagentRun` IPC 的 query / cancel 只携带 parent identity；main 从 sender-owned Profile 补齐完整 owner identity 后定位 manager、磁盘 subrun 与对应卡片。live state 按 owner window 推送；`getRunState` 将磁盘状态投影为同一个 `SubAgentRuntimeState`，`getRunMessages` 只在 Dialog 打开后读取 Domain transcript，`cancelRun` 只取消完整 parent identity 下的单一 active run。Dialog 关闭释放 transcript，renderer live cache 与主聊天 cache 都不持有它。

---

## 流式渲染管线

这条管线经过专门优化，在活跃流式输出期间尽量绕开 React 的不必要重渲。

- 主进程通过 IPC 推送 LLM chunk
- `AgentIpc` 接收 chunk → `AgentSessionCacheManager` 通过直接回调写入缓存（绕开 React 渲染流水线）
- `lib/chat/render-items-manager` 重算渲染项时，通过 `reuseUnchangedItems()` 按 stable key 复用未变化的 item 引用 — 历史消息不再每个 chunk 都新建对象
- `ChatRenderItemComponent` 用 `React.memo` + 浅比较跳过未变 item；仅 streaming 那条 + activity-loading 重渲
- `MarkdownView`（位于 `components/chat/message/`）是无状态 Markdown 渲染器，输入 cleanedText 即输出；之前的 RAF 打字机/光标动画已永久砍除（`uiConfig.showCursor` 默认 false，整套机器一直跑空）
- 跟随滚动由 `ChatContainer.useAutoScroll` 监听 streaming message 的文本长度变化驱动（每 chunk 一次 `scheduleLatestScroll`），用户上滚后阈值保护自动跟随
- Mermaid 图与 Monaco editor 会作为独立的异步 chunk 惰性加载，避免阻塞初始渲染

详见 [聊天 UI ai.prompt.md](../src/renderer/components/chat/ai.prompt.md)

---

## 日志流（pino + sqlite）

所有进程写入同一张 sqlite 表 `app_logs`（`~/.deskmate/logs/{dev,app}.db`），靠 `process_type / window_id / pid` 区分来源。

1. **Main / Worker** — `import { log } from '@main/log'` → pino 实例 → worker_thread transport（`src/main/log/sqlite-transport.cjs`） → better-sqlite3 异步落盘（WAL）。`log.flush()` 走 `thread-stream.flush(cb)`，等 worker ack 后 resolve。
2. **Renderer** — `import { log } from '@/log'` 按 level 早过滤（dev: trace+，prod: info+），通过 `ipcRenderer.send('log:write', { level, fields })` **单向** 跨进程。主进程 handler（`src/main/startup/ipc/`）强行覆写 `processType='renderer'` 和 `windowId = sender.id` 防伪造，再调用 main 的 `log.<level>(fields)` 走同一条 pino → worker 链路。`log:write` 是热路径，故意不走 `invoke` 框架避免 round-trip。
3. **退出** — `onBeforeQuit` 调 `closeLogs(5000)`：flush + transport.end + once('close')，带超时不阻塞退出。

读取侧（dev-only Log Viewer 与 doctor agent）通过 `logViewer` 命名空间走类型化 IPC：

| 通道 | 方向 | 用途 |
|------|------|------|
| `logViewer:getDbPath` / `logViewer:query` / `logViewer:stats` | invoke/handle | viewer 主动拉数据；handler 仅在 `!app.isPackaged` 注册 |
| `logViewer:appended` | send/on | viewer 打开期间，main 250ms poll `max(id)` 变化后广播；renderer 用 `sinceId` 增量拉新行 |

详见 [log-analysis.md](log-analysis.md) 和 [src/main/log/ai.prompt.md](../src/main/log/ai.prompt.md)。
