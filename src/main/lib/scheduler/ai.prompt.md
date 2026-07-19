<!-- Last verified: 2026-07-18 (in-flight JobRun ownership and Profile-bound notifications) -->
# Scheduler

> 注册并触发基于时间的任务（cron 或一次性）。每次触发由 `ScheduleJob.startRun` 在 persist 内开一个独立的 schedule_run session，`pi.JobRun` 跑静默 turn loop，跑完 `finishRun` 落 runState 并发完成通知（`notifyOnCompletion !== false`）。完成通知只选址 owning Profile：其主窗口前台聚焦时经 `notification` IPC 弹 in-app toast，否则回落系统级 `new Notification`，点击时也不得向其他 Profile 窗口 fallback。
>
> **数据源**：`src/main/persist`（`ProfileStore.listJobsFlat` / `ProfileStore.findJob` / `Agent.getJob` / `ScheduleJob.startRun|finishRun|listRunsOnDisk` / `ProfileStore.schedulerState`）。

## Key Files

| File | Responsibility | Status |
|------|----------------|--------|
| `index.ts` | scheduler 模块唯一对外入口：导出 profile-bound manager、IPC 注册和诊断视图转换 | active |
| `manager.ts` | 每个 `Profile` 持有一个实例；任务 CRUD、启动、停止、单 Profile 初始化隔离，以及 in-flight `JobRun` 的取消/等待所有权 | active |
| `context.ts` | `SchedulerContext`：固定的 `ProfileStore`、started 标志与 generation 的唯一来源；按引用共享给 taskRuntime / catchUp / execution | active |
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
           ─→ ProfileStore.getAgent.createJob (ULID + writes job.json + jobs.json upsert)
           ─→ SchedulerManager → SchedulerTaskRuntime.registerJob
              ├─ cron  → node-cron.schedule → on tick: executeSchedulerJob('scheduled')
              └─ once  → setTimeout         → on fire: executeSchedulerJob('scheduled')
                                              ↳ unregisterTask('once-job-fired')

executeSchedulerJob({ job, triggerSource, context, taskRuntime, onReady? })
  → context.store.getAgent(job.agentId).getJob(job.id) → ScheduleJob 实例
  → job.startRun({ startedAt })        # 写 data.json + runState='running' + emit schedule:updated
  → onReady?({ chatSessionId: runSession.id })
  → SchedulerManager 登记 active execution / JobRun
  → new pi.JobRun(runId, profileId, agentId, runSession).run(userMsg, shouldStart)
  → job.finishRun(runId, completed|failed) # 写 data.json + runState=completed/failed
  → showSessionCompletionNotification(profileId, ...) if scheduler still started && notifyOnCompletion
     ├─ owner 主窗口前台聚焦 → notification IPC → owner renderer in-app toast
     └─ 否则                 → 系统级 Notification；点击只查 owner 窗口
  → once: unregisterTask('once-job-completed' | 'once-job-failed')
```

### 协作模型（context 收敛）

每个 `Profile` 构造一个 `SchedulerManager(ProfileStore)`；`SchedulerContext` 从构造起固定持有必存在的 store，并作为 lifecycle gate 的唯一状态源：`started` 表达当前是否接受工作，`generation` 区分每一轮启动。manager 向 taskRuntime / catchUp 注入同一个受控 executor，所有 scheduled / catch-up / manual 执行先登记到 manager 的 active execution 集合，再进入自由函数 `executeSchedulerJob(...)`；停止时先 `context.deactivate()` 关门，再统一 abort `JobRun` 并等待 `finishRun` 收尾。taskRuntime → execution 是运行时单向依赖，execution → taskRuntime 仅 type-only import（编译期擦除），不构成循环。

### 日志

`catchUp.ts`、`cronWatchdog.ts`、`execution.ts`、`manager.ts` 与 `taskRuntime.ts` 各自通过 `log.child({ mod: '<当前模块>' })` 固定 `mod`（SQLite 的 `component`）。调用点不得再次传 `mod`；`msg` 仅描述发生的动作或结果，诊断维度（如 `profileId`、`jobId`、`schedulerGeneration`、`err`）作为结构化字段传入。

### 数据布局

- jobs：`{userData}/profiles/{p_id}/agents/{a_id}/schedules/{j_id}/job.json` + `schedules/jobs.json` 索引
- runs：`{userData}/profiles/{p_id}/agents/{a_id}/schedules/{j_id}/runs/{YYYYMM}/{s_id}/data.json + messages.jsonl`
- scheduler runtime state：`{userData}/profiles/{p_id}/scheduler-state.json`（`isActive` / `lastActivatedAt` / `lastDeactivatedAt` / `pendingColdStartCatchUps`）。`isActive=true` 严格表示该 Profile 的 scheduler runtime 已 start，而非 renderer 当前选中的 Profile；由 `ProfileStore.schedulerState`（`persist/schedulerState.ts`）落盘。

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

- **冷启动 (`SchedulerManager.start()`)**：`Profile.start()` 为每个已加载 Profile 调用它。它注册 enabled task、恢复 interrupted run、读取 baseline/pending 快照、`markActivated`；随后 **fire-and-forget** `handleColdStartCatchUp`，不阻塞其他 Profile 启动。单个 task 注册失败只记告警，不阻止其余任务与 heartbeat。补跑先 `enqueue`，成功后 `dequeue`，中途崩溃仍可在下次启动续上。**孤儿清扫**：消费 pending 队列前，先把 `pendingCatchUps` 里 job 已不是“启用的 cron”（被禁用 / 删除 / 改成 once）的条目 `dequeue` 掉。
- **窗口与默认候选无关**：打开或关闭任一 Profile 窗口都不改变 scheduler；Registry 不提供 selection API，每个已加载 Profile 的 task、timer 与 catch-up 始终由自身 runtime 持有。
- **优雅退出或删除 (`SchedulerManager.dispose`)**：由 `Profile.dispose()` 先调；先使 generation 失效并关闭 execution gate，再停止 heartbeat / 清理 task，随后 abort 并等待全部 in-flight `JobRun` 完成 `finishRun`，最后才写该 Profile 的 `markDeactivated`。因此后续 `ProfileStore.shutdown()` 不会与 schedule run 写回并发。崩溃或强杀来不及写时，下次启动由 `isActive=true` + `lastActivatedAt` 识别 unclean-exit 窗口。
- **系统恢复**：Electron power-monitor 经 `ProfileRegistry.handleSystemResume()` 向全部已加载 Profile 的 scheduler 分发；每个 Profile 内最多 2 个并发任务补遗，单个失败只记录日志。
- **心跳看门狗**：每个运行中 scheduler 的 60s 心跳对其活跃 cron task 调 `runCronWatchdog`；通过 `getJob` 回读该 Profile 的最新任务。

### IPC 推送

通过 persist 内 `emit(profileId, 'schedule:updated', { ... })` / `emit(profileId, 'schedule:run:updated', { ... })` / `emit(profileId, 'schedule:run:removed', { ... })` 发出。`JobRun.afterPersist` 直接同步 `job_runs` 并发 run update；单条已结束 run 由 `ScheduleJob.deleteRun` 删除源目录和索引后发 run removed。`Agent.bindSessionOnChange` / `ScheduleJob.bindRunOnChange` 已删除，避免双广播。

## Common Changes

| Scenario | Files |
|---|---|
| 加 SchedulerJob 字段 | `shared/ipc/scheduler.ts` + `jobAdapter.ts` 投射 + renderer schedule UI |
| 加 IPC 通道 | `shared/ipc/scheduler.ts` + `ipc.ts` |
| runState 状态机改动 | `shared/persist/types/index.ts`（`JobRunState`）+ `persist/session.ts` (`finishScheduleRun`) + `persist/schedule.ts` (`startRun/finishRun`) + `jobAdapter.toSchedulerJob` 映射表 |
| 改补偿窗口 (6h 限制) | `cronRecovery.ts` (`MAX_RESUME_CATCH_UP_DELAY_MS`) |
| 加新 triggerSource | `types.ts` + `execution.ts` + 调用方 |
| profile 生命周期接线（启动 / 停止 / resume） | `profile.ts`（持有 manager 并 start/dispose）+ `profileRegistry.ts`（全 profile resume fan-out）+ `main.ts`（power-monitor）|
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
- **不要在 `start()` 里颠倒 `getBaseline` 与 `markActivated` 的顺序**：`markActivated` 会覆写 `lastActivatedAt`，必须先抓快照再写入，否则冷启动窗口永远为零。

## Gotchas

- ⚠️ **renderer scheduler IPC** 从 `event.sender` 所属 BrowserWindow 解析 owning Profile；renderer 不传 profileId。Agent/appcmd 路径继续使用执行上下文的 `profileId` 精确取得 owning Profile。
- ⚠️ **`node-cron` 默认系统时区**：`getSchedulerTimeZone()` 读 `Intl.DateTimeFormat` 并传给 `CronExpressionParser`，用于补跑计算；运行时 tick 仍遵循 node-cron 的系统时区。
- ⚠️ **once 任务执行后 enabled=false**：`toggleJob` 重新 enable 会注册新 timeout——确认 runAt 仍在未来。
- ⚠️ **`MAX_TIMEOUT_MS`（≈24.8 天）**：超出此窗口的 once 任务通过分段 timeout 重新注册；不会在单个 timer 上溢出。
- ⚠️ **完成通知以 `finishRun` 为界**：LLM turn 成功但结束状态落盘失败时，不得显示成功通知或返回成功执行结果。
- ⚠️ **`schedulerGeneration`** 在同一 Profile 每次 start / dispose 递增；后台 cold-start catch-up 在执行前校验 generation，停止后的工作不得继续启动该 Profile 的任务。
- ⚠️ **停止顺序不可反转**：`context.deactivate()` 必须在任何 `await` 之前关闭唯一 lifecycle gate；`markDeactivated` 必须在 active execution 全部收尾之后，避免停止窗口内启动新 run 或关闭 store 后继续写回。
- ⚠️ **完成通知按 owner 选址**：调用必须携带 `context.profileId`；toast 与系统通知点击都只使用 `mainWindowForProfile(profileId)`，禁止 `mainWindow()` / `anyVisibleWindow()` fallback。
- ⚠️ **cron callback 必须重新读取任务**：timer 可能在 unregister 后已排入 event loop；回调先核对 runtime meta，再用 `getJob` 读取最新启用配置。
- ⚠️ **`runJobNow(jobId, force?)` 的 enabled 门控双语义**：UI 三个"立即运行"入口（`JobsView` / `JobRunsView` / `GeneratedScheduleCards` → `runScheduleNow` → `schedulerApi.runJobNow(jobId, true)`）传 `force=true`，**允许手动强制运行已禁用的 schedule**；LLM/appcmd 路径（`runJobNowInternal` → `runJobNow(jobId)`）不传 force，仍被 `!job.enabled` 拦截并返回 `'Only enabled schedules can be triggered by the agent.'`。`force` 只跳过 enabled 检查，`executeJob` 不注册 cron/timer、不改 `enabled`，强制运行禁用 job 无残留副作用（仅产生一次 run session + 完成通知）。

## Related

- [persist/schedule.ts](../../persist/schedule.ts) — `ScheduleJob` / `ScheduleRegistry`
- [persist/schedulerState.ts](../../persist/schedulerState.ts) — `SchedulerState`：cold-start baseline + pending catchup store
- [persist/agent.ts](../../persist/agent.ts) — `Agent.createJob / getJob / scheduleRegistry`
- [persist/profileStore.ts](../../persist/profileStore.ts) — `listJobsFlat / findJob`
- [pi/session/](../../pi/session/) — `BaseSession` / `RegularSession` / `JobRun`（`JobRun` 即静默 turn loop）
- [lib/notification/sessionCompletion.ts](../notification/sessionCompletion.ts) — 系统通知
- [ai.prompt/persist.md](../../../../ai.prompt/persist.md) — Schedule 物理隔离、`runState` 状态机、SQLite 索引架构
