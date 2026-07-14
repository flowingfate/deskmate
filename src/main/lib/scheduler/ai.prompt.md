<!-- Last verified: 2026-07-15 (scheduler 输入校验与完成状态边界) -->
# Scheduler

> 注册并触发基于时间的任务（cron 或一次性）。每次触发由 `ScheduleJob.startRun` 在 persist 内开一个独立的 schedule_run session，`pi.JobRun` 跑静默 turn loop，跑完 `finishRun` 落 runState 并发完成通知（`notifyOnCompletion !== false`）。完成通知分流：主窗口前台聚焦时经 `notification` IPC 通道让 renderer 弹 in-app toast（macOS 会静默丢弃前台 App 自发的系统通知），否则回落系统级 `new Notification`。
>
> **数据源**：`src/main/persist`（`Profile.listJobsFlat` / `Profile.findJob` / `Agent.getJob` / `ScheduleJob.startRun|finishRun|listRunsOnDisk` / `Profile.schedulerState`）。

## Key Files

| File | Responsibility | Status |
|------|----------------|--------|
| `index.ts` | scheduler 模块唯一对外入口：导出 manager、IPC 注册和诊断视图转换 | active |
| `manager.ts` | 单例门面：任务 CRUD 与生命周期编排；初始化隔离单个 task 注册失败，继续激活其余任务 | active |
| `context.ts` | `SchedulerContext`：活动状态（profile / generation）的唯一来源 + 派生只读（`isCurrentGeneration` / `getJob` / `listJobs` / `requireProfile`）；按引用共享给 taskRuntime / catchUp / execution | active |
| `taskRuntime.ts` | `node-cron` / `setTimeout` 注册、注销、运行时诊断和心跳看门狗 | active |
| `catchUp.ts` | interrupted run 恢复、cold-start 与系统恢复补跑 | active |
| `execution.ts` | 一次任务执行：创建 run session、静默 `JobRun`、完成写回成功后才通知 | active |
| `types.ts` | runtime task、执行结果和调度原因的内部共享类型 | active |
| `concurrency.ts` | 持续填满 worker slot 的受限并发执行器，保留每项成功或失败结果 | active |
| `cronWatchdog.ts` | 心跳看门狗：检测进程存活期间错过的 cron 执行；按受限并发补跑 | active |
| `cronRecovery.ts` | 纯函数：`findMissedCronOccurrence` / `shouldCatchUpMissedOccurrence` / `getColdStartCatchUpBaseline` / `getSchedulerTimeZone` | active |
| `ipc.ts` | renderer 的任务 CRUD 与手动执行 IPC handler | active |
| `jobAdapter.ts` | `ScheduleJobFile + JobRunState` 到跨层 `SchedulerJob` 视图，以及 create/update payload 投射和边界校验 | active |

## Architecture

### 任务生命周期

```
createJob ─→ jobAdapter.toScheduleJobInput
           ─→ Profile.getAgent.createJob (ULID + writes job.json + jobs.json upsert)
           ─→ SchedulerManager → SchedulerTaskRuntime.registerJob
              ├─ cron  → node-cron.schedule → on tick: executeSchedulerJob('scheduled')
              └─ once  → setTimeout         → on fire: executeSchedulerJob('scheduled')
                                              ↳ unregisterTask('once-job-fired')

executeSchedulerJob({ job, triggerSource, context, taskRuntime, onReady? })
  → context.profile.getAgent(job.agentId).getJob(job.id) → ScheduleJob 实例
  → job.startRun({ startedAt })        # 写 data.json + runState='running' + emit schedule:updated
  → onReady?({ chatSessionId: runSession.id })
  → new pi.JobRun(runId, profileId, agentId, runSession).run(userMsg)
  → job.finishRun(runId, completed|failed) # 写 data.json + runState=completed/failed
  → showSessionCompletionNotification(...) if notifyOnCompletion !== false
     ├─ 主窗口前台聚焦 → notification IPC → renderer in-app toast（macOS 抑制前台系统通知，故走这条）
     └─ 否则           → 系统级 new Notification + 点击跳转
  → once: unregisterTask('once-job-completed' | 'once-job-failed')
```

### 协作模型（context 收敛）

活动状态只存在一处：`SchedulerContext`（`profile` + `generation`，`profileId` 派生自 `profile.id`）。manager、taskRuntime、catchUp 共享同一个 context 引用；三者读状态直接走 `this.context.profileId` / `this.context.isCurrentGeneration(gen)`，不再经过注入闭包。执行是自由函数 `executeSchedulerJob(...)`：cron/once 触发、catchUp 补跑、manual 手动运行全走它，入参带 `context` + `taskRuntime` 真实对象。taskRuntime → execution 是运行时单向依赖，execution → taskRuntime 仅 type-only import（编译期擦除），不构成循环。

### 日志

`catchUp.ts`、`cronWatchdog.ts`、`execution.ts`、`manager.ts` 与 `taskRuntime.ts` 各自通过 `log.child({ mod: '<当前模块>' })` 固定 `mod`（SQLite 的 `component`）。调用点不得再次传 `mod`；`msg` 仅描述发生的动作或结果，诊断维度（如 `profileId`、`jobId`、`schedulerGeneration`、`err`）作为结构化字段传入。

### 数据布局

- jobs：`{userData}/profiles/{p_id}/agents/{a_id}/schedules/{j_id}/job.json` + `schedules/jobs.json` 索引
- runs：`{userData}/profiles/{p_id}/agents/{a_id}/schedules/{j_id}/runs/{YYYYMM}/{s_id}/data.json + messages.jsonl`
- scheduler runtime state：`{userData}/profiles/{p_id}/scheduler-state.json`（`isActive` / `lastActivatedAt` / `lastDeactivatedAt` / `pendingColdStartCatchUps`），由 `Profile.schedulerState`（`persist/schedulerState.ts`）落盘

### runState 状态机

`JobRunState` discriminated union（`persist/schedule.ts`）：

```
pending → running → completed | failed
```

跨进程 `SchedulerJob` 定义在 `shared/ipc/scheduler.ts`，并保持与配置一致的 discriminated union：

```ts
type SchedulerJob =
  | { scheduleType: 'cron'; cronExpression: string; lastStartedAt?: string; /* ... */ }
  | { scheduleType: 'once'; runAt: string; lastStartedAt?: string; /* ... */ };
```

它不复制 `JobRunState`，也不伪造任务状态；运行结果从 run 列表读取。`lastStartedAt` 只是补跑去重和紧凑 UI 所需的最近一次运行起点。

### 冷启动 / 系统恢复 / 看门狗补偿

- **冷启动 (`initialize(profile)`)**：调用方传入已加载的 active Profile。方法注册 enabled task、恢复 interrupted run、读取 baseline/pending 快照、`markActivated`；随后 **fire-and-forget** `handleColdStartCatchUp`，不阻塞启动路径。单个 task 注册失败只记告警，不阻止其余 task 与 heartbeat。补跑先 `enqueue`，成功后 `dequeue`，中途崩溃仍可在下次启动续上。**孤儿清扫**：消费 pending 队列前，先把 `pendingCatchUps` 里 job 已不是"启用的 cron"（被禁用 / 删除 / 改成 once）的条目 `dequeue` 掉——补跑循环只遍历 `recurringJobs`（enabled+cron 过滤）永远够不到它们，不清理会在 `scheduler-state.json` 里无界堆积。
- **运行时切 profile (`switch(profile, previousProfile?)`)**：`persist/ipc.ts` 在 `Profiles.switch()` 返回后经启动期注入的回调 fire-and-forget 调用。`switch` 同步递增 generation 并清空旧 task，随后写旧 profile 的 `markDeactivated` 基线，最后注册新 profile；旧 profile 已被 `Profiles.switch()` shutdown 后，`schedulerState` 仍可通过 `writeJson` 直写盘。切换不调 `dispose`，避免停掉刚重建的运行时。
- **优雅退出 (`dispose`)**：调 `context.profile.schedulerState.markDeactivated(now)`，再 `stopHeartbeat / clearActiveTasks`。崩溃/强杀来不及写 → 下次启动 `isActive=true` + `lastActivatedAt` 落地为 baseline 窗口起点（unclean-exit）。
- **系统恢复**：`handleSystemResume(suspendedAtMs, resumedAtMs)` 由 Electron power-monitor 外部触发，按最多 2 个并发任务补遗。
- **心跳看门狗**：60s 心跳内对每个活跃 cron task 调 `runCronWatchdog`；通过 `getJob` 回调拿最新任务，比较 `lastStartedAt` 与漏触发时间，按最多 2 个并发任务补跑。

### IPC 推送

通过 persist 内 `emit('schedule:updated', { ... })` / `emit('schedule:run:updated', { ... })` / `emit('schedule:run:removed', { ... })` 发出。`JobRun.afterPersist` 直接同步 `job_runs` 并发 run update；单条已结束 run 由 `ScheduleJob.deleteRun` 删除源目录和索引后发 run removed。`Agent.bindSessionOnChange` / `ScheduleJob.bindRunOnChange` 已删除，避免双广播。

## Common Changes

| Scenario | Files |
|---|---|
| 加 SchedulerJob 字段 | `shared/ipc/scheduler.ts` + `jobAdapter.ts` 投射 + renderer schedule UI |
| 加 IPC 通道 | `shared/ipc/scheduler.ts` + `ipc.ts` |
| runState 状态机改动 | `shared/persist/types/index.ts`（`JobRunState`）+ `persist/session.ts` (`finishScheduleRun`) + `persist/schedule.ts` (`startRun/finishRun`) + `jobAdapter.toSchedulerJob` 映射表 |
| 改补偿窗口 (6h 限制) | `cronRecovery.ts` (`MAX_RESUME_CATCH_UP_DELAY_MS`) |
| 加新 triggerSource | `types.ts` + `execution.ts` + 调用方 |
| profile 生命周期接线（启动 init / 切换重建） | `startup/ipc/index.ts`（传 `Profile` 给 `initialize`，注入 switch 回调）+ `persist/ipc.ts`（切换后调用回调）|
| 扩展模块对外能力 | `index.ts`；外部调用方不得 deep import 实现文件 |

## Co-Change Map

| 改动 | 必须同步 |
|---|---|
| `shared/ipc/scheduler.ts` 的 `SchedulerJob` 字段 | `jobAdapter.ts` 投射表、renderer schedule UI、appcmd schedule view |
| `persist/schedule.ts` 的 `ScheduleJobFile` schema | `jobAdapter.ts` 投射表、`step1` 迁移脚本（若加 required 字段） |
| `pi.JobRun` 行为 | `execution.ts` 的默认 message 构造 |
| `cronWatchdog.ts` 接口 | `taskRuntime.ts` 处的 `runCronWatchdog` 入参 |

## Anti-Patterns

- **不要外部直接 set `ScheduleJob.config.runState`**：runState 是状态机，由 `startRun/finishRun` 自管；配置更新只接受完整的 schedule discriminated union 分支。
- **不要在 cron tick 中绕过 `context.getJob`**：走 `SchedulerContext.getJob`（manager / cronWatchdog 都经它读最新启用配置），避免重复加载 + 缓存不一致。
- **不要直接 `pi.Agent.getOrCreateSession(runId)`**：schedule_run 不进 Agent.sessions Map，`bindSessionOnChange` 会跳过，onChange 永远不挂。executeJob 走 `ScheduleJob.startRun` + `new JobRun(..., runSession)` 才能让 `schedule:run:updated` 真发出。
- **不要在 `initialize` 里颠倒 `getBaseline` 与 `markActivated` 的顺序**：`markActivated` 会覆写 `lastActivatedAt`，必须先抓快照再写入，否则冷启动窗口永远为零。

## Gotchas

- ⚠️ **`initialize(profile)` 与 `switch(profile, previousProfile?)` 都不能阻塞其调用路径。** 启动期在 `Profiles.bootstrap()` 后 `await initialize(profile)`；profile IPC 切换在 `Profiles.switch()` 成功后 fire-and-forget `switch(profile, previousProfile)`。后者先使旧 generation 和 task 失效，再 await 写旧 profile 基线；cold-start catch-up 始终后台受限并发执行，`recoverInterruptedScheduledSessions` 是有限持久化修复。
- ⚠️ **`node-cron` 默认系统时区**：`getSchedulerTimeZone()` 读 `Intl.DateTimeFormat` 并传给 `CronExpressionParser`，用于补跑计算；运行时 tick 仍遵循 node-cron 的系统时区。
- ⚠️ **once 任务执行后 enabled=false**：`toggleJob` 重新 enable 会注册新 timeout——确认 runAt 仍在未来。
- ⚠️ **`MAX_TIMEOUT_MS`（≈24.8 天）**：超出此窗口的 once 任务通过分段 timeout 重新注册；不会在单个 timer 上溢出。
- ⚠️ **完成通知以 `finishRun` 为界**：LLM turn 成功但结束状态落盘失败时，不得显示成功通知或返回成功执行结果。
- ⚠️ **`schedulerGeneration`** 在每次 `initialize` 或 `switch` 递增；后台 cold-start catch-up 在执行前校验 generation，过期 generation 不得启动旧 profile 的任务。
- ⚠️ **cron callback 必须重新读取任务**：timer 可能在 unregister 后已排入 event loop；回调先核对 runtime meta，再用 `getJob` 读取最新启用配置。
- ⚠️ **`runJobNow(jobId, force?)` 的 enabled 门控双语义**：UI 三个"立即运行"入口（`JobsView` / `JobRunsView` / `GeneratedScheduleCards` → `runScheduleNow` → `schedulerApi.runJobNow(jobId, true)`）传 `force=true`，**允许手动强制运行已禁用的 schedule**；LLM/appcmd 路径（`runJobNowInternal` → `runJobNow(jobId)`）不传 force，仍被 `!job.enabled` 拦截并返回 `'Only enabled schedules can be triggered by the agent.'`。`force` 只跳过 enabled 检查，`executeJob` 不注册 cron/timer、不改 `enabled`，强制运行禁用 job 无残留副作用（仅产生一次 run session + 完成通知）。

## Related

- [persist/schedule.ts](../../persist/schedule.ts) — `ScheduleJob` / `ScheduleRegistry`
- [persist/schedulerState.ts](../../persist/schedulerState.ts) — `SchedulerState`：cold-start baseline + pending catchup store
- [persist/agent.ts](../../persist/agent.ts) — `Agent.createJob / getJob / scheduleRegistry`
- [persist/profile.ts](../../persist/profile.ts) — `listJobsFlat / findJob`
- [pi/session/](../../pi/session/) — `BaseSession` / `RegularSession` / `JobRun`（`JobRun` 即静默 turn loop）
- [lib/notification/sessionCompletion.ts](../notification/sessionCompletion.ts) — 系统通知
- [ai.prompt/persist.md](../../../../ai.prompt/persist.md) — Schedule 物理隔离、`runState` 状态机、SQLite 索引架构
