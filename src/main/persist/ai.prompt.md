<!-- Last verified: 2026-07-22 (session directory ZIP import/export) -->

# Persist 模块（新布局 store 层）

> `~/.deskmate/profiles/p_{ulid}/` 新布局的所有读写入口，以及 `/settings/persist` 对跨 Profile `~/.deskmate/env/` 的只读存储统计。高层架构 / IPC 协议 / Hot-Cold 视图 / SQLite 索引设计见 [ai.prompt/persist.md](../../../ai.prompt/persist.md)；本文件聚焦 store 层 class 关系、Common Changes 入口、完整 Gotchas。

## Key Files

| File | Responsibility | Size |
|------|---------------|------|
| `index.ts` | 门面：统一对外 export | small |
| `profileStore.ts` | 单 profile 持久化聚合：内嵌 `ProfileSettings`（settings.json）+ `AgentRegistry`（agents.json：items + primaryAgentId）两个 PersistBase inner class；外层 `ProfileStore` 负责 agent 实体集合（Map<id, Agent>）、CRUD、archive/restore、reconcile、跨 agent 聚合，以及 `resolveDelegates(parentId)` 按父配置 join active hot registry | large |
| `agent.ts` | `Agent` class：AGENT.md 读写 + sessions/jobs 子域入口；description/delegates 由既有 config/patch 往返，不建立独立 normalizer | large |
| `session.ts` | `Session`(抽象基类:`messages.jsonl` I/O + files sandbox + 节流 persist + 元数据 mutate)及 `RegularSession` / `JobRun`；还拥有 `createSubrun/getSubrun/listSubruns`，只以当前 parent session 限定三位 subrun ID | large |
| `sessionArchive.ts` | 会话目录 ZIP：将完整 regular/job-run 目录连同 `info.json` 打包；导入时安全解压 regular archive、校验 metadata，并只重写 `data.json` 的新 owner / ID 后直接迁移完整目录、同步索引与事件 | medium |
| `subrun.ts` | `Subrun`：parent `subruns/001..999/` 的 data/message store；per-parent allocation lock、directory reservation、v1 execution history、明确运行 getter 与 `PersistSessionLike` 最小实现；不创建旧 data-file snapshot，不进 SQLite、普通 Session emit 或 files sandbox | large |
| `schedule.ts` | `ScheduleJob` + `ScheduleRegistry`:once/cron job + run 状态机;Step 9 起 run 路径走 `jobRunIdx` | medium |
| `archive.ts` | agent 软删/恢复/purge/gc | small |
| `mcp.ts` / `skills.ts` / `models.ts` | profile 级共享注册表 CRUD | small |
| `knowledge.ts` | agent knowledge/ 目录生命周期 | tiny |
| `auth.ts` | `LegacyAuth` / `PiAuth`：auth.json / auth.pi.json | small |
| `ipc.ts` | `querySession` / `queryJobRun` 沿 sender-owned Profile → agent → session / job run 统一解析，并由 persist IPC 复用；`registerPersistIpc()` 注册 handlers | small |
| `storageOverview.ts` | 「本地数据透明」聚合器：Profile 视图以 agent 为组（`AgentStorageGroup`：会话/定时/知识/config 四子项，config 用减法兜底守恒）+ profile 级共享分类（`StorageCategory`）；另以**单遍**递归按 `env/` 顶层目录分组为 `RuntimeStorageOverview`，避免为 Bun/Python 包树重复扫描。`resolveRevealTarget` 只放行当前 Profile、app root 或受控 `env/` 子树。`/settings/persist` 页数据源 | medium |
| `lib/atomic.ts` | tmp→rename 原子写 + 增量 helpers | small |
| `lib/emit.ts` | `emit(profileId, channel, payload)` —— persist → renderer 广播入口；显式 profile identity 只用于选取 owning runtime `Profile.mainWindow`，wire payload 不重复携带它；没有 owner window 时 no-op | tiny |
| `lib/root.ts` | `getAppRoot()` + `setRootForTesting()` | tiny |
| `lib/db/db.ts` | `ProfileDb`：profile 级 SQLite 连接管理 + integrity_check + WAL（Step 9 新增） | small |
| `lib/db/schema.ts` | `PERSIST_DB_DDL` 单 source of truth（`regular_sessions` + `job_runs` 两表 + `_meta`，Step 9 新增） | small |
| `lib/db/sessionIdx.ts` | `SessionIdx`：`regular_sessions` 表读写 + 偏序索引访问；`ProfileStore.sessionIdx` 持有（兼老 `Starred` 入口：starred 真值是本表 `starred_at` 列） | medium |
| `lib/db/jobRunIdx.ts` | `JobRunIdx`：`job_runs` 表读写 + listAgentRuns / listJobRuns / countUnread / removeByJob | medium |
| `__tests__/*.test.ts` | 单测覆盖 bootstrap/auth/agent/session/schedule/reconcile/rebuild/sqlite | medium |

## Architecture

### 组合关系（**严格遵守**）
```
ProfileRegistry.require(profileId).store → ProfileStore
  .getAgent(id)                        → Agent
    .getSession(id)                    → RegularSession
    .getJob(id)                        → ScheduleJob
      .getRun(id)                      → JobRun
```

### Runtime registry 与持久化 store
- `ProfileRegistry` 是 app-scoped 闭包对象：模块加载时由 `create()` 生成并导出为 const；闭包私有持有 `profiles.json` index、runtime Profile / loading Map，负责 index bootstrap、串行 entry CRUD / auth 更新、并发 load 去重、按 ID 查询、remove 前 dispose、完整删除 profile 数据目录与进程退出 shutdown。同一 Profile 的 remove 会合并为单一 in-flight operation；受控 UI 删除还要求目标不是 sender 当前 Profile、没有 owner window、且不是最后一个，并在删除期间阻止 `getOrLoad` / `require`。index mutation 均在原子写盘成功后提交内存，`items` / `list()` / `getEntry()` 返回副本；它不提供 ambient selected accessor。
- `Profile` 持有一个 `ProfileStore`、runtime-only Pi Agent map、懒建的 SubAgentManager、MCPClientManager 与构造时绑定同一 store 的 SchedulerManager。Pi / MCP / scheduler 运行态都经 Profile 创建、查找和关闭；`dispose()` 先停止 scheduler、再停止 Pi session、清理 MCP clients，最后关闭 store。`ProfileStore` 不再持有跨 profile static cache。

### 派生数据 vs 源真值
- 源真值：每个资源自己的文件（`AGENT.md` / `data.json` / `messages.jsonl` / `job.json` / `jobs.json` items 顺序 / `agents.json` items 顺序）
- 派生缓存：`agents.json#items` 行（与 AGENT.md 同步）/ `profiles/{p}/index.db` 内 `regular_sessions` + `job_runs` 两张表（Step 9 起；老 `sessions/index.json` 与 `starred-sessions.json` 已删）
- **任何修改源真值的写路径必须同步重写索引**（写顺序见 [ai.prompt/persist.md §2 不变量 #4](../../../ai.prompt/persist.md)）。DB 损坏可由 `SessionIdx.rebuildFromDisk()` + `JobRunIdx.rebuildFromDisk()` 从所有 `data.json` 完全恢复

### Bootstrap 顺序（详见 [ai.prompt/persist.md §5](../../../ai.prompt/persist.md)）
`ProfileRegistry.bootstrap()` 自己加载 `profiles.json` index，再并行 `getOrLoad()` 所有 entry 并启动 runtime Profile；每个 `Profile.start()` 都启动自己的 scheduler。ProfileStore 在 load 时完成持久化子域与 SQLite 自愈；**首次创建 profile 目录时**还会落盘 `DEFAULT_AGENT_PERSONA`（Otto）并写为 `primaryAgentId`，保证新窗口有可用聊天入口。

### Session 物理位置
`Session` 是抽象基类(messages.jsonl I/O + files sandbox + 节流 persist + 元数据 mutate)，路径树由子类各自实现：
- `RegularSession` → `agents/{a}/sessions/{ym}/{s}/`
- `JobRun` → `agents/{a}/schedules/{j}/runs/{ym}/{s}/`

两种 parent session 的 `subruns/` 子目录都由 `Session.createSubrun` 统一拥有；每个合法 `001..999` 目录只含 `data.json` 与 `messages.jsonl`。`Subrun` 不继承 `Session`，不创建 files、不写 `regular_sessions` / `job_runs`、不 emit 普通 session channel；它直接实现 Pi 的最小 `PersistSessionLike`。磁盘 `PersistSubrunDataFile` 不重复 profile、父 Agent/session ID；owner identity、initial request、当前 execution/status/timestamps/result 通过明确 getter 暴露，不再组装 `SubrunDataFile` 镜像。

`Subrun` 是可继续的 delegated conversation：initial execution 为 `pending → running → terminal`；terminal 的 `continueConversation()` 直接追加一项 running continuation，不分配新三位 ID。每项 history 对应一次 execution，状态变化替换最后一项；terminal persisted result 不重复 status、subrunId、delegateAgentId，`Subrun.result` 按需补回。

两类 session 永不混走同一容器：`Agent.sessions: Map<id, RegularSession>`，`ScheduleJob.runs: Map<id, JobRun>`。子类间没有共同的 placement getter；要分支判断，用 `instanceof`。

### Session ZIP 导入导出
`sessionArchive.ts` 是唯一的归档格式实现。ZIP 的单一根目录名等于源 session ID，内部保留原始 `data.json` / `messages.jsonl` / `files/` / `subruns/`，另注入 `info.json`（version、源 session identity 与月份）。导出前强制 flush 当前 session，避免漏掉内存尾部消息；不重建 JSON 或重新编码消息。输出通过 JSZip Node stream 直接写盘，绝不聚合完整 archive buffer；最大压缩包为 1 GiB，超限会删除部分输出。

导入只接受 `info.json#session.kind === 'regular'` 的 ZIP，`importSessionArchive` 是唯一入口：它用 `node-stream-zip` 流式解压到临时目录，只改写 `data.json` 的新 session ID 与目标 agent ID，通过一次 `rename` 迁移完整目录，再直接 upsert SQLite / emit renderer 事件。导入上限：压缩包 / 单条目各 1 GiB、最多 1,000 条目、总解压 2 GiB；`info.json` 与 `data.json` 各限 1 MiB，防止不可信 ZIP 耗尽主进程内存或临时盘。`info.json` 只用于归档校验，不写入持久化 session 目录；schedule run 仍可导出，但因缺少目标 job 归属不可从 Agent 菜单导入。

`JobRun.forkToSession(sessionIdx)` 是 schedule run 唯一的继续对话入口：只接受 completed / failed run，clone `messages.jsonl` 与 `files/`（`COPYFILE_FICLONE`），保留 `contextState` / overrides，生成新的 regular id、重置 `turn` / star / read 状态，并让 `RegularSession.afterPersist` 负责 `regular_sessions` + renderer 事件。IPC `forkJobRunToSession` 仅沿 ownership chain 解析目标 run 并委派给该方法。原 run 永远保留在 `job_runs` 作为调度历史；不得原地改 `kind` 或复用 run id。

取 session 走 PK 查 SQLite index（Step 9）：
- `Agent.getSession(id)` → `sessionIdx.findById(id) → RegularSession.load(... row.month ...)`（**只**查 `regular_sessions`）
- `ScheduleJob.getRun(id)` → `jobRunIdx.findById(id) → JobRun.load(... row.month, jobId)`（**只**查 `job_runs`）
- `Agent.findSessionAcrossKinds(id): Promise<Session | undefined>` —— **唯一的合法跨形态查询入口**。先 `getSession` 命中 → RegularSession;否则 `jobRunIdx.findById` → `getJob(jobId).getRun(id)` → JobRun。返回基类 `Session`,调用方只摸 `filesDir()` / `messagesFile()` 这类共同接口。

两类入口的取舍:
- 业务调用方如果**已经从上下文知道 kind**(URL 路由 `/agent/:agentId/:sessionId` vs `/agent/:agentId/job/:jobId/:sessionId`、IPC 入参 `agentIpc.markSessionRead` vs `markJobRunRead` 等),走 `getSession` / `getRun` 各自的入口 —— 类型层把 kind 钉死,下游不必判断。
- **只有当调用方天然不区分 kind** 时才用 `findSessionAcrossKinds`。当前合法用例:
  - `LocalProtocolHandler` —— 解析 `local://` 时直接用 `ResolveContext.agentId` 取得 parent Agent，再用 `sessionId` 调本方法；delegateId 不参与 session 定位。
  - `getSessionFilesDir` IPC —— renderer `WorkspaceExplorer` 在 job-run 与 regular 路由下都展示 session-files 区段,需要同一查询路径。
- 反例:不要用它做"全局按 sessionId 找 session"的兜底。仍然要从上下文区分 kind 时,坚持各自入口。

老 fan-out 扫月份目录路径已删。

### Schedule run 状态机
- `JobRunState`（挂 jobs.json）：`pending → running → (completed|failed)`
- `ScheduleRunMeta`（挂 schedule_run session.data）：`running → (completed|failed)`
- `runState` 是 jobs.json 索引的 source of truth；`Agent.getJob` 加载后会从 registry merge `runState` 回 job 实例（避免 job.json 单独 reload 后状态丢失）。`job_runs` 行字段 `runStatus / startedAt / finishedAt / runError` 与 `ScheduleRunMeta` 同步，由 `JobRun.toJobRunRow()` 平铺投影

## Common Changes

| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| 加新 profile 级共享资源（如 prompts/） | `path.ts` 加路径常量 + 新 store class + `ProfileStore` 字段 + `ProfileRegistry.bootstrap` 装载步骤 | 仿 `mcp.ts` |
| 加 AGENT.md 字段 | `types/agent.ts`（经 `types/index.ts` 导出）+ `agent.ts` `AgentConfig.assign/toFrontMatter` 处理 + markdown 测试 | front-matter 字段是否需要在 record 同步、加载时如何回填要先判定 |
| 加 regular session 索引字段 | `types/session.ts` 的 `RegularSessionRow`（经 `types/index.ts` 导出）+ `lib/db/schema.ts` DDL 加列 + `lib/db/sessionIdx.ts` marshal/unmarshal + `RegularSession.toRegularRow` 同步 + `SessionIdx.rebuildFromDisk` 投影 | source of truth 是 data.json 中对应字段，先保证那边有 |
| 加 job_run 索引字段 | 同上但走 `JobRunRow` / `JobRun.toJobRunRow` / `JobRunIdx` 路径 | schedule_run 表与 regular 表物理分开，互不影响 |
| 将 schedule run 继续为 regular session | `session.ts#JobRun.forkToSession` + `RegularSession` data 投影；clone messages/files 后才写 regular `data.json`，最后由 afterPersist 同步 SQL / 事件 | 只接受 terminal run；原 run 不删、不改 |
| 改会话 ZIP 格式或导入规则 | `sessionArchive.ts` + `__tests__/sessionArchive.test.ts`；UI/IPC 入口还包括 `startup/ipc/{chat-session,agent-chat}.ts` | ZIP 必须保留完整目录；只能修改跨 agent 导入必需的 `data.json#id/agentId`，其余内容原样迁移 |
| 加 SQLite 偏序索引 | `lib/db/schema.ts` `CREATE INDEX IF NOT EXISTS ix_xxx ON ... WHERE ...;` + 测试 `EXPLAIN QUERY PLAN` 验命中 | 候选索引清单见 [ai.prompt/persist.md §9.2](../../../ai.prompt/persist.md) |
| 加 IPC 通道 | `src/shared/ipc/persist.ts` 加 channel + `ipc.ts` 加 handler + `preload/invoke/persist.ts` 加 allowlist | renderer 调用走 `persistApi.xxx()` 自动类型推导 |
| 加应用级运行时存储分类 | `shared/ipc/persist.ts` 的 `RuntimeStorageCategory` + `storageOverview.ts` 的顶层目录映射 + renderer `storageMeta.ts`；保持 `StorageOverview.totalBytes` 只代表 Profile，运行时统计必须独立 IPC，不能挂进 `shared` |
| 加 SQLite 单元测试 | `__tests__/sqlite-index.test.ts` 仿 PR-1 模板（tmp 真盘 + ProfileDb.resetForTesting） | better-sqlite3 是 native，无法在 mock fs 跑 |
| 加 mock fs 集成测试 | 仿 `agent.test.ts` 顶部 `vi.mock('../lib/db/db', () => ({ ProfileDb: { open: () => fakeDb, ... } }))` stub | fakeDb 提供 `db.prepare/get/all/run` no-op；不直接断言 SQL 行 |
| 修改 Profile 名称 / 删除 Profile | `profileRegistry.ts` + `shared/ipc/profiles.ts` + `startup/ipc/profiles.ts` + Profile manager UI | 删除仅走 `removeClosed(id, senderOwnerId)`；先由 main 重新检查 current/open/last，再停止 runtime 并删 index/目录 |

## Gotchas

- ⚠️ `name` 不是主键。`agents.json` 允许重名；所有引用走 `a_{ulid}` id。重命名 agent 时 id 不变；skills 沿用 name 作 id。
- ⚠️ Agent 委派关系只存普通 Agent ID，patch 原样落盘。授权与 prompt 必须调用 `ProfileStore.resolveDelegates(parentId)`，不得按 name 查找或绕过 resolver；resolver 只读父 AGENT.md，再 join active `AgentRecord`，解析时 trim/去空/稳定去重，self/dangling/archived 进入 unavailable。parent record/AGENT.md 缺失通过返回 `null` 显式表达，不抛业务异常。
- ⚠️ Subrun 的三位 ID 只在 parent Session 下有意义。`Session.createSubrun/getSubrun/listSubruns` 是唯一 owner API；allocator 以 parent `subruns/` path 锁串行扫描、原子 mkdir reservation 与初始 data 写入。空 reservation 返回 `incomplete`，不复用；`999` 返回 `exhausted`。`data.json` 按当前 writer 生成的 v1 schema 直接读取，不提供旧形态迁移或结构校验；切换 schema 时由开发环境清理旧数据。
- ⚠️ Session 删除必须按形态走 owner：`Agent.deleteSession(id)` 只删 RegularSession；`ScheduleJob.deleteRun(id)` 只删已结束的单条 JobRun（running 会拒绝，避免与执行写盘竞态）；`Agent.deleteJob(id)` 才整 job 级联删除。它们分别同步源目录、SQLite 行并 emit 对应 remove 事件。**不要**直接 `session.deleteFromDisk()`。
- ⚠️ Agent 软删的 store 原语是 `ProfileStore.archiveAgent(id)`：写顺序是 archive move dir → agents.json 剔除（含 `primaryAgentId` 命中清空）。生产运行时入口必须走 `Profile.archiveAgent(id)`，它先停止并移除同 ID 的 Pi Agent，避免 archive 后残留内存 session。若中途崩溃，下次启动 `reconcileAgents()` 会发现 items 指向不存在的目录并自愈。
- ⚠️ `knowledge/` 是每个 agent 的基础目录：`ProfileStore.createAgent` 在将 record 发布到 `agents.json` 前创建它；`duplicateAgent` 复制源目录，旧 source 缺目录时创建空目录；`Agent.load` 会为已登记的旧 agent 懒创建目录。渲染器文件树会校验物理目录存在，不能把空知识库当作缺失目录。
- ⚠️ 新 profile 的默认 Otto 只在 `ProfileStore.load()` 发现 profile 目录尚不存在时创建，并立即设为 primary。**不得**把“当前 agent list 为空”当成补种条件：已有 Profile 可能是用户主动归档完所有 Agent 后的合法状态，自动复活默认 Agent 会篡改用户意图。
- ⚠️ Profile 删除的 UI 禁用仅是提示，不是授权。`ProfileRegistry.removeClosed` 必须在删除开始时重新检查 target 的 owner window、current owner 与剩余数量；目标进入 removing 后 `getOrLoad` / `require` 必须拒绝，避免关闭窗口与删除并发时重新创建 runtime。
- ⚠️ `markdown.ts` 允许 `model: ''`（空字符串），便于刚 create 的 agent 立刻 round-trip。**不要**收紧成非空校验，否则会破坏 reconcile / restore 流程。
- ⚠️ 测试 mock fs 时 helper 不能单放 `_*.ts` —— vitest 的 include 模式 `__tests__/**/*.ts` 全扫；要么内嵌进 test 文件，要么改后缀。`session-schedule.test.ts` 整文件改走 tmp 真盘（Step 9）—— `better-sqlite3` 是 native，无法被 `vi.mock('node:fs')` 拦截。
- ⚠️ `Agent.createSession({ id?, title?, overrides?, contextState? })` 可接收外部 `id`。供 `pi.Agent.getOrCreateSession` 的 lazy create 路径使用：renderer 在 "New Chat" 按钮按下时本地 `newEntityId('s')` 生成 id 并 navigate，但**直到首次 streamMessage 走 pi 才真正落盘**，避免空壳 session。不传 id 走默认 ULID 生成，保持向后兼容。
- ⚠️ `handle.getSnapshot` 内有 **inflight 合并**：同 tick 多窗口 / 多 atom 的并发 invoke 共享一个 Promise，结束即释放。改 handler 时不要清掉这层 —— 它是 renderer 端 7 atom fan-out 的 main 端兜底；renderer 那侧在 [_snapshot.ts](../../renderer/states/_snapshot.ts) 自带 cache+inflight。两层都不缓存写路径数据，结束就 reset。
- ⚠️ **session 写路径 emit 契约**：每个子类在 `afterPersist()` 内自己做"upsert SQLite + emit 广播"两件事——基类不知道 SQLite / 广播 channel 存在。`RegularSession.afterPersist`：`sessionIdx.upsert(toRegularRow())` + emit `session:updated`。`JobRun.afterPersist`：`jobRunIdx.upsert(toJobRunRow())` + emit `schedule:run:updated`。删除单条 run 由 `ScheduleJob.deleteRun` 在源目录和 SQLite 行移除后 emit `schedule:run:removed`。idx 句柄（`SessionIdx` / `JobRunIdx`）由子类构造时注入；`Agent.bindSessionOnChange` / `ScheduleJob.bindRunOnChange` 入口已删——再没有 `Session.onChange` 这个机制。`session:index:updated` 由 `SessionIdx.upsert / remove` 自己发，**payload 是单条 op**（`{op:'upsert', entry}` / `{op:'remove', id}`），renderer atom 按 id 合并。
- ⚠️ **DB 自愈/初次填充**：`ProfileStore.load` 拿到 `ProfileDb.open(id)` 后看 `wasCreated`（升级 / migrate / 拷贝 profile 目录的场景，新建空表）或 `checkIntegrity() === false`（DB 损坏 → `close` + `unlinkProfileDb` + 重 open），两条路径都会跑 `SessionIdx.rebuildFromDisk()` + `JobRunIdx.rebuildFromDisk()` 把 DB 与盘上 data.json 拉齐。`SessionIdx` / `JobRunIdx` 不持有 `ProfileDb` 引用而是每次按 `profileId` lookup，所以重建后旧引用不会悬空。
- ⚠️ **Starred 入口（Step 9）**：starred 真值是 `regular_sessions.starred_at` 列，与 row 同生共死。`setSessionStarred` IPC handler 走 `RegularSession.setStar(star)` 写 data.json → afterPersist 同步本列（**不刷 updatedAt**，与 `setReadStatus` 同语义）+ 在被删 session 之前确实 star 过 / 标记动作完成时补一次 `starred:updated`。**没有** `SessionIdx.setStarred` 入口 —— Step 9 设计稿写过但实施时被 `RegularSession.setStar` 路径替代。
- ⚠️ **进程退出 flush**：`main.ts onBeforeQuit` 在 logger close 之前调 `ProfileRegistry.shutdownAll()`（5s 超时），按 runtime Profile 所有权链完成 scheduler、Pi、MCP、persist 和 SQLite 关闭。绝不 fire-and-forget，否则会丢最后一批 `messages.jsonl` 行。

## Step4 PR1 新增能力（2026-06-04）

为 step4 PR2/3/4 切换 `profileCacheManager` / `chatSessionStore` 调用方做铺垫，加了以下 API。**调用方迁移前**先看这一节。

| API | 文件 | 用途 |
|---|---|---|
| `ProfileRegistry.bootstrap()` 幂等 | `profileRegistry.ts` | 多入口（main / lazy / evalMode）可重复调；二次调用 no-op |
| `ProfileRegistry.defaultProfileId` | `profileRegistry.ts` | bootstrap 后只读的启动 / 无显式目标新窗口候选；不代表既有窗口或 runtime Profile |
| `ProfileStore.patchSettings(partial)` | `profileStore.ts` | 细粒度更新 confirmation 等子域，未传字段不动 |
| `ProfileStore.duplicateAgent(srcId, newName)` | `profileStore.ts` | 复制 agent：front-matter + systemPrompt + knowledge 目录；sessions/schedules 不拷 |
| `ProfileStore.resolveDelegates(parentId)` | `profileStore.ts` | 返回 `ResolvedAgentDelegates | null`；parent 缺失返回 null；保持配置顺序，self/归档/不存在目标进入 unavailable；只按需读取父 Agent detail |
| `Agent.toRecord()` / `Agent.toDetail()` | `agent.ts` | 两层视图：record 是 hot list 字段（同步 `agents.json#items`），detail 是 cold 字段（systemPrompt + mcp + skills + ...）。`Agent.patchFront` 内部自动写两边；renderer 按 hook 取 record，按 lazy fetch 取 detail。**`toView()` 已删**（Step 5）—— 不要恢复 |
| `Session.tailMessages(n)` / `sliceMessages(offset, n)` | `session.ts` | 分页加载 messages.jsonl（合并 disk + pending），返回 `{items, hasMore, nextOffset, total}` |

## Step5 PR1 新增能力（2026-06-04）

为 scheduler 整体重设计切 SchedulerManager 做铺垫。**调用方迁移前**先看这一节。

| API | 文件 | 用途 |
|---|---|---|
| `ScheduleJob.applyUpdate(partial)` | `schedule.ts` | 批量字段更新；可切换 cron ↔ once，但 cron / runAt 必须随 kind 一起带齐（缺则抛错）。**不自动 persist**——调用方负责后续 `job.persist()` |
| `ScheduleJob.listRunsOnDisk()` | `schedule.ts` | 列出该 job 的所有历史 run（含 running），按 startedAt 倒序。**Step 9 起底层是 `JobRunIdx.listJobRuns(jobId)` SQL 查询，不再扫盘**；方法名保留是与历史调用方兼容。即使内存 `runs` cache 已 evict 也完整可见 |
| `ProfileStore.listJobsFlat({ agentId? })` | `profileStore.ts` | 跨 agent 聚合 schedule job 列表，每条返回 `{agent, job, entry}`；scheduler 跨 agent 操作（list / handleSystemResume / handleColdStartCatchUp）唯一入口 |
| `ProfileStore.findJob(jobId)` | `profileStore.ts` | 单 jobId 反查 owning agent + job 实例；走 listJobsFlat 线性查找（N 小，无 jobId→agentId 反查表） |
## AgentRecord ↔ AGENT.md 同步契约（2026-06-06）

`AgentRecord`（`agents.json#items` 行）字段 `name / description / version / emoji / avatar / model` **是 `AGENT.md` front-matter 同名字段的派生缓存**。AGENT.md 是源真值；两边偏离时 reconcile 以 AGENT.md 为准。

### 唯一写入口

- `Agent.patchFront(partial)`（async）→ 先写 `AGENT.md`，再回调注入的 `AgentRegistry.syncRecord(this.toRecord())` 同步 record。
- `ProfileStore.createAgent / duplicateAgent` → 新建时直接 `agentRegistry.items.push(agent.toRecord())`，整条写。
- `ProfileStore.archiveAgent / restoreAgent` → 整条删 / 整条加。

**不要绕过这些入口手动改 `this.agentRegistry.items` 或单独写 `AGENT.md`**。否则 record stale，sidebar / chat header 显示旧 name / model 直到下一次 patchFront 触发。

### 为什么不在 bootstrap 做 reconcile

bootstrap 期间如果对所有 agents 做 record ↔ markdown 对账，等于把"启动期不读 AGENT.md"的设计目标推翻。本次重构选了"写路径同步"而不是"读路径 reconcile"。手动入口 `ProfileStore.reconcileRecordFromMarkdown(id?)`（**当前未实现**，按需添加）给 Doctor / migrate 后置脚本用。

### Agent 实例上的 createdAt / updatedAt（2026-06-08）

`AgentRecord` 的 `createdAt / updatedAt` **不在 AGENT.md** 里，只挂 `agents.json`。`Agent.load` 必须从 `registry.items` 反向回填到实例（参见 agent.ts 第 140-143 行），否则后续任何 `patchFront`：

1. 内存 config 改了、AGENT.md 写盘 ✅
2. `doPersist` 的 `emit('agent:updated')` 因 `createdAt === ''` 兜底被吞 ❌
3. `syncRecord(this.toRecord())` 在 `toRecord()` 抛 `Agent.toRecord: createdAt/updatedAt not initialized` ❌

净效果：AGENT.md 是新的，agents.json items 永远 stale，renderer `agents.atom.byId` 拿不到 `agent:updated` 永远显示旧 model（"切了模型 UI 没反应"）。

**新加只挂 record / 只挂 markdown 的字段时**，同样要明确写在哪一边、加载时怎么互填，并加一条"reload + patchFront"的回归测试（参见 `agent.test.ts`）。

### Renderer 端两层 atom

- `agents.atom`（hot） → `AgentRecord`，列表 / sidebar / chat header / model selector / 委派选择用；`description` 在此层，避免候选列表 fan-out 读 AGENT.md
- `agentDetail.atom`（cold，按需懒读） → `AgentDetail`，agent editor / apply-to-dialog / context-menu skill list / outgoing `delegates` 用

main 端 `agent:updated` 事件 payload 同时下推 `{ record, detail }`，避免 renderer 写完 agent 后还要再 invoke 一次 `getAgentDetail`。


## Related

- 高层架构 / IPC 协议 / Hot-Cold 视图 / SQLite 索引设计：[ai.prompt/persist.md](../../../ai.prompt/persist.md)
- IPC 通道契约：[`src/shared/ipc/persist.ts`](../../shared/ipc/persist.ts)
- shared schema：[`src/shared/persist/types/index.ts`](../../shared/persist/types/index.ts)（唯一入口；同目录按资源域拆分）
