<!-- Last verified: 2026-06-15 (Phase 5 Domain Message + PersistedJsonLine + appendDomainMessage/appendToolResponse/rewriteMessages 三招) -->

# Persist 模块（新布局 store 层）

> `~/.deskmate/profiles/p_{ulid}/` 新布局的所有读写入口。高层架构 / IPC 协议 / Hot-Cold 视图 / SQLite 索引设计见 [ai.prompt/persist.md](../../../ai.prompt/persist.md)；本文件聚焦 store 层 class 关系、Common Changes 入口、完整 Gotchas。

## Key Files

| File | Responsibility | Size |
|------|---------------|------|
| `index.ts` | 门面：统一对外 export | small |
| `profiles.ts` | `Profiles` 单例 + `bootstrap()` 10 步 + active 切换 + attach/detach auth | medium |
| `profile.ts` | 单 profile：内嵌 `ProfileSettings`（settings.json）+ `AgentRegistry`（agents.json：items + primaryAgentId）两个 PersistBase inner class；外层 `Profile` 负责 agent 实体集合（Map<id, Agent>）、CRUD、archive/restore、reconcile、跨 agent 聚合 | large |
| `agent.ts` | `Agent` class：AGENT.md 读写 + sessions/jobs 子域入口 | large |
| `session.ts` | `Session`(抽象基类:`messages.jsonl` I/O + files sandbox + 节流 persist + 元数据 mutate)+ `RegularSession` / `JobRun`(各自路径树/索引/索引同步)。消息接口:`appendDomainMessage(m: Message)` 写 user / assistant 行,`appendToolResponse(toolCallId, result)` 写 `tool_res` 行,`rewriteMessages(messages)` 整段重写 jsonl(emit `session:messages:rewritten`),`loadDomainMessages()` 折回 `{ messages, orphanResponses }`。`pendingMessages` 元素类型 `ChatHistoryItem = PersistedJsonLine`(同义 alias)。`flushMessages` 串行化,jsonl 行边界严格 | large |
| `messageWire.ts` | `dehydrate(messages)` / `rehydrate(lines)` 在 Domain `Message[]` 与 `PersistedJsonLine[]` 之间互转。`PersistedJsonLine` 三种行(user / assistant / `tool_res`)的类型定义在 `shared/persist/types.ts`(跨进程共享) | small |
| `schedule.ts` | `ScheduleJob` + `ScheduleRegistry`:once/cron job + run 状态机;Step 9 起 run 路径走 `jobRunIdx` | medium |
| `archive.ts` | agent 软删/恢复/purge/gc | small |
| `mcp.ts` / `skills.ts` / `subAgents.ts` / `models.ts` | 共享注册表 CRUD | small |
| `knowledge.ts` | agent knowledge/ 目录生命周期 | tiny |
| `auth.ts` | `LegacyAuth` / `PiAuth`：auth.json / auth.pi.json | small |
| `ipc.ts` | `registerPersistIpc()` —— dry-run handler，**未接入 startup pipeline** | small |
| `lib/atomic.ts` | tmp→rename 原子写 + 增量 helpers | small |
| `lib/emit.ts` | `emit()` —— persist → renderer 广播入口（mainWindow 不存在时 no-op） | tiny |
| `lib/root.ts` | `getAppRoot()` + `setRootForTesting()` | tiny |
| `lib/db/db.ts` | `ProfileDb`：profile 级 SQLite 连接管理 + integrity_check + WAL（Step 9 新增） | small |
| `lib/db/schema.ts` | `PERSIST_DB_DDL` 单 source of truth（`regular_sessions` + `job_runs` 两表 + `_meta`，Step 9 新增） | small |
| `lib/db/sessionIdx.ts` | `SessionIdx`：`regular_sessions` 表读写 + 偏序索引访问；`Profile.sessionIdx` 持有（兼老 `Starred` 入口：starred 真值是本表 `starred_at` 列） | medium |
| `lib/db/jobRunIdx.ts` | `JobRunIdx`：`job_runs` 表读写 + listAgentRuns / listJobRuns / countUnread / removeByJob | medium |
| `__tests__/*.test.ts` | 单测覆盖 bootstrap/auth/agent/session/schedule/reconcile/rebuild/sqlite | medium |

## Architecture

### 组合关系（**严格遵守**）
```
Profiles.get().active()          → Profile
  .getAgent(id)                  → Agent
    .getSession(id)              → RegularSession
    .getJob(id)                  → ScheduleJob
      .getRun(id)                → JobRun
```
- 不写平铺裸 id：`persistence.sessions.append(profileId, agentId, sessionId, item)` ❌
- 必须链式取到 `RegularSession` / `JobRun` 后再调消息接口:`appendDomainMessage(m)` / `appendToolResponse(id, result)` / `rewriteMessages(messages)` ✅

### 单实例 + 懒加载
- `Profiles` 是 `static instance`；每层子实体由其父 store 缓存 Map (`Profile.agents`, `Agent.sessions`, `Agent.jobs`)
- 永不在多处实例化同一资源；`Profile.evict(id)` 为测试与 reset 流程使用

### 派生数据 vs 源真值
- 源真值：每个资源自己的文件（`AGENT.md` / `data.json` / `messages.jsonl` / `job.json` / `jobs.json` items 顺序 / `agents.json` items 顺序）
- 派生缓存：`agents.json#items` 行（与 AGENT.md 同步）/ `profiles/{p}/index.db` 内 `regular_sessions` + `job_runs` 两张表（Step 9 起；老 `sessions/index.json` 与 `starred-sessions.json` 已删）
- **任何修改源真值的写路径必须同步重写索引**（写顺序见 [ai.prompt/persist.md §2 不变量 #4](../../../ai.prompt/persist.md)）。DB 损坏可由 `SessionIdx.rebuildFromDisk()` + `JobRunIdx.rebuildFromDisk()` 从所有 `data.json` 完全恢复

### Bootstrap 顺序（详见 [ai.prompt/persist.md §5](../../../ai.prompt/persist.md)）
`Profiles.get().bootstrap()` 跑：profilesIndex ensure → resolveActive → load mcp/skills/subAgents/models → `ProfileDb.open` + 决定是否 rebuild（**wasCreated=true** 即升级 / migrate / 拷贝 profile 目录的场景，盘上可能已有 sessions 但 DB 是空表 → 自动 `rebuildFromDisk` 两表；否则 integrity_check 失败时走删盘 → 重 open → rebuild）→ `reconcileAgents`（agents.json items ↔ agents/ 目录双向对账，缺目录的 item 剔除并清空 primaryAgentId 命中）。每步异常都汇集到 `warnings`，不让单步失败拖累整体启动。**幂等**：重复调用直接 no-op 返回（用 `bootstrapped` flag）。

### 同步 vs 异步访问 active profile
- `Profiles.get().active(): Promise<Profile>` —— 常规路径，bootstrap 后从 cache 直接返。
- `Profiles.get().activeSync(): Profile` —— 仅供登录关键路径上的 sync getter 用（如 skill / subAgent 等同步 lookup）。bootstrap 未完成时直接抛错，防止误吞 null。`switch()` 后 cache 自动更新。

### Session 物理位置
`Session` 是抽象基类（messages.jsonl I/O + files sandbox + 节流 persist + 元数据 mutate），路径树由子类各自实现：
- `RegularSession` → `agents/{a}/sessions/{ym}/{s}/`
- `JobRun` → `agents/{a}/schedules/{j}/runs/{ym}/{s}/`

两类 session 永不混走同一容器：`Agent.sessions: Map<id, RegularSession>`，`ScheduleJob.runs: Map<id, JobRun>`。子类间没有共同的 placement getter；要分支判断，用 `instanceof`。

取 session 走 PK 查 SQLite index（Step 9）：
- `Agent.getSession(id)` → `sessionIdx.findById(id) → RegularSession.load(... row.month ...)`（**只**查 `regular_sessions`）
- `ScheduleJob.getRun(id)` → `jobRunIdx.findById(id) → JobRun.load(... row.month, jobId)`（**只**查 `job_runs`）
- `Agent.findSessionAcrossKinds(id): Promise<Session | undefined>` —— **唯一的合法跨形态查询入口**。先 `getSession` 命中 → RegularSession;否则 `jobRunIdx.findById` → `getJob(jobId).getRun(id)` → JobRun。返回基类 `Session`,调用方只摸 `filesDir()` / `messagesFile()` 这类共同接口。

两类入口的取舍:
- 业务调用方如果**已经从上下文知道 kind**(URL 路由 `/agent/:agentId/:sessionId` vs `/agent/:agentId/job/:jobId/:sessionId`、IPC 入参 `agentIpc.markSessionRead` vs `markJobRunRead` 等),走 `getSession` / `getRun` 各自的入口 —— 类型层把 kind 钉死,下游不必判断。
- **只有当调用方天然不区分 kind** 时才用 `findSessionAcrossKinds`。当前合法用例:
  - `LocalProtocolHandler` —— 解析 `local://` URI 时,`ResolveContext.sessionId` 来自 `ToolContext.sessionId`,而 `JobRun.handleToolCalls` / `RegularSession.handleToolCalls` 注入同字段,handler 不该按 caller kind 分裂。
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
| 加新 profile 级共享资源（如 prompts/） | `path.ts` 加路径常量 + 新 store class + Profile 字段 + Profiles.bootstrap 装载步骤 | 仿 `mcp.ts` |
| 加 AGENT.md 字段 | `types.ts` 加字段 + `agent.ts` `AgentConfig.assign/toFrontMatter` 处理 + markdown 测试 | front-matter 字段是否需要在 record 同步、加载时如何回填要先判定 |
| 加 regular session 索引字段 | `types.ts` `RegularSessionRow` + `lib/db/schema.ts` DDL 加列 + `lib/db/sessionIdx.ts` marshal/unmarshal + `RegularSession.toRegularRow` 同步 + `SessionIdx.rebuildFromDisk` 投影 | source of truth 是 data.json 中对应字段，先保证那边有 |
| 加 job_run 索引字段 | 同上但走 `JobRunRow` / `JobRun.toJobRunRow` / `JobRunIdx` 路径 | schedule_run 表与 regular 表物理分开，互不影响 |
| 加 SQLite 偏序索引 | `lib/db/schema.ts` `CREATE INDEX IF NOT EXISTS ix_xxx ON ... WHERE ...;` + 测试 `EXPLAIN QUERY PLAN` 验命中 | 候选索引清单见 [ai.prompt/persist.md §9.2](../../../ai.prompt/persist.md) |
| 加 IPC 通道 | `src/shared/ipc/persist.ts` 加 channel + `ipc.ts` 加 handler + `preload/persist/invoke.ts` 加 allowlist | renderer 调用走 `persistApi.xxx()` 自动类型推导 |
| 加 SQLite 单元测试 | `__tests__/sqlite-index.test.ts` 仿 PR-1 模板（tmp 真盘 + ProfileDb.resetForTesting） | better-sqlite3 是 native，无法在 mock fs 跑 |
| 加 mock fs 集成测试 | 仿 `agent.test.ts` 顶部 `vi.mock('../lib/db/db', () => ({ ProfileDb: { open: () => fakeDb, ... } }))` stub | fakeDb 提供 `db.prepare/get/all/run` no-op；不直接断言 SQL 行 |

## Gotchas

- ⚠️ `name` 不是主键。`agents.json` 允许重名；所有引用走 `a_{ulid}` id。重命名 agent 时 id 不变。**例外**：sub_agents / skills 沿用 name 作 id（Claude Code 兼容性）。
- ⚠️ messages.jsonl 是 append-only。常态走 `Session.appendDomainMessage(m)` / `appendToolResponse(id, result)` 进 buffer,`flushMessages` 才落盘;`Session.persist()` 内部会同时 flush。**整段覆盖**走 `rewriteMessages(messages)`(edit / retry / 导入路径,emit `session:messages:rewritten`),不要单独覆盖写 messages.jsonl。
- ⚠️ Session 删除走 `Agent.deleteSession(id)`（RegularSession）或 `Agent.deleteJob(id)`（JobRun 整 job 目录一锅端），会同时删 dir + 通过 `sessionIdx.remove` / `jobRunIdx.removeByJob` 删 SQL 行 + emit 相应 `*:index:updated`(op='remove')/`schedule:removed`。**不要**直接 `session.deleteFromDisk()`。
- ⚠️ Agent 软删走 `Profile.archiveAgent(id)`：写顺序是 archive move dir → agents.json 剔除（含 `primaryAgentId` 命中清空）。若中途崩溃，下次启动 `reconcileAgents()` 会发现 items 指向不存在的目录并自愈。
- ⚠️ `markdown.ts` 允许 `model: ''`（空字符串），便于刚 create 的 agent 立刻 round-trip。**不要**收紧成非空校验，否则会破坏 reconcile / restore 流程。
- ⚠️ 测试 mock fs 时 helper 不能单放 `_*.ts` —— vitest 的 include 模式 `__tests__/**/*.ts` 全扫；要么内嵌进 test 文件，要么改后缀。`session-schedule.test.ts` 整文件改走 tmp 真盘（Step 9）—— `better-sqlite3` 是 native，无法被 `vi.mock('node:fs')` 拦截。
- ⚠️ `Agent.createSession({ id?, title?, overrides?, contextState? })` 可接收外部 `id`。供 `pi.Agent.getOrCreateSession` 的 lazy create 路径使用：renderer 在 "New Chat" 按钮按下时本地 `newEntityId('s')` 生成 id 并 navigate，但**直到首次 streamMessage 走 pi 才真正落盘**，避免空壳 session。不传 id 走默认 ULID 生成，保持向后兼容。
- ⚠️ `handle.getSnapshot` 内有 **inflight 合并**：同 tick 多窗口 / 多 atom 的并发 invoke 共享一个 Promise，结束即释放。改 handler 时不要清掉这层 —— 它是 renderer 端 7 atom fan-out 的 main 端兜底；renderer 那侧在 [_snapshot.ts](../../renderer/states/_snapshot.ts) 自带 cache+inflight。两层都不缓存写路径数据，结束就 reset。
- ⚠️ **session 写路径 emit 契约**：每个子类在 `afterPersist()` 内自己做"upsert SQLite + emit 广播"两件事——基类不知道 SQLite / 广播 channel 存在。`RegularSession.afterPersist`：`sessionIdx.upsert(toRegularRow())` + emit `session:updated`。`JobRun.afterPersist`：`jobRunIdx.upsert(toJobRunRow())` + emit `schedule:run:updated`。idx 句柄（`SessionIdx` / `JobRunIdx`）由子类构造时注入；`Agent.bindSessionOnChange` / `ScheduleJob.bindRunOnChange` 入口已删——再没有 `Session.onChange` 这个机制。`session:index:updated` 由 `SessionIdx.upsert / remove` 自己发，**payload 是单条 op**（`{op:'upsert', entry}` / `{op:'remove', id}`），renderer atom 按 id 合并。
- ⚠️ **DB 自愈/初次填充**：`Profile.load` 拿到 `ProfileDb.open(id)` 后看 `wasCreated`（升级 / migrate / 拷贝 profile 目录的场景，新建空表）或 `checkIntegrity() === false`（DB 损坏 → `close` + `unlinkProfileDb` + 重 open），两条路径都会跑 `SessionIdx.rebuildFromDisk()` + `JobRunIdx.rebuildFromDisk()` 把 DB 与盘上 data.json 拉齐。`SessionIdx` / `JobRunIdx` 不持有 `ProfileDb` 引用而是每次按 `profileId` lookup，所以重建后旧引用不会悬空。
- ⚠️ **Starred 入口（Step 9）**：starred 真值是 `regular_sessions.starred_at` 列，与 row 同生共死。`setSessionStarred` IPC handler 走 `RegularSession.setStar(star)` 写 data.json → afterPersist 同步本列（**不刷 updatedAt**，与 `setReadStatus` 同语义）+ 在被删 session 之前确实 star 过 / 标记动作完成时补一次 `starred:updated`。**没有** `SessionIdx.setStarred` 入口 —— Step 9 设计稿写过但实施时被 `RegularSession.setStar` 路径替代。`setStar` 仅存在于 `RegularSession`，对 `JobRun` 无定义（schedule_run 不进 `regular_sessions` 表）。
- ⚠️ **进程退出 flush**：`main.ts onBeforeQuit` 在 logger close 之前调 `Profiles.get().shutdown()`（Phase 3.5，5s 超时），内部走 `Profile.shutdown` → `Agent.shutdown` → `Session.flushMessages` + `ProfileDb.close`。**绝不**让 `Profiles.shutdown` 变 fire-and-forget（早期实现漏 `await Profile.shutdownAll()` 会丢最后一批 messages.jsonl 行）。

## Step4 PR1 新增能力（2026-06-04）

为 step4 PR2/3/4 切换 `profileCacheManager` / `chatSessionStore` 调用方做铺垫，加了以下 API。**调用方迁移前**先看这一节。

| API | 文件 | 用途 |
|---|---|---|
| `Profiles.bootstrap()` 幂等 | `profiles.ts` | 多入口（main / lazy / evalMode）可重复调；二次调用 no-op |
| `Profiles.activeSync(): Profile` | `profiles.ts` | 登录链 sync getter；bootstrap 未完抛错 |
| `Profile.patchSettings(partial)` | `profile.ts` | 细粒度更新 confirmation 等子域，未传字段不动 |
| `Profile.duplicateAgent(srcId, newName)` | `profile.ts` | 复制 agent：front-matter + systemPrompt + knowledge 目录；sessions/schedules 不拷 |
| `Agent.toRecord()` / `Agent.toDetail()` | `agent.ts` | 两层视图：record 是 hot list 字段（同步 `agents.json#items`），detail 是 cold 字段（systemPrompt + mcp + skills + ...）。`Agent.patchFront` 内部自动写两边；renderer 按 hook 取 record，按 lazy fetch 取 detail。**`toView()` 已删**（Step 5）—— 不要恢复 |
| `Session.tailMessages(n)` / `sliceMessages(offset, n)` | `session.ts` | 分页加载 messages.jsonl（合并 disk + pending），返回 `{items, hasMore, nextOffset, total}` |

## Step5 PR1 新增能力（2026-06-04）

为 scheduler 整体重设计切 SchedulerManager 做铺垫。**调用方迁移前**先看这一节。

| API | 文件 | 用途 |
|---|---|---|
| `ScheduleJob.applyUpdate(partial)` | `schedule.ts` | 批量字段更新；可切换 cron ↔ once，但 cron / runAt 必须随 kind 一起带齐（缺则抛错）。**不自动 persist**——调用方负责后续 `job.persist()` |
| `ScheduleJob.listRunsOnDisk()` | `schedule.ts` | 列出该 job 的所有历史 run（含 running），按 startedAt 倒序。**Step 9 起底层是 `JobRunIdx.listJobRuns(jobId)` SQL 查询，不再扫盘**；方法名保留是与历史调用方兼容。即使内存 `runs` cache 已 evict 也完整可见 |
| `Profile.listJobsFlat({ agentId? })` | `profile.ts` | 跨 agent 聚合 schedule job 列表，每条返回 `{agent, job, entry}`；scheduler 跨 agent 操作（list / handleSystemResume / handleColdStartCatchUp）唯一入口 |
| `Profile.findJob(jobId)` | `profile.ts` | 单 jobId 反查 owning agent + job 实例；走 listJobsFlat 线性查找（N 小，无 jobId→agentId 反查表） |
## AgentRecord ↔ AGENT.md 同步契约（2026-06-06）

`AgentRecord`（`agents.json#items` 行）字段 `name / version / emoji / avatar / model` **是 `AGENT.md` front-matter 同名字段的派生缓存**。AGENT.md 是源真值；两边偏离时 reconcile 以 AGENT.md 为准。

### 唯一写入口

- `Agent.patchFront(partial)`（async）→ 先写 `AGENT.md`，再回调注入的 `AgentRegistry.syncRecord(this.toRecord())` 同步 record。
- `Profile.createAgent / duplicateAgent` → 新建时直接 `agentRegistry.items.push(agent.toRecord())`，整条写。
- `Profile.archiveAgent / restoreAgent` → 整条删 / 整条加。

**不要绕过这些入口手动改 `this.agentRegistry.items` 或单独写 `AGENT.md`**。否则 record stale，sidebar / chat header 显示旧 name / model 直到下一次 patchFront 触发。

### 为什么不在 bootstrap 做 reconcile

bootstrap 期间如果对所有 agents 做 record ↔ markdown 对账，等于把"启动期不读 AGENT.md"的设计目标推翻。本次重构选了"写路径同步"而不是"读路径 reconcile"。手动入口 `Profile.reconcileRecordFromMarkdown(id?)`（**当前未实现**，按需添加）给 Doctor / migrate 后置脚本用。

### Agent 实例上的 createdAt / updatedAt（2026-06-08）

`AgentRecord` 的 `createdAt / updatedAt` **不在 AGENT.md** 里，只挂 `agents.json`。`Agent.load` 必须从 `registry.items` 反向回填到实例（参见 agent.ts 第 140-143 行），否则后续任何 `patchFront`：

1. 内存 config 改了、AGENT.md 写盘 ✅
2. `doPersist` 的 `emit('agent:updated')` 因 `createdAt === ''` 兜底被吞 ❌
3. `syncRecord(this.toRecord())` 在 `toRecord()` 抛 `Agent.toRecord: createdAt/updatedAt not initialized` ❌

净效果：AGENT.md 是新的，agents.json items 永远 stale，renderer `agents.atom.byId` 拿不到 `agent:updated` 永远显示旧 model（"切了模型 UI 没反应"）。

**新加只挂 record / 只挂 markdown 的字段时**，同样要明确写在哪一边、加载时怎么互填，并加一条"reload + patchFront"的回归测试（参见 `agent.test.ts`）。

### Renderer 端两层 atom

- `agents.atom`（hot） → `AgentRecord`，列表 / sidebar / chat header / model selector 用
- `agentDetail.atom`（cold，按需懒读） → `AgentDetail`，agent editor / apply-to-dialog / context-menu skill list 用

main 端 `agent:updated` 事件 payload 同时下推 `{ record, detail }`，避免 renderer 写完 agent 后还要再 invoke 一次 `getAgentDetail`。


## Related

- 高层架构 / IPC 协议 / Hot-Cold 视图 / SQLite 索引设计：[ai.prompt/persist.md](../../../ai.prompt/persist.md)
- IPC 通道契约：[`src/shared/ipc/persist.ts`](../../shared/ipc/persist.ts)
- shared schema：[`src/shared/persist/types.ts`](../../shared/persist/types.ts)
