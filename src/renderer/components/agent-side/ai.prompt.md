<!-- Last verified: 2026-07-15 (sessions 新建聊天直接导航至完整 session URL；job-run 保持只读 capability) -->
# Agent Side Panel

> 中间列（左 nav 与右侧 ChatView 之间）的整块 UI：agent header + sessions / jobs 双模式切换。
> URL 是模式与选中状态的**唯一真相源**，不存在表达"当前在哪个面板"的 atom。

## 关键文件
| 文件 | 职责 | 规模 |
|------|------|------|
| `SessionPanel.tsx` | Orchestrator：从 `useParams` / `useMatch` 派生 mode/subScreen，分发到对应 view | ~80 LOC |
| `header/SessionPanelHeader.tsx` | Agent 名 + alarm icon + agent dropdown 的入口 | ~60 LOC |
| `header/AlarmToggleButton.tsx` | alarm 图标 + scheduled-unread badge；点击在 sessions ↔ jobs 根 URL 间切换；jobs → sessions 永远回 `/agent/:agentId`，绝不把 job-run ID 伪装成 regular session | ~65 LOC |
| `sessions/SessionsView.tsx` | sessions 子屏：search box + SessionList + New Conversation 按钮；新建时直接生成 session ID 并导航到完整 session URL | ~80 LOC |
| `sessions/SessionList.tsx` | 单 agent 的 regular session 列表：starred 分组、未读高亮、滚动定位、ChatSessionMenuAtom 触发 | ~290 LOC |
| `jobs/JobsView.tsx` | jobs 子屏：内联 ListSearchBox + 紧凑 JobRow 列表 + 底部 NewScheduleButton + AddScheduleOverlay + 删除确认 AlertDialog；CRUD / toggle / run-now 全部在此完成 | ~275 LOC |
| `jobs/NewScheduleButton.tsx` | jobs 底部常驻的 `w-full` "New schedule" 按钮（对齐 sessions 的 New Conversation），含**向上**弹出的模板下拉，模板列表来自 `agent-editor/scheduleTemplates.ts` | ~100 LOC |
| `jobs/JobRow.tsx` | 紧凑行：状态点 (toggle, 富 tooltip) + 标题/描述 (body, 派发 onActivate) + 右侧 chevron-down (展开/收起内联面板) | ~165 LOC |
| `jobs/JobRunsView.tsx` | runs 子屏：RunsHeader + RunRow 列表；job 失效时 3s 后自动回退到 jobs 子屏；订阅 `useAgentScheduleRuns` | ~115 LOC |
| `jobs/RunsHeader.tsx` | runs 顶部：返回箭头 + job 名 (无菜单) | ~50 LOC |
| `jobs/RunRow.tsx` | 单 run 行：状态 icon + 标题 + 完成时间/错误；点击 navigate 到 `/job/:jobId/:sessionId`；More 按钮以 `schedule` source + job id 触发 `ChatSessionMenuAtom`（Download / Delete-only；删除单条已结束 run） | ~95 LOC |
| `jobs/runStatusIcons.tsx` | 4 种运行状态的 SVG icon（Executing / Completed / Interrupted / Failed） | ~70 LOC |
| `jobs/utils.ts` | `getScheduledSessionDisplayState` / `describeSchedule` / `formatDateTime` / `formatRunTime` + `JobRowStatus` 类型 + `deriveJobRowStatus`（one-time 是否过期由 `runAt` 推导） | ~85 LOC |

> 样式注释：本目录不再使用外部 SCSS（`styles.scss` 已移除）。所有视觉规则都用 Tailwind 行内 class 表达；遇到 group-hover、grid-template-rows 动画这类略复杂的场景，也以 Tailwind v4 的 `group/name`、`[&_selector]`、arbitrary value 等机制写在 className 里。

> 每个 React 组件的顶层 element 都带 `data-dbg="<name>"`（如 `data-dbg="job-row"`），DevTools 里可以直接按属性筛选定位。组件本身没有 DOM 包裹的（`SessionsView` / `JobsView` / `JobRunsView`）用 `<div className="contents">` 包一层，既不影响布局又保留调试锚点。

## 架构

### 模式与 subScreen 派生
所有状态从 URL 读出（见 `entries/main.routes.tsx`）：

```
/agent                              → 没有 agentId；header 用 cache 兜底，body 不渲染
/agent/:agentId                      → sessions 子屏，无选中
/agent/:agentId/:sessionId           → sessions 子屏 + 选中 session
/agent/:agentId/job                  → jobs 子屏（JobsView）
/agent/:agentId/job/:jobId           → runs 子屏（JobRunsView）
/agent/:agentId/job/:jobId/:sessionId → runs 子屏 + 右侧 ChatView 渲染该 run
```

`SessionPanel.tsx` 用 `useMatch('/agent/:agentId/job/*')` 区分 mode；`useParams()` 给出 `agentId / jobId / sessionId`。**任何"当前在哪个 view / 选中了什么"的状态都不要塞进 atom** —— 切 agent 自然回 sessions（URL 不带 `job` 段），刷新 / 前进后退 / 深链原生支持，0 状态同步代码。

New Conversation 与 agent sidebar 直接生成尚未持久化的 regular session ID，并跳转到 `/agent/:agentId/:sessionId`；不通过 `location.state` 携带 `new-chat` 等隐式导航指令。

### Alarm 切换契约
`AlarmToggleButton` 在 jobs ↔ sessions 间切。jobs → sessions 时总是跳到 `/agent/:agentId`；不能把 job-run 的 `:sessionId` 拼进 regular 路由，否则 ChatView 会按 regular 语义读取并可能触发错误写路径。

### Job 失效保护
`JobRunsView` 监听 `useSchedulesByAgentId(agentId).find(j => j.id === jobId)`，job 不存在时：
1. 显示 `Schedule no longer exists` 占位。
2. 3 秒后 `navigate('/agent/:agentId/job')`。
3. `allJobs.length === 0` 视为"还在加载中"，不立即跳走（避免冷启动闪现）。

Edit / Run now / Delete 唯一入口在 jobs 子屏 `JobRow` 的展开面板里（Edit / Run now / Delete 三个 Button）。runs 子屏 RunsHeader 故意只放返回箭头 —— 它是一层导航,不是动作面;真要删 schedule,先返回 jobs 列表展开对应行。

### 与右侧 `ChatView` 的关系
`ChatView` 接受 `kind?: 'regular' | 'job-run'` prop（默认 `'regular'`），由路由显式注入；`entries/main.routes.tsx` 中 `:agentId/job/...` 三条路由全部 `<ChatView kind="job-run" />`，`:agentId` / `:agentId/:sessionId` 走默认。

`kind` 决定 ChatView 的快照与 capability：
- `'regular'` → `loadChatSessionSnapshot` + `markSessionRead` → `regular_sessions`；可互动。
- `'job-run'` → `loadJobRunSnapshot` + `markJobRunRead` → `job_runs`；只读回放，不支持 send / edit / retry / cancel。

两条路径在主进程完全物理隔离。Cache 仍按 sessionId 索引（同一份 in-memory 容器）；job-run 的写入限制由 ChatView 的显式 kind prop 负责。

若未来需要在 job-run URL 上挂横幅 / 工具栏，加薄 wrapper：

```jsx
const JobRunChatView = () => (<><JobRunBanner /><ChatView kind="job-run" /></>);
<Route path=":agentId/job/:jobId/:sessionId" element={<JobRunChatView />} />
```

### 数据来源
- regular sessions：`useAgentSessions(agentId)` / `useAgentSessionsHydrated(agentId)`（`states/sessionIndex.atom.ts`）
- jobs：`useSchedulesByAgentId(agentId)`（`states/schedules.atom.ts`，subscribes `persist:schedule:*`）
- runs：`useAgentScheduleRuns(agentId)` / `useAgentScheduleRunsHydrated(agentId)`（`states/scheduleRuns.atom.ts`）
- 未读 badge：`useAgentUnreadSummary(agentId, profileId).scheduledUnreadCount`
- CRUD IPC：`schedulerApi.{toggleJob, deleteJob, runJobNow, updateJob, createJob}`（`shared/ipc/scheduler.ts`）

## 常见变更
| 场景 | 需要修改的文件 | 备注 |
|------|---------------|------|
| 新增/调整 jobs 路由（如加新子屏） | `entries/main.routes.tsx` + `SessionPanel.tsx`（`useMatch` 与分发分支） | `:agentId/job/...` 段一定排在 `:agentId/:sessionId` 之前；React Router specificity 决定优先级 |
| 修改 alarm icon 行为 / 样式 | `header/AlarmToggleButton.tsx` | mode 由父组件传入，不要在内部读 URL；badge 绝对定位、`relative` 锚点都在该文件内 Tailwind class 里 |
| 修改 jobs 列表行外观 | `jobs/JobRow.tsx` | 行高 ~56px；展开动画走 grid-rows `0fr↔1fr`，chevron `[&_svg]:rotate-180`；状态点用 `group/dot` + `group-hover/dot:scale-150`；tooltip 用 shadcn，JobsView 顶层挂 `TooltipProvider` |
| 修改 runs 列表行外观 | `jobs/RunRow.tsx` + `jobs/runStatusIcons.tsx` | 状态判断走 `getScheduledSessionDisplayState`，**不要**直接读 `runStatus`；row 用 `group/row` 控制 More 按钮淡入 |
| 加 schedule 模板 | `agent-editor/scheduleTemplates.ts` | NewScheduleButton 自动展示;不需要改 agent-side |
| 修改 JobRow body click 路由策略 (once vs cron 派发) | `JobsView.tsx#handleActivate` | 决策放在父组件,JobRow 只负责 `onActivate`;`runsByJob` map 同时供 once-job 直跳 latest run 用 |
| 修改菜单动作 (Edit / Run / Delete) | `jobs/JobRow.tsx` (展开面板内的 Edit/Run now/Delete 按钮) | 唯一入口;RunsHeader 不再承载 |
| 改 schedule run 菜单（Download / Delete only） | `jobs/RunRow.tsx` + `menu/ChatSessionDropdownMenu.tsx` + `states/chatSessionCommands.ts` + `overlay/DeleteOverlay.tsx` + `shared/ipc/chatSession.ts` | RunRow 必须传 `data-chat-session-menu-source="schedule"` 与 job id；下载走 `chatSessionApi.downloadScheduleRun`，删除走 `persistApi.deleteScheduleRun`，不能复用 regular API |
| 添加 `ScheduleWakeNotice` 类持久警告 | `JobsView.tsx` 顶部或空态 | 老 SchedulesContentView 的横幅没有迁移；如需可在 JobsView 顶部加一个紧凑 banner |

## 联动变更映射
| 变更内容 | 同时需要更新 |
|----------|-------------|
| jobs 路由形态变化 | `entries/main.routes.tsx` + `SessionPanel.tsx` + `AlarmToggleButton.tsx`（构造目标 URL）+ `showScheduledRunStartedToast.tsx`（toast 跳转目标）+ `GeneratedScheduleCards.tsx`（Manage / Run now 跳转） |
| `JobRunRow` schema 变化 | `shared/persist/types/index.ts` + `RunRow.tsx`（状态字段消费）+ `jobs/utils.ts`（`getScheduledSessionDisplayState`） |
| `SchedulerJob` schema 变化 | `shared/ipc/scheduler.ts` + `JobRow.tsx`（cron 描述 / 展开内的 `lastStartedAt` / tooltip）+ `jobs/utils.ts`（`describeSchedule` / `deriveJobRowStatus`） |
| 未读 badge 来源调整 | `lib/chat/useAgentUnreadSummary.ts` + `AlarmToggleButton.tsx` |
| 删除 schedule 时的回退路径 | `JobsView.tsx#handleDelete`(主入口,删完原地刷新);`JobRunsView.tsx` (job 不存在时 3s auto-redirect 到 `/agent/:agentId/job`) |

## 反模式
- **不要**给"当前是 sessions 还是 jobs"加 atom。URL 是真相，新 atom 只会带来同步 bug。
- **不要**写"按 sessionId 万能取" 的混查 helper（如 `Agent.getAnySession`）。regular 与 schedule_run 在 persist 层物理隔离，IPC / 调用方都可以从上下文区分（路由形态、`ChatView` 的 `kind` prop），没有任何场景需要混查。
- **不要**给 `ChatView` 加 `useMatch('/agent/:agentId/job/*')` 这类"自检 URL"逻辑。`kind` 必须由父级路由 `<Route element={<ChatView kind="..." />} />` 显式注入；ChatView 不读 URL 形态，只按 prop 路由 IPC。
- **不要**让 `RunRow` 触发的菜单走 `default` source —— 那会让 Star / Rename / Fork / Copy File Path 在 schedule run 上出现，与权威 `ChatSessionDropdownMenu` 的 schedule-only 菜单不一致。
- **不要**让 `JobsView` 与 `JobRunsView` 各自维护独立的 jobs 缓存。两者都直接消费 `useSchedulesByAgentId`，让 atom 增量通道（`persist:schedule:updated/removed/run:updated`）驱动刷新。
- **不要**重新引入 `ScheduleSidepaneAtom`、`SchedulesSidepane`、`AgentSchedulesTab`、`SchedulesContentView` 中任何一个 —— 已被本目录 + `/agent/:agentId/job` 路由完全取代。

## 验证步骤
1. 在某 agent 的 chat 视图下点击 alarm icon → URL 切到 `/agent/:agentId/job`，左侧切到 jobs 列表，右侧 ChatView 保持原 session。
2. 点击某 job 行 → URL `/agent/:agentId/job/:jobId`，左侧出现 runs 列表 + RunsHeader。
3. 点击 run → URL `/agent/:agentId/job/:jobId/:sessionId`，右侧 ChatView 渲染该会话；run 行高亮。
4. 在 runs 子屏点某条已结束 run 的 More → Delete，确认仅该 run 消失、job 仍在；若当前打开该 run，回退到 `/agent/:agentId/job/:jobId`。运行中的 run 删除应显示失败。
5. 在 jobs 子屏打开 run 后点 alarm：确认切到 `/agent/:agentId`，不带 run ID；重新打开该 run 仍通过 `/job/:jobId/:sessionId` 进入。
6. 切到另一个 agent → URL 自然回 `/agent/:newChatId`，左侧自动回 sessions 模式（无 `job` 段）。
7. 浏览器前进/后退跨越 jobs / sessions / settings 路由 → 一致渲染。
8. 直接访问 `/agent/:agentId/settings/schedules`（旧 deep link）→ redirect 到 `/agent/:agentId/job`。
9. 在 jobs 列表搜索 / 在 sessions 列表搜索：两个搜索框互不干扰，切换 mode 时各自的 query 保留。
10. assistant 输出 GeneratedScheduleCard：点 Manage → 跳 jobs 子屏；点 Run now → 出现 toast，点 toast 的 "Open schedule run" 跳到对应 run。

## 注意事项
- `SessionPanel` 在 URL 缺 agentId（`/agent` 根）时，header 仍渲染 `agentSessionCacheManager.getCurrentAgentId()` 的兜底名；body 显式不渲染。
- `AddScheduleOverlay` 同时挂在 JobsView 和 JobRunsView。两个 view 不会同时挂载（URL 互斥），所以两个 overlay 实例不会同时存在。
- `JobsView` 的搜索框是独立 `useState`，**不**与 `SessionsView` 的 search 共享 —— 这是有意为之，jobs 搜索语义与 sessions 搜索完全不同。
- `ChatSessionMenuAtom.toggle(agentId, sessionId, title, trigger)` 通过读取 `trigger.dataset.chatSessionMenuSource` 决定菜单语义。`RunRow` 必须同时设置 `data-chat-session-menu-source="schedule"` 和 `data-chat-session-menu-job-id`，使 Download / Delete 都携带 schedule run 的 owner 上下文。
- 新增 schedule run 状态（如 `cancelled`）时，`runStatusIcons.tsx` 与 `utils.ts#getScheduledSessionDisplayState` 一并扩。

## 相关文件
- 上层布局：[`pages/layout/`](../../pages/layout/ai.prompt.md)（`AgentLayoutContent` 引用本目录的 `SessionPanel`）
- 路由：[`entries/main.routes.tsx`](../../entries/main.routes.tsx)
- 聊天视图：[`components/chat/ai.prompt.md`](../chat/ai.prompt.md)（ChatView / GeneratedScheduleCards）
- Schedule 模板与 Add overlay：`components/chat/agent-editor/AddScheduleOverlay.tsx` / `scheduleTemplates.ts`
- 渲染端 atom：[`states/schedules.atom.ts`](../../states/schedules.atom.ts)、[`states/scheduleRuns.atom.ts`](../../states/scheduleRuns.atom.ts)、[`states/sessionIndex.atom.ts`](../../states/sessionIndex.atom.ts)
- IPC：[`shared/ipc/scheduler.ts`](../../../shared/ipc/scheduler.ts)、[`shared/ipc/persist.ts`](../../../shared/ipc/persist.ts)
- Persist 真值：[`ai.prompt/persist.md`](../../../../ai.prompt/persist.md) §6.3 / §9.1

## 未来优化候选
从 `job.md` 提炼，按价值/成本排（前面更值得动；状态以 2026-06-14 仓库现况为准）。

### 体验/可读性
1. **`describeSchedule` 不识别 monthly cron**：`0 9 1 * *` 在 `cronDescriptions.ts#describeCronExpression` 走 fallthrough，直接渲染原始 cron 串到 `JobRow` 副标题。weekly / weekdays / weekends 已支持，补 monthly（"每月 1 日 09:00" / "1st of each month 09:00"）即可。改动点：`src/renderer/lib/scheduler/cronDescriptions.ts`。
2. **`JobsView` 没有 wake-time 警告横幅**：老 `SchedulesContentView` 顶部有黄底"On-time runs require the app and machine to stay awake."提示，只在空态用 `<small>` 留了一句，有 jobs 的用户看不到。可在 `JobsView` 列表上方加紧凑可关闭信息条（关闭状态进 settings 或 localStorage）。
3. **`ScheduleTemplate` 加 per-template `icon`**：现 5 个模板下拉项都用 `Sparkles`，无视觉区分。建议 Daily Briefing→`Sun`、Weekly Standup→`CalendarDays`、Friday Retro→`Coffee`、Inbox Triage→`Mail`、Monthly Report→`FileText`。改动：`scheduleTemplates.ts` 类型加 `icon: LucideIcon` + `NewScheduleButton` 渲染。

### 接口/可读性（中成本）
4. **`AddScheduleOverlay` 935 行**：拆 `RecurringPresetEditor` / `OneTimeEditor` / `AgentPicker` 三个子组件；`buildCronExpression` / `parseCronExpression` 移到 `lib/scheduler/`。一次性投入 ~1h，后续改 schedule UI 都更省力。

### 性能（看实际使用）
5. **`useAgentScheduleRuns(agentId)` 全量取再 filter**：一个 agent 若有 N 个 jobs / M 个 runs，`JobRunsView` 每次 hydrate 都拉全量。可加 `listJobRuns(agentId, jobId)` IPC + atom 按 `(agentId, jobId)` 切片。涉及 `shared/ipc/persist` + `main/persist` + renderer atom 三处协变，等性能确实成问题再做。

### 测试基建（项目级决策）
6. **`agent-side/` 缺 `__tests__/`**：可立即给 `jobs/utils.ts` 4 个纯函数加 vitest（`getScheduledSessionDisplayState` / `describeSchedule` / `formatDateTime` / `formatRunTime` / `deriveJobRowStatus`），零依赖；React 组件单测需要先决定是否引入 RTL。

### 文案 / i18n
7. **模板 `message` 全英文**：项目当前无 i18n 框架。三个走向（先加 i18n 基建 / 提供中英双版模板 / 暂不动等用户 inline 改），按用户偏好定。
