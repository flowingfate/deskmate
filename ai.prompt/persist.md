# 持久化层（Persist）

<!-- Last verified: 2026-07-19 (Profile-owned main-window state; app runtime storage overview) -->

## 1. 范围

本文档覆盖 DESKMATE 的本地用户态持久化层 —— `~/.deskmate/profiles/` 下所有用户产生的数据、读写这些数据的 main 进程 store 层与跨进程 IPC，以及 `/settings/persist` 对应用级 `~/.deskmate/env/` 的只读运行时存储概览。

代码位置:

- `src/shared/persist/` — 纯数据工具 + 本地 schema：`types/index.ts` 是唯一公共入口，`types/` 按磁盘资源域拆分；schema **不依赖** `src/shared/types/`。**0 fs / 0 electron / 0 Node 环境 api**,main / renderer / worker 共用。
- `src/main/persist/` — class 风格、单实例缓存的 store 层;所有磁盘 io。**仅 main 进程使用**。
- `src/shared/ipc/persist.ts` — IPC 通道契约(types only)。

模块级深度文档(class 关系、26 条 Gotchas、Common Changes 入口):见 [src/main/persist/ai.prompt.md](../src/main/persist/ai.prompt.md)。

> **历史背景**:本布局是 2026-06 完成的"Chat → Agent 一等公民"重构产物;旧 `userDataADO/` + `chat/` 路径已删除,本文档是新架构的**唯一对外入口**。

---

## 2. 核心范式

| 维度 | 现状 |
|---|---|
| 一等公民 | **Agent**(`a_{ulid}`)。`Chat` / `ChatConfig` / `ChatAgent` / `chats[]` 已消失 |
| profile 目录命名 | `p_{ulid}`,alias 仅展示;登录/登出只翻 `kind: guest \| signed_in` 标记 |
| Agent 配置载体 | `AGENT.md`(front-matter + body 即 system prompt),与 sub-agent 对齐 |
| Session 物理位置 | `agents/{a}/sessions/{YYYYMM}/{s}/`;schedule run 隔离到 `agents/{a}/schedules/{j}/runs/{ym}/{s}/`;每个 parent session 都可含 `subruns/{001..999}/` |
| Session 内容 | `data.json`(元数据 + `contextState` 压缩栈 + `turn.status` resume flag)+ `messages.jsonl`(append-only,3 种 line:`PersistedUserMessage` / `PersistedAssistantMessage` / `PersistedToolResponse`)+ 可选 `files/`(session 私有 sandbox)；subrun 另有 v1 `data.json`（精简 owner-local identity + execution histories + 可恢复 session 状态）/`messages.jsonl`，绝不建 files |
| Subrun 磁盘/运行时边界 | `PersistSubrunDataFile` 是唯一真实 schema，不重复目录链已知的 profile、父 Agent/session ID；`Subrun` 通过明确 getter 暴露当前运行语义，manager/IPC 直接构造 `SubAgentRuntimeState`，不存在第二套 `*SubrunDataFile` 镜像 |
| Starred 真值 | `regular_sessions.starred_at` 列;schedule_run 不可 star |
| Schedule run 继续对话 | 已结束 run 只能派生新的 regular session：复制消息 / sandbox / contextState，重置 run 元数据；原 run 和 `job_runs` 行保留 |
| ID 体系 | ULID(Crockford Base32,26 字符)+ 类型前缀,如 `s_01KT0JY38BMDCCDA2W3X3YDMCV`。深路径在 Windows 260 字符上限留余量 |
| IPC | 13 条细粒度通道(按域),每域独立 150ms 防抖;老 `profile:updated` 全量广播已废 |

**关键不变量**:

1. **派生数据可丢**:`index.db` 损坏 → 删盘 + 扫所有 `data.json` 重建(`SessionIdx.rebuildFromDisk` / `JobRunIdx.rebuildFromDisk`)。
2. **源真值在磁盘**:`AGENT.md` / `data.json` / `messages.jsonl` / `job.json` / `jobs.json` items 顺序 / `agents.json` items 顺序。`agents.json#items` 行与 `regular_sessions` / `job_runs` 表内容都是派生缓存。
3. **跨 profile 物理隔离**:`index.db` 每 profile 一个;从不存在跨 profile JOIN。`agentId` / `sessionId` 全局唯一(ulid)但运行时 API 永远要求传 `profileId`。
4. **写顺序 = 源真值优先,索引随后**:建目录 → 写 `data.json` → SQL UPSERT。中断态最多剩"DB 没行但盘上有目录",由 reconcile / rebuild 兜底。
5. **profiles.json 至少有一个 entry**:bootstrap 时若 items 为空 → 初始化未登录 profile 作 active;删除最后一个 profile 的请求必须被拒绝。
6. **每个持久化 JSON 文件都带 `version: 1` 字段**:为未来 schema 变更预留迁移锚点。新增持久化 JSON 文件必须从 `version: 1` 起步。详见 [§13 Schema 版本约定](#13-schema-版本约定)。

---

## 3. 磁盘布局

```
~/.deskmate/
├── app.json, device-id, state/, cache/, logs/, env/, ...   # env 不属于 persist；仅由本模块只读统计后展示
└── profiles/
    ├── profiles.json                              # 索引 + activeProfileId(guest / signed_in)
    └── p_{ulid}/
        ├── settings.json                          # < 2 KB;旧 profile.json 已删
        ├── auth.json, auth.pi.json                # 未登录态不存在
        ├── index.db, index.db-wal, index.db-shm   # SQLite WAL;regular_sessions + job_runs
        ├── scheduler-state.json                   # scheduler cold-start catch-up
        ├── window.json                            # 本 Profile 主窗口的 bounds / zoom / maximized
        ├── agents/
        │   ├── agents.json                        # items[] + primaryAgentId(替代旧 profile.json)
        │   └── a_{ulid}/
        │       ├── AGENT.md                       # front-matter + body(system prompt)
        │       ├── knowledge/                     # agent 级共享:手动归档资料 + 动态 skill
        │       ├── sessions/
        │       │   └── {YYYYMM}/{s_ulid}/         # 月份桶仅作物理布局(inode/备份/迁移分批友好)
        │       │       ├── data.json              # 源真值
        │       │       ├── messages.jsonl         # append-only
        │       │       ├── files/                 # session 私有 sandbox(按需创建)
        │       │       └── subruns/001/            # hidden, continuable delegated conversation
        │       │           ├── data.json           # delegate + execution histories + session resume state
        │       │           └── messages.jsonl      # append-only delegated transcript
        │       └── schedules/
        │           ├── jobs.json
        │           └── {j_ulid}/
        │               ├── job.json
        │               └── runs/{YYYYMM}/{s_ulid}/   # 同 sessions 结构(含 files/)
        ├── skills/  mcp/  models/                 # profile 级共享注册表
        └── archive/                               # agent 软删归档
```

**`YYYYMM` 月份桶仅作物理布局**:避免单目录 inode 爆炸 + 备份分批 + 人类心智对齐 + DB rebuild 按月扫盘。查询路径**不扫月份目录**,走 SQL PK 命中。

### 已消失的文件 / 类型

| 旧 | 处置 |
|---|---|
| `profile.json` (39.8 KB, 73% 是 `skill_snapshot`) | 整体取消。身份并入 `profiles.json`;`agentOrder` / `primaryAgent` 折入 `agents.json`;`skill_snapshot` 运行时按 binding signature 内存重算 |
| `chat_sessions/{chat_id}/` | Agent 取代 Chat 后,session 物理位置改写 |
| `sessions/index.json` | Step 9 切 SQLite 后物理消失 |
| `starred-sessions.json` | Starred 收口到 `regular_sessions.starred_at` 列 |
| `chat_workspaces/` | `agent.workspace`(用户托管项目)已删;待后续单独立项 |
| `ChatConfig` / `ChatAgent` / `ChatConfigRuntime` / `chat_type` / `chat_id` | Chat 层概念整体重命名为 `AgentEnvelope` / `AgentPersona` / `agent_id`，并删去 `chat_type`、`ProfileStore.chats`、`ProfileStore['starred-chat-sessions']`、`DEFAULT_PROFILE` 等死字段 / 死常量 |
| `chat.skill_snapshot` / `data.json#interaction_history` | 派生数据不落盘 |
| `agent.role` / `agent.enabled_plugins` / `agent.context_enhancement` / `profile.syncSettings` | 产品决策放弃 |

---

## 4. 调用链(**严格遵守**)

```
ProfileRegistry.require(profileId).store → ProfileStore
  .getAgent(id)                        → Agent
    .getSession(id)                    → RegularSession
    .getJob(id)                        → ScheduleJob
      .getRun(id)                      → JobRun
```

`ProfileRegistry` 是唯一 app-scoped owner：它在闭包中同时持有 `profiles.json` index 与 runtime Profile，启动时先加载 index、再加载所有 entries，并合并同 profile 的并发 `getOrLoad`。每个 runtime `Profile` 拥有自己的 Pi、MCP 与 scheduler 服务；业务调用方沿 sender / ToolContext / 已运行任务持有的 Profile identity 调 `require(profileId)`，不存在 ambient selected accessor。`defaultProfileId` 只用于首次启动、无显式目标的新窗口和 headless eval。每个主窗口在构造时把自己的 Profile ID 写入 `BrowserWindowMeta.profileId` 与 `webPreferences.additionalArguments`；preload 从 `process.argv` 同步读取，既有窗口永不改变 owner，也不接收 profile switch 事件。`ProfileStore` 只管理一个 profile 的持久化对象图与 SQLite。

`Session` 是抽象基类(messages.jsonl I/O + files sandbox + 节流 persist + 元数据 mutate)，也只作为 parent owner 暴露 `createSubrun/getSubrun/listSubruns`；这些 API 始终以当前 Session 实例限定三位 ID，Subrun 本身不注册为 Session。主会话消息接口分三招:`appendDomainMessage(m: Message)` 写 user / assistant 行,`appendToolResponse(toolCallId, result)` 写 `tool_res` 行,`rewriteMessages(messages: Message[])` 整段重写 jsonl(`dehydrate` 序列化,emit `session:messages:rewritten`)。读取走 `loadDomainMessages()` 折回 Domain `{ messages, orphanResponses }`。`RegularSession` 与 `JobRun` 是子类,路径树各自实现,永不共用同一容器。要分支判断用 `instanceof`。

Subrun 首次 execution 是 `pending → running → terminal`；terminal 后 `Subrun.continueConversation()` 会保留同一三位 ID、transcript 和 contextState，直接追加一轮 continuation history。每项 history 代表一次 execution，状态转换原位更新最后一项而不追加 transition event；terminal result 不重复 status、subrunId、delegateAgentId。加载时 store 使用 parent 路径与顶层 delegate 补回完整 request/result/current execution 运行时视图。

`Agent.getSession(id)` / `ScheduleJob.getRun(id)` 走 PK 查 SQLite index,**无月份目录扫描**。

---

## 5. Bootstrap 顺序

`ProfileRegistry.bootstrap()` 跑（幂等，二次调用直接 no-op）：

1. `ProfileRegistry` 确保 `profiles.json` 至少有一个 entry，并解析只读 `defaultProfileId`。
2. registry 对全部 entry 并行 `getOrLoad()`；同一 profile 的并发调用共享 loading promise，单 profile load 失败只进入 warnings，不阻断其他 profile。
3. `ProfileStore.load()` 为单 profile 装载 config/settings、`ProfileDb.open()` + integrity check、MCP/skills/models、agent registry、reconcile 与 archive GC。
4. `Profile.start()` 为该 runtime Profile 依次启动其 scheduler 与 MCP；scheduler 的 task 注册、cold-start catch-up 与 `scheduler-state.json#isActive` 均归该 Profile。

**DB 自愈 / 初次填充**：`ProfileDb.wasCreated`（升级 / migrate / 拷贝 profile 目录场景，新建空表）或 `checkIntegrity() === false`（DB 损坏 → 删盘 → 重 open）都会跑 `SessionIdx.rebuildFromDisk()` + `JobRunIdx.rebuildFromDisk()` 扫所有 `data.json` 重建。源真值在磁盘，理论无数据丢失。

启动期 / `getSnapshot` **不读任何 AGENT.md**。cold 字段由 renderer 按需通过 `getAgentDetail` IPC 单读（见 §7）。

---

## 6. IPC 协议

通道契约:[`src/shared/ipc/persist.ts`](../src/shared/ipc/persist.ts)。

### 6.1 Renderer → Main(invoke / handle)

| 通道 | 用途 |
|---|---|
| `profile-scoped persist` | renderer 不传 `profileId`；main 从 IPC sender 所属 BrowserWindow 解析 owner，再执行 snapshot / Agent / Session / settings / storage 操作 |
| `listAllSessions(agentId)` | owning Profile 的该 agent 全部 regular session entries，按 updatedAt 倒序(SQL 直查) |
| `listAllScheduleRuns(agentId)` | owning Profile 跨 job 聚合 schedule_run，按 startedAt 倒序 |
| `getSession(agentId, sessionId)` / `getSessionMessages(agentId, sessionId)` / `getSessionFilesDir(agentId, sessionId)` | owning Profile 的 session 数据、完整消息或 sandbox 路径 |
| `createAgent / patchAgentFront / archiveAgent / unarchiveAgent / duplicateAgent / setPrimaryAgent / listArchivedAgents / getAgentDetail` | owning Profile 的 Agent CRUD 与 cold detail |
| `renameSession / setSessionStarred / deleteSession / deleteScheduleRun / forkJobRunToSession / getUnreadSummary` | owning Profile 的 session 与 run 写路径 / 未读统计 |
| `updateConfirmationSettings` / `updateWebSearchSettings` | owning Profile 的 settings 写入 |
| `getStorageOverview` / `getRuntimeStorageOverview` / `revealStoragePath(absPath)` | 前者只统计 owner Profile；后者单遍统计跨 Profile 共享的 `env/` 运行时目录；reveal 仅放行当前 Profile、app root 或 `env/` 子树 |

### 6.2 Main → Renderer(send / on,按域 150ms 防抖)

| 通道 | payload 要点 | 触发点 |
|---|---|---|
| `agent:registry:updated` | `{ profileId, kind, items, primaryAgentId? }`(`kind` 可为 `agents` / `skills` / `mcp`) | agents.json(含 `primaryAgentId`)/ skills / mcp 写盘 |
| `agent:updated` | `{ profileId, agentId, record, detail }`（record 含 hot description，detail 含 cold delegates） | `Agent.persist()`（按 agentId 防抖） |
| `agent:removed` | `{ profileId, agentId }` | `Agent.archive()` |
| `session:index:updated` | `{ op:'upsert', entry }` 或 `{ op:'remove', id }`(**单条 op**,renderer 按 id 合并) | `SessionIdx.upsert` / `remove` |
| `session:updated` | `{ profileId, agentId, sessionId, data }` | `RegularSession.afterPersist`(按 sessionId 防抖) |
| `session:messages:appended` | `{ profileId, agentId, sessionId, items }` | `Session.appendMessage` 流式回放 |
| `schedule:updated` | `{ profileId, agentId, jobId, job, entry }` | `Agent.upsertJob` |
| `schedule:removed` | `{ profileId, agentId, jobId }` | `Agent.deleteJob` |
| `schedule:run:updated` | `{ profileId, agentId, jobId, sessionId, status }` | `JobRun.afterPersist` |
| `schedule:run:removed` | `{ profileId, agentId, jobId, sessionId }` | `ScheduleJob.deleteRun` |
| `settings:updated` | `{ profileId, settings }` | `ProfileStore.settings` 写盘 |
| `starred:updated` | `{ profileId, items }` | `RegularSession.setStar` 引发的 starred 集合变化 |

每个 renderer window 的 Profile 在创建时固定，因此不存在 profile 切换时的新旧数据竞态。

### 6.3 Renderer atom 一览

每个域一个 `src/renderer/states/<domain>.atom.ts`,订阅对应通道并维护只读视图。`atom/unit.ts` 提供 `get / use / listen / change`:

| atom | 订阅 | 备注 |
|---|---|---|
| `agents.atom` | `agent:registry:updated[kind=agents]` / `agent:updated` / `agent:removed` | 只持 `AgentRecord`(hot list 字段);含 `primaryAgentId` |
| `agentDetail.atom` | `agent:updated`(拿 `payload.detail` 刷 cache)/ `agent:removed` | cold 字段 `AgentDetail`;按 agentId lazy fetch via `getAgentDetail`,命中 cache 同步返;并发同 id 合并 |
| `sessionIndex.atom` | `session:index:updated` / `session:updated` | 按 agentId slot |
| `sessionData.atom` | `session:updated` | 按 sessionId 按需 hydrate |
| `scheduleRuns.atom` | `schedule:run:updated` / `schedule:run:removed` / `schedule:removed` | 与 `sessionIndex.atom` 物理分开(schedule_run 字段差异大);payload 字段不全 → 整 agent 重 fetch |
| `schedules.atom` | `schedule:*` | — |
| `settings.atom` | `settings:updated` | — |
| `starred.atom` | `starred:updated` | — |
| `skills.atom` | `agent:registry:updated[kind=skills]` | — |
| `mcp.atom` | `agent:registry:updated[kind=mcp]` | 同时驱动 `mcpClientCacheManager` 更新 runtime |
| `mcpRuntime.atom` | 包 `mcpClientCacheManager` | runtime 状态不归 persist |
| `currentSession.atom` / `doctor.atom` / `right-pane.atom` / `left-nav.atom` | — | UI 状态,与 persist 无关 |

无独立 atom:messages 仍由 `agentSessionCacheManager` 通过 streaming chunk 维持。

---

## 7. Agent 两层视图(Hot / Cold)

AGENT.md 是源真值;`AgentRecord` 是其同名字段的派生缓存。

| 视图 | 类型 | 字段 | renderer 用法 |
|---|---|---|---|
| Hot | `AgentRecord`(`agents.json#items` 行) | `id / name / description? / version / model / emoji? / avatar? / locked? / createdAt / updatedAt` | sidebar / chat header / model selector / delegation picker 直接持 `agents.atom`；description 放 hot 避免候选列表 fan-out 读 AGENT.md |
| Cold | `AgentDetail`(AGENT.md 解析) | `agentId / systemPrompt / thinkingLevel? / tools? / mcpServers? / skills? / delegates? / zero?` | agent editor 按 agentId lazy fetch；delegates 保留配置顺序与 dangling ID |

### Agent graph resolver

- `Agent.patchFront({ delegates })` 按类型化输入原样落盘，不额外建立 normalization helper。
- `ProfileStore.resolveDelegates(parentId)` 是授权与 prompt 的唯一解析入口，返回 `ResolvedAgentDelegates | null`；parent 缺失返回 null，调用方必须显式分支。
- resolver 解析时 trim/忽略空值/稳定去重；available 按配置顺序 join active `AgentRecord`，self/归档/不存在目标进入 unavailable。
- resolver 只按需读取父 Agent 的 AGENT.md，不读取 target details；runtime 每次真正 run 前必须重新调用。archive 不改 incoming references，restore 后 dangling 自动恢复；duplicate 复制 description 与 outgoing delegates。

### 唯一写入口

- `Agent.patchFront(partial)`(async)→ 先写 `AGENT.md`,再回调注入的 `AgentRegistry.syncRecord(this.toRecord())`。
- `ProfileStore.createAgent` / `duplicateAgent` → 新建时直接 `agentRegistry.items.push(agent.toRecord())`,整条写。
- `ProfileStore.archiveAgent` / `restoreAgent` → 整条删 / 整条加。

**绕过这些入口手动 mutate `agentRegistry.items` 或单独写 `AGENT.md`**:record stale,sidebar / chat header 显示旧 name / model 直到下次 `patchFront` 触发。

### `createdAt` / `updatedAt` 只挂 `agents.json`

`AgentRecord` 的 `createdAt / updatedAt` **不在 AGENT.md 里**,只挂 `agents.json`。`Agent.load` 必须从 `registry.items` 反向回填到实例,否则后续 `patchFront`:

1. 内存 config 改、AGENT.md 写盘 ✅
2. `doPersist` 的 `emit('agent:updated')` 因 `createdAt === ''` 兜底被吞 ❌
3. `syncRecord(this.toRecord())` 在 `toRecord()` 抛 `createdAt/updatedAt not initialized` ❌

净效果:AGENT.md 是新的,agents.json items 永远 stale,UI "切了模型没反应"。

**新加字段时**:明确只挂 record 还是只挂 markdown,load 时怎么互填,加一条"reload + patchFront"回归测试。

### 为什么不在 bootstrap 做 reconcile

bootstrap 期间对所有 agents 做 record ↔ markdown 对账等于把"启动期不读 AGENT.md"的设计目标推翻。本架构选了**写路径同步**而不是**读路径 reconcile**。手动入口 `ProfileStore.reconcileRecordFromMarkdown(id?)`(当前未实现,按需添加)给 Doctor / migrate 后置脚本用。

### Renderer 端 `agent:updated` 同时下推

main 端 `agent:updated` 事件 payload 同时下推 `{ record, detail }`,避免 renderer 写完 agent 后还要再 invoke 一次 `getAgentDetail`。

---

## 8. 路径布局

- agent Knowledge Base 路径固定为 `${agentRoot}/knowledge`,无配置覆盖入口。
  `KnowledgeProtocolHandler.resolveBaseDir` 直接拼这个路径,renderer 走 `knowledge://`
  URI 解析。
- `local://` 始终沿 `agentId → Agent.findSessionAcrossKinds(sessionId)` 定位 parent RegularSession/JobRun；delegate mode 的 `delegateId` 只决定 execution Agent 的 Knowledge/Skills，不参与 parent store 定位。
- MCP server config 的 `url` / `env` 只接受绝对路径(没有占位符展开层)。

---

## 9. SQLite Index(Step 9 落地)

### 9.1 表结构概要

完整 DDL 在 [`src/main/persist/lib/db/schema.ts`](../src/main/persist/lib/db/schema.ts)。**两张物理分表**:

`regular_sessions` —— 用户发起的对话 session:

- 列:`id` (PK) / `agent_id` / `month` / `title` / `read_status` ('read'|'unread') / `starred_at` (NULL = 未收藏) / `created_at` / `updated_at`
- 偏序索引:
  - `ix_regular_agent_updated`(主要排序键)
  - `ix_regular_agent_created`
  - `ix_regular_agent_unread WHERE read_status = 'unread'`(未读 COUNT 走索引)
  - `ix_regular_agent_starred WHERE starred_at IS NOT NULL`(收藏列表)

`job_runs` —— schedule job 一次执行产生的 session:

- 列:`id` (PK) / `agent_id` / `job_id` / `month` / `title` / `read_status` / `run_status` ('running'|'completed'|'failed') / `started_at` / `finished_at` / `run_error` / `created_at` / `updated_at`
- 三态 `CHECK`:`running → finished_at IS NULL AND run_error IS NULL`;`completed → finished_at IS NOT NULL AND run_error IS NULL`;`failed → finished_at IS NOT NULL AND run_error IS NOT NULL`
- 偏序索引:`ix_runs_job_started` / `ix_runs_agent_started` / `ix_runs_agent_created` / `ix_runs_agent_unread WHERE read_status='unread'`

**时间列强制 ISO UTC `...Z`**(`CHECK col LIKE '%Z'`):SQLite 中 TEXT 字符串字典序与时间序等价当且仅当所有值用 `Z` 结尾。代码里 `new Date().toISOString()` 已天然满足;CHECK 是 schema 自我保护。

**为什么拆两表而非同表 + `kind` 列**:`job_runs` 无 starred 语义、有独立 `run_status` 三态、`started_at` 是主排序键 —— 强行同表只会让 CHECK union 和偏序索引膨胀,业务上"星标只对 regular 有意义"被 schema 包容性混淆。

**为什么不与 `jobs.json` 做 FK**:`schedule_jobs` 不在 DB(N<50,写量在 fs 噪声范围),没有 SQL 层 FK 可建。jobs 与 runs 的物理删除顺序由 `Agent.deleteJob` 串联(`jobs.json` 行删 → `JobRunIdx.removeByJob(jobId)` → 递归删盘),孤儿 run 行由 rebuild 一次性清理。

### 9.2 候选索引(触发条件出现时机械追加)

| 候选索引 | 触发条件 | DDL |
|---|---|---|
| 跨 agent 全局收藏视图 | 出现"我的全部收藏"独立页或跨 agent badge | `CREATE INDEX IF NOT EXISTS ix_regular_starred_global ON regular_sessions(starred_at DESC) WHERE starred_at IS NOT NULL;` |
| 跨 agent cron 监控视图 | 出现"全局调度状态总览"或"找僵尸 running"运维需求 | `CREATE INDEX IF NOT EXISTS ix_runs_global_running ON job_runs(started_at) WHERE run_status = 'running';` |
| 单 job 失败 run 过滤 | 出现"按 job 看最近失败 run"独立筛选 | `CREATE INDEX IF NOT EXISTS ix_runs_job_failed ON job_runs(job_id, started_at DESC) WHERE run_status = 'failed';` |

### 9.3 候选扩展(明确不做)

- **messages 也进 DB**:`messages.jsonl` append-only 模型流式表现良好,切到 DB 会失去 tail 流式消费语义。
- **按 title FTS5 模糊搜索**:`WHERE agent_id=? AND title LIKE ?` 在 N=1 万上 ~10ms 够用;FTS5 要写 3 个触发器维护副本,复杂度跳一档。
- **`jobs.json` 进 DB**:单 profile < 50 jobs,写频度 cron tick 级,无收益;plain JSON 对调试 cron 表达式反而有用。

---

## 10. 常见修改场景

完整清单与"涉及哪些文件"见 [src/main/persist/ai.prompt.md `Common Changes`](../src/main/persist/ai.prompt.md#common-changes)。摘要:

| 场景 | 入口提示 |
|---|---|
| 加 AGENT.md 字段 | `types/agent.ts`（经 `types/index.ts` 导出）+ `agent.ts` `AgentConfig.assign/toFrontMatter` + markdown 测试 |
| 加 regular session 索引字段 | `types/session.ts`（`RegularSessionRow`，经 `types/index.ts` 导出）+ `lib/db/schema.ts` DDL + `sessionIdx.ts` marshal/unmarshal + `RegularSession.toRegularRow` + `rebuildFromDisk` 投影 |
| 加 job_run 索引字段 | 同上但走 `JobRunRow` / `JobRun.toJobRunRow` / `JobRunIdx` 路径 |
| 将 schedule run 继续为 regular session | `session.ts#JobRun.forkToSession` + persist IPC / preload；clone messages/files/contextState，终态校验在 source JobRun | 原 run 不删、不改 |
| 加 SQLite 偏序索引 | `lib/db/schema.ts` `CREATE INDEX IF NOT EXISTS ix_xxx ON ... WHERE ...;` + `EXPLAIN QUERY PLAN` 验命中(候选清单见 §9.2) |
| 加 IPC 通道 | `src/shared/ipc/persist.ts` + `ipc.ts` handler + `preload/persist/invoke.ts` allowlist;renderer 自动类型推导 |
| 加新 profile 级共享资源(如 prompts/) | `path.ts` 加路径常量 + 新 store class + `ProfileStore` 字段 + `ProfileRegistry.bootstrap` 装载步骤;仿 `mcp.ts` |
| 加 SQLite 单元测试 | `__tests__/sqlite-index.test.ts` 模板(tmp 真盘 + `ProfileDb.resetForTesting`);better-sqlite3 是 native,无法 mock fs |
| 加 mock fs 集成测试 | 仿 `agent.test.ts` 顶部 `vi.mock('../lib/db/db', () => ({ ProfileDb: { open: () => fakeDb, ... } }))` stub;不直接断言 SQL 行 |

---

## 11. 必须遵守的纪律

完整 26 条 Gotchas 见 [src/main/persist/ai.prompt.md `Gotchas`](../src/main/persist/ai.prompt.md#gotchas)。**最容易踩雷的几条**:

- ⚠️ **`name` 不是主键**。`agents.json` 允许重名;所有引用走 `a_{ulid}` id。重命名 agent 时 id 不变；skills 沿用 name 作 id。
- ⚠️ **messages.jsonl 是 append-only**。常态走 `Session.appendDomainMessage(m)` / `appendToolResponse(id, result)` 进 buffer,`flushMessages` 才落盘;`Session.persist()` 内部会同时 flush。**整段覆盖**走 `rewriteMessages(messages)`(edit / retry / 导入路径),不要单独覆盖写 messages.jsonl。
- ⚠️ **Session 删除走 `Agent.deleteSession(id)` / `Agent.deleteJob(id)`**,会同时删 dir + SQL 行 + emit 相应 `*:index:updated`(op='remove') / `schedule:removed`。**不要**直接 `session.deleteFromDisk()`。
- ⚠️ **Agent 软删走 `ProfileStore.archiveAgent(id)`**。写顺序:archive move dir → agents.json 剔除(含 `primaryAgentId` 命中清空)。中途崩溃下次启动 `reconcileAgents()` 自愈。
- ⚠️ **AgentRecord ↔ AGENT.md 同步走唯一入口** `Agent.patchFront`(见 §7)。绕过 = renderer stale。`createdAt / updatedAt` 只挂 `agents.json`,`Agent.load` 必须从 `registry.items` 回填到实例,否则 patchFront 路径上 `emit('agent:updated')` 会被 `createdAt === ''` 兜底吞、`toRecord()` 抛 not initialized。
- ⚠️ **Starred 入口**:starred 真值是 `regular_sessions.starred_at` 列。`setSessionStarred` IPC 走 `RegularSession.setStar(star)` → 写 data.json → afterPersist 同步本列(**不刷 updatedAt**,与 `setReadStatus` 同语义)。**没有** `SessionIdx.setStarred` 入口。`setStar` 仅存在于 `RegularSession`,对 `JobRun` 无定义。
- ⚠️ **DB 自愈/初次填充**:`ProfileStore.load` 拿到 `ProfileDb.open(id)` 后看 `wasCreated` 或 `checkIntegrity() === false`,两条路径都跑两表 `rebuildFromDisk` 把 DB 与盘上 `data.json` 拉齐。
- ⚠️ **进程退出 flush**:`main.ts onBeforeQuit` 在 logger close 之前调 `ProfileRegistry.shutdownAll()`（5s 超时）。它按每个 runtime Profile 的所有权链关闭 scheduler、Pi、MCP、persist 与 SQLite；绝不 fire-and-forget，否则会丢最后一批 `messages.jsonl` 行或跳过 SQLite close。
- ⚠️ **测试 mock fs 时 helper 不能单放 `_*.ts`** —— vitest 的 include 模式 `__tests__/**/*.ts` 全扫;要么内嵌进 test 文件,要么改后缀。`session-schedule.test.ts` 整文件改走 tmp 真盘(SQLite 是 native,无法被 `vi.mock('node:fs')` 拦截)。

---

## 12. 历史决策(只列对后续设计仍有约束力的)

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-06-05 | renderer 重构走正向替换,不引入 façade | façade 是反向适配层,将来还要再删一次 |
| 2026-06-04 | pi.Session 抽 `PersistSessionLike` interface,evalHarness 用内存实现绕过落盘 | eval session 不该污染 sidebar / 留孤儿目录 |
| 2026-06-04 | pi.Session 的 `eventSender: Electron.WebContents` 形参不改 null —— evalHarness 用 Proxy stub 顶上 | renderer 是 pi.Session 公共契约的事实源,不该为一个调用方稀释签名 |
| 2026-06-03 | persist 强约束:禁止外部 mutate/读别人的 `.config.*` | 每个 child class 给专用 init/load/finish/to* API;否则 schema 改一处要四处跟改 |
| 2026-06-03 | shutdown 走父→子的所有权链,emit 独立成 `persist/lib/emit.ts` | trackSession/untrackSession 反向耦合不必要;emit 是横切关注点 |
| 2026-06-03 | pi.Session 通过构造注入 `persistSession`,不再 lookup | turn loop 热路径零 IO,状态机更简单 |
| 2026-06-03 | `startNewSessionFor` / `forkChatSession` 走 `Agent.createSession()` / `Agent.copySession()` 单调用 | 解掉"上游 IPC 传外部 sessionId / pi 收到未知 id 硬抛"遗留 |
| 2026-06-03 | 删 `agent.workspace`(path/placeholders/types 不留) | 实测无用户主动放文件;"用户托管项目"待后续单独立项 |
| 2026-06-01 | Agent class 的 `sessionIndex` / `scheduleRegistry` 必须在 constructor 中赋值,不能用 field initializer | TS field initializer 求值顺序导致 `this.profileId` / `this.id` 在 parameter-property 赋值前被读到 |
| 2026-06-01 | `lib/root.ts` 用 `require('electron')` 延迟加载 | demo/测试/CLI 在非 Electron 上下文需要 `setRootForTesting()` 覆盖;ES import 会立即解析 module 直接报错 |
| 2026-06-01 | ULID 取代 UUIDv7 | UUIDv7 在 4 层嵌套下吃到 Windows 260 字符上限;ULID 短 10 字符 |
| 2026-06-07 | Step 9:sessions 索引切 SQLite(`regular_sessions` + `job_runs` 双表) | 老 `sessions/index.json` 每条消息整 agent 全量 rewrite + IPC payload 爆炸;SQLite 单条 UPSERT + 单 entry emit |
| 2026-06-07 | `jobs.json` 不进 DB | 单 profile < 50 jobs、写频度 cron tick 级、renderer atom 是全量 reload 策略 —— 三个维度都不痛;plain JSON 对调试 cron 反而有用 |
| 2026-06-07 | starred 真值收口到 `regular_sessions.starred_at` 列 | 独立 `starred-sessions.json` 全量数组 + rebuild fan-out 浪费;偏序索引 `WHERE starred_at IS NOT NULL` 直查 |
| 2026-06-07 | `regular_sessions` 与 `job_runs` 物理分表 | 字段集差异大、schedule_run 无 starred、有独立 `run_status` 三态;同表只会让 CHECK union 和偏序索引膨胀 |

---

## 13. Schema 版本约定

所有持久化 JSON 文件 schema 顶层都带一个 `version: 1` 字段(literal type),作为未来结构化变更的迁移锚点。当 schema 发生破坏性变更时,递增版本号 → 在 store 的 `load()` 里按 version 分支做迁移。

### 当前已纳入 version 字段的文件

| 文件 | Schema 类型 | 引入 version 的位置 |
|---|---|---|
| `profiles.json` | `ProfilesIndexFile` | `ProfileRegistry` 内部 `toFile()` |
| `p_/settings.json` | `SettingsFile` | `ProfileSettings.toFile()` |
| `p_/auth.pi.json` | `PiAuthFile` | `PiAuthManager` 写入路径 |
| `p_/scheduler-state.json` | `SchedulerStateFile` | `SchedulerState.toFile()` |
| `p_/agents/agents.json` | `AgentRegistryFile` | `AgentRegistry.doPersist()` |
| `p_/agents/{a}/sessions/.../data.json` | `RegularSessionDataFile` | `RegularSession.toDataFile()` |
| `p_/agents/{a}/schedules/jobs.json` | `ScheduleJobsIndexFile` | `ScheduleRegistry.doPersist()` |
| `p_/agents/{a}/schedules/{j}/job.json` | `ScheduleJobFile` | `ScheduleJobConfig.toFile()` |
| `p_/agents/{a}/schedules/{j}/runs/.../data.json` | `ScheduleRunSessionDataFile` | `JobRun.toDataFile()` (继承 `SessionDataFileBase`) |
| `p_/skills/skills.json` | `SkillsIndexFile` | `Skills.doPersist()` |
| `p_/mcp/mcp-servers.json` | `McpServersFile` | `Mcp.doPersist()` |
| `p_/models/{provider}.json` | `ModelsCacheFile` | `Models.set()` + `GhcModelsManager.saveToFile()` |
| `p_/archive/agents/{archivedId}/_record.json` | `ArchivedAgentRecordFile`(`archive.ts` 内部类型) | `Archive.archiveAgentDir()` |

### SQLite 走独立的 schema_version

`p_/index.db` 不走 JSON 的 `version: 1` 约定,而是用 `_meta.schema_version` 行(初值 `PERSIST_DB_SCHEMA_VERSION = 1`,定义在 [`schema.ts`](../src/main/persist/lib/db/schema.ts))。两套版本号互不影响:JSON 描述本文件结构,SQLite 描述表 + 索引整体。

### 例外(明确不加 version 的文件)

| 文件 | 原因 |
|---|---|
| `p_/agents/{a}/AGENT.md` 的 `version` front-matter 字段 | **不是** schema version,而是 agent 用户态自定义版本(semver 风格,如 `"1.0.0"`)。两个语义同名容易混淆;真要破坏性变更 AGENT.md 结构时,加 `schemaVersion`(数字)与现有 `version`(字符串)并存。 |
| `messages.jsonl` | append-only 行式格式,没有"文件头"概念;在每行加 version 浪费空间且与流式追加模型冲突。需要变更行 schema 时,用 `Message` 类型自身的 discriminated union 字段(已有的 `role` / `type` 等)走分支兼容。 |
| `p_/auth.json` (legacy) | 老 V3 schema(`LegacyAuthFile.version: string`),已冻结只读,无活代码再写。 |
| `p_/skills/{name}/SKILL.md` | 纯 markdown body,没有结构化 schema(本仓库不解析其内容)。 |
| `~/.deskmate/app.json` | 不在 `profiles/` 树内,不属于本模块。如果未来纳入,沿用同一 `version: 1` 约定。 |

### 写入路径范式(参考 `Mcp.toFile`)

约定:每个 store 在自己文件顶部声明 `const X_FILE_VERSION = 1 as const;`,在 `toFile()` / `doPersist()` 直接拼到字面量里。**不**把 version 作为类实例字段——避免 partialAssign 之类的浅拷贝把 version 同步到内存,污染领域字段。

### 不做存量老数据兼容

本约定**仅对新写入的文件生效**:从引入 `version` 字段那次提交起,所有写路径都会带 version 落盘。**对此之前已经存在的老文件不做任何兼容处理** —— 不在 `load()` 里做"version 缺失则视作 v1"的兜底,不写 v0→v1 的迁移代码。

理由:单用户 / 早期项目,老文件的"重新被写一次"会在自然使用中很快发生(任何 mutate 都会触发 `toFile()` 把 version 补齐);为短窗口的过渡态写专门的 migrate 框架不划算。如果某个文件读到了不带 version 的老结构,运行时表现就是"该字段在内存对象里 undefined",目前所有 store 都不读 `.version`,所以没有副作用。

### 未来:第一次破坏性变更触发的 migrate 框架

**当前未实现**(YAGNI):没有 schema 跳过版本号,所以不需要 migrate 框架。当第一个文件升级到 `version: 2` 时,在对应 store 的 `load()` 内部按 version 分支即可:

```ts
public async load() {
  const file = await readJsonOrNull<XxxFileV1 | XxxFileV2>(...);
  if (!file) return;
  if (file.version === 2) { /* v2 读法 */ }
  else                    { /* v1 读法 */ }
}
```

集中迁移工具(类似 `migrations/v1-to-v2.ts`)只在跨文件级、需要协同回写多个 store 时才考虑;到时再补。

---

## 14. Related Files

| File | Relationship |
|---|---|
| [src/main/persist/ai.prompt.md](../src/main/persist/ai.prompt.md) | store 层 class 关系、常见修改场景、完整 26 条 Gotchas |
| [`src/shared/persist/types/index.ts`](../src/shared/persist/types/index.ts) | 本地磁盘 schema 的唯一入口；同目录按资源域拆分定义 |
| [src/shared/persist/path.ts](../src/shared/persist/path.ts) | 持久化路径布局常量 |
| [src/shared/persist/id.ts](../src/shared/persist/id.ts) | ULID + 类型前缀 |
| [src/shared/persist/markdown.ts](../src/shared/persist/markdown.ts) | AGENT.md front-matter 解析 / 序列化 |
| [src/shared/ipc/persist.ts](../src/shared/ipc/persist.ts) | IPC 通道契约(types only) |
| [src/main/persist/lib/db/schema.ts](../src/main/persist/lib/db/schema.ts) | SQLite DDL 单 source of truth |
| [ai.prompt/arch-main.md](arch-main.md) | 主进程模块表(已索引本模块) |
| [ai.prompt/data-flow.md](data-flow.md) | IPC 通道清单 + atom 一览(与 §6 对齐) |
| [ai.prompt/arch-render.md](arch-render.md) | renderer 状态层架构;persist 域 atom 命名/放置规则 |
