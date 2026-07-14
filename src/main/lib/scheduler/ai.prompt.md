<!-- Last verified: 2026-07-03 (完成通知分流：主窗口前台走 in-app toast，后台走系统通知) -->
# Scheduler

> 注册并触发基于时间的任务（cron 或一次性）。每次触发由 `ScheduleJob.startRun` 在 persist 内开一个独立的 schedule_run session，`pi.JobRun` 跑静默 turn loop，跑完 `finishRun` 落 runState 并发完成通知（`notifyOnCompletion !== false`）。完成通知分流：主窗口前台聚焦时经 `notification` IPC 通道让 renderer 弹 in-app toast（macOS 会静默丢弃前台 App 自发的系统通知），否则回落系统级 `new Notification`。
>
> **数据源**：`src/main/persist`（`Profile.listJobsFlat` / `Profile.findJob` / `Agent.getJob` / `ScheduleJob.startRun|finishRun|listRunsOnDisk` / `Profile.schedulerState`）。

## Key Files

| File | Responsibility | Status |
|------|----------------|--------|
| `SchedulerManager.ts` | 单例运行时：注册/注销 `node-cron` + `setTimeout`；CRUD/executeJob 全走 persist；cold-start / resume / watchdog 补偿；心跳 | active |
| `cronWatchdog.ts` | 心跳看门狗：检测进程存活期间错过的 cron 执行。通过依赖注入拿 SchedulerJob（不再 import 任何 store） | active |
| `cronRecovery.ts` | 纯函数：`findMissedCronOccurrence` / `shouldCatchUpMissedOccurrence` / `getColdStartCatchUpBaseline` / `getSchedulerTimeZone` | active |
| `SchedulerIPC.ts` | IPC handler。`getJobSessions` 走 `ScheduleJob.listRunsOnDisk` 投到旧 `SchedulerSessionInfo` 形状 | active |
| `jobAdapter.ts` | `SchedulerJob` (老扁平形状) ↔ `ScheduleJobFile + JobRunState` (persist union) 双向转换 + `updateJob` partial 投射 | active |
| `types.ts` | `SchedulerJob` / `SchedulerJobType` / `SchedulerJobStatus` / `normalizeSchedulerJob` —— IPC 契约形状，源真值已搬到 persist | active |

## Architecture

### 任务生命周期

```
createJob ─→ jobAdapter.toScheduleJobInput
           ─→ Profile.getAgent.createJob (ULID + writes job.json + jobs.json upsert)
           ─→ SchedulerManager.registerJob
              ├─ cron  → node-cron.schedule → on tick: executeJob('scheduled')
              └─ once  → setTimeout         → on fire: executeJob('scheduled')
                                              ↳ unregisterTask('once-job-fired')

executeJob(job, triggerSource, onReady?)
  → Profile.getAgent(job.agentId).getJob(job.id) → ScheduleJob 实例
  → job.startRun({ startedAt })        # 写 data.json + runState='running' + emit schedule:updated
  → onReady?({ chatSessionId: runSession.id })
  → new pi.JobRun(runId, profileId, agentId, runSession).run(userMsg)
  → job.finishRun(runId, completed|failed) # 写 data.json + runState=completed/failed
  → showSessionCompletionNotification(...) if notifyOnCompletion !== false
     ├─ 主窗口前台聚焦 → notification IPC → renderer in-app toast（macOS 抑制前台系统通知，故走这条）
     └─ 否则           → 系统级 new Notification + 点击跳转
  → once: unregisterTask('once-job-completed' | 'once-job-failed')
```

### 数据布局

- jobs：`{userData}/profiles/{p_id}/agents/{a_id}/schedules/{j_id}/job.json` + `schedules/jobs.json` 索引
- runs：`{userData}/profiles/{p_id}/agents/{a_id}/schedules/{j_id}/runs/{YYYYMM}/{s_id}/data.json + messages.jsonl`
- scheduler runtime state：`{userData}/profiles/{p_id}/scheduler-state.json`（`isActive` / `lastActivatedAt` / `lastDeactivatedAt` / `pendingColdStartCatchUps`），由 `Profile.schedulerState`（`persist/schedulerState.ts`）落盘

### runState 状态机

`JobRunState` discriminated union（`persist/schedule.ts`）：

```
pending → running → completed | failed
```

`SchedulerJob` 旧扁平字段是适配视图（`jobAdapter.toSchedulerJob`）：

| runState              | 旧 status   | lastRunAt | lastFinishedAt |
|-----------------------|-------------|-----------|----------------|
| `pending`             | `pending`   | undefined | undefined      |
| `running`             | `pending`   | startedAt | undefined      |
| `completed`           | `completed` | startedAt | finishedAt     |
| `failed`              | `failed`    | startedAt | finishedAt     |

特殊：`enabled=false && once && pending → 'expired'`（旧 UI 兼容；新模型无独立 expired 态）。

`executedAt` 字段永远不外露，`status` / `lastRunAt` / `lastFinishedAt` 在 `updateJob` 投射中被丢弃——runState 由 startRun/finishRun 自管，外部不允许 mutate。

### 冷启动 / 系统恢复 / 看门狗补偿

- **冷启动 (`initialize`)**：
  1. 切 profile：若与上一个不同，先调 `previous.schedulerState.markDeactivated(now)`（clean-exit baseline）
  2. `recoverInterruptedScheduledSessions` 扫所有 job 的磁盘 run，把 `status='running'` 的标 failed（"Interrupted by app shutdown"）
  3. **先抓 baseline / pending 快照，再 `markActivated(startupIso)`**（顺序很关键 —— 颠倒了 `lastActivatedAt` 会被覆写为 now，窗口塌缩为零）
  4. `handleColdStartCatchUp` 按 pending 队列重放、按 `getColdStartCatchUpBaseline()` 算 baseline 窗口补未覆盖的 missed cron；执行通过 `executeColdStartCatchUp` 走 `enqueue → executeJob → dequeue` 保证补跑中途崩溃下次仍能续上
- **优雅退出 (`dispose`)**：调 `currentProfile.schedulerState.markDeactivated(now)`，再 `stopHeartbeat / clearActiveTasks`。崩溃/强杀来不及写 → 下次启动 `isActive=true` + `lastActivatedAt` 落地为 baseline 窗口起点（unclean-exit）
- **系统恢复**：`handleSystemResume(suspendedAtMs, resumedAtMs)` 由 Electron power-monitor 外部触发，扫 enabled cron job 补遗
- **心跳看门狗**：60s 心跳内对每个活跃 cron task 调 `runCronWatchdog`；通过 `getJob` 回调拿最新 SchedulerJob（走 SchedulerManager.getJob → persist），比较 lastRunAt vs 漏触发时间决定是否补

### IPC 推送

通过 persist 内 `emit('schedule:updated', { ... })` / `emit('schedule:run:updated', { ... })` 发出。run session 的 onChange 在 `ScheduleJob.bindRunOnChange` 内挂好；`Agent.bindSessionOnChange` 跳过 schedule_run，避免双广播。

## Common Changes

| Scenario | Files |
|---|---|
| 加 SchedulerJob 字段 | `types.ts` + `shared/persist/types/index.ts`（`ScheduleJobFile*`）+ `persist/schedule.ts` (`ScheduleJobConfig.assign/applyUpdate/toFile`) + `jobAdapter.ts` 双向投射 + renderer schedule UI |
| 加 IPC 通道 | `shared/ipc/scheduler.ts` + `SchedulerIPC.ts` |
| runState 状态机改动 | `shared/persist/types/index.ts`（`JobRunState`）+ `persist/session.ts` (`finishScheduleRun`) + `persist/schedule.ts` (`startRun/finishRun`) + `jobAdapter.toSchedulerJob` 映射表 |
| 改补偿窗口 (6h 限制) | `cronRecovery.ts` (`MAX_RESUME_CATCH_UP_DELAY_MS`) |
| 加新 triggerSource | `SchedulerManager.executeJob` 签名 + 调用方 |

## Co-Change Map

| 改动 | 必须同步 |
|---|---|
| `types.ts` 的 `SchedulerJob` 字段 | `jobAdapter.ts` 投射表、`shared/ipc/scheduler.ts` 契约、renderer schedule UI |
| `persist/schedule.ts` 的 `ScheduleJobFile` schema | `jobAdapter.ts` 投射表、`step1` 迁移脚本（若加 required 字段） |
| `pi.JobRun` 行为 | `SchedulerManager.executeJob` 默认 message 构造（`MessageHelper.createTextMessage`） |
| `cronWatchdog.ts` 接口 | `SchedulerManager.startHeartbeat` 处的 `runCronWatchdog` 入参 |

## Anti-Patterns

- **不要外部直接 set `ScheduleJob.config.runState`**：runState 是状态机，由 `startRun/finishRun` 自管。jobAdapter 已在 `toPersistScheduleJobUpdate` 里丢弃这些字段。
- **不要在 cron tick 中绕过 `SchedulerManager.getJob`**：走 `SchedulerManager.getJob` 或注入的回调（如 cronWatchdog 的 `getJob`），避免重复加载 + 缓存不一致。
- **不要直接 `pi.Agent.getOrCreateSession(runId)`**：schedule_run 不进 Agent.sessions Map，`bindSessionOnChange` 会跳过，onChange 永远不挂。executeJob 走 `ScheduleJob.startRun` + `new JobRun(..., runSession)` 才能让 `schedule:run:updated` 真发出。
- **不要在 `initialize` 里颠倒 `getBaseline` 与 `markActivated` 的顺序**：`markActivated` 会覆写 `lastActivatedAt`，必须先抓快照再写入，否则冷启动窗口永远为零。

## Gotchas

- ⚠️ **`initialize()` 从 `auth:setCurrentSession` IPC handler 调用——绝不能阻塞登录。** 见 [CLAUDE.md Postmortem: v2.7.10 signing hang](../../../CLAUDE.md#postmortem-v2710-signing-hang)。`recoverInterruptedScheduledSessions` 现走 `listRunsOnDisk`（只读 data.json）+ `finishRun`，开销 O(jobs × months) 但单文件 < 几 KB。
- ⚠️ **`handleColdStartCatchUp` 仍顺序执行**。每次 `executeColdStartCatchUp` 都 `await` 一个完整 LLM job。补偿窗口或符合条件 job 增多会线性增长。
- ⚠️ **`node-cron` 默认系统时区**：`getSchedulerTimeZone()` 读 `Intl.DateTimeFormat`，显式传给 `CronExpressionParser`。
- ⚠️ **once 任务执行后 enabled=false**：`toggleJob` 重新 enable 会注册新 timeout——确认 runAt 仍在未来。
- ⚠️ **`MAX_TIMEOUT_MS`（≈24.8 天）**：超出此窗口的 once 任务 setTimeout 永不触发；UI 警告。
- ⚠️ **`schedulerGeneration`** 在每次 `initialize` 递增（切 profile / 重登）。旧代里持有的 SchedulerJob 引用陈旧；需要最新状态时 cron 回调内重取。
- ⚠️ **`runJobNow(jobId, force?)` 的 enabled 门控双语义**：UI 三个"立即运行"入口（`JobsView` / `JobRunsView` / `GeneratedScheduleCards` → `runScheduleNow` → `schedulerApi.runJobNow(jobId, true)`）传 `force=true`，**允许手动强制运行已禁用的 schedule**；LLM/appcmd 路径（`runJobNowInternal` → `runJobNow(jobId)`）不传 force，仍被 `!job.enabled` 拦截并返回 `'Only enabled schedules can be triggered by the agent.'`。`force` 只跳过 enabled 检查，`executeJob` 不注册 cron/timer、不改 `enabled`，强制运行禁用 job 无残留副作用（仅产生一次 run session + 完成通知）。

## Related

- [persist/schedule.ts](../../persist/schedule.ts) — `ScheduleJob` / `ScheduleRegistry`
- [persist/schedulerState.ts](../../persist/schedulerState.ts) — `SchedulerState`：cold-start baseline + pending catchup store
- [persist/agent.ts](../../persist/agent.ts) — `Agent.createJob / getJob / scheduleRegistry`
- [persist/profile.ts](../../persist/profile.ts) — `listJobsFlat / findJob`
- [pi/session.ts](../../pi/session.ts) — `BaseSession` / `RegularSession` / `JobRun`（`JobRun` 即静默 turn loop）
- [lib/notification/sessionCompletion.ts](../notification/sessionCompletion.ts) — 系统通知
- [ai.prompt/persist.md](../../../../ai.prompt/persist.md) — Schedule 物理隔离、`runState` 状态机、SQLite 索引架构
