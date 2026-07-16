<!-- Last verified: 2026-07-16 (Step 11：subagentRun audit/cancel/state IPC 已接入) -->
# pi/subagent 模块 — Agent 委派运行时

> 普通 Agent 在父 session 中被委派执行一次任务的运行时边界。Sub-Agent 是运行角色，不是第二种配置实体。
> 生产路径已由顶层 `subagent` tool → manager → persisted Subrun → `SubAgentSession` 构成；旧 `lib/subAgent` 与 `app subagent` backend 已删除。

## 关键文件

| 文件 | 职责 | 规模 |
|---|---|---|
| `types.ts` | request/result 运行时归一化、policy 默认值与上限 | 小 |
| `../../lib/delegateExecutionScope.ts` | 仅在 delegated run 外层建立的 AsyncLocalStorage delegateId；Step 8 将使用 | 极小 |
| `../../../shared/persist/types/subrun.ts` | 所有会写入 `data.json` 的 Subrun ID/request/result/data union；经 `@shared/persist/types` 导入 | 中 |
| `../../persist/subrun.ts` | `@main/persist` 导出的 `Subrun` store：allocator/reservation、data/message persistence 与 `PersistSessionLike` | 大 |
| `commands/types.ts` | command scope、result/rejected outcomes、list/describe 安全 view types | 中 |
| `commands/_shared.ts` | 三命令共享 help flags 与 `{ outcome }` 输出/exit 规则 | 小 |
| `commands/list.ts` / `describe.ts` / `run.ts` / `index.ts` | allowed delegates 列表、单 target 安全能力详情、委派执行、可扩展 registry/router | 中 |
| `submitResult.ts` | 未注册 `submit_result` tool、一次性 controller、formal result builder、未提交纯决策 | 中 |
| `prompt.ts` | delegated run contract，以及仅给 parent Regular/Job 追加的新 Agent graph guidance | 小 |
| `session.ts` | `SubAgentSession`：单个 pending Subrun 的 BaseSession loop、scope、submit/result、transcript 与 progress callbacks | 大 |
| `runtimeState.ts` | 纯 runtime state construction/reducer/terminal projection；不保存 active state 或 listener | 中 |
| `manager.ts` | `SubAgentManager.forProfile(profile)` 返回唯一 profile-bound manager：授权、reservation、stale recovery、limits、timeout/cancel、active state；local subscribers 服务运行时，`subscribeStateUpdates()` 服务唯一 main IPC bridge | 大 |
| `../tools/subagent.ts` | 每次工具执行按 `ToolContext.profileId` 取得 active `Profile`；每个 Profile 只创建一次、由 WeakMap 缓存的 command facade，再以其 manager 执行 | 小 |

## 架构

### 模块职责

- 表达父 session 向普通 Agent 发起一次委派的 request、正式 result 和运行状态；
- manager 复用 Agent graph resolver，持有授权、admission、timeout、cancel、stale running recovery 与 live-state；
- 通过 Pi `BaseSession` 复用模型循环、压缩、overflow、message bridge 与持久化，`Subrun` 是唯一 transcript/data owner；
- 将 shell-style `list` / `describe` / `run` 输入交给真实 manager runner；run 在执行前已由 command 归一化。

### 非职责

- 不拥有 Agent 配置或 Agent graph；
- 不把 subrun 注册成 regular/job session；
- 不直接实现通用 LLM turn loop；
- 不读取、迁移或兼容旧 `sub-agents/` 数据。

### 依赖方向

shared run contract
        ↑
appcmd infrastructure ← pi/subagent/commands ← manager → persist Session/Subrun
        ↑                         ↓
tools/subagent facade → LocalTool registry → parent RegularSession/JobRun

新生产代码不得依赖旧 Sub-Agent backend、旧 app command 或旧配置数据；磁盘上的旧 `sub-agents/` 数据不读、不迁移、不删除。

### 核心不变量

1. `SubrunId` 只在 `(profileId, parentAgentId, parentSessionId)` 内唯一；合法范围是 `001..999`，`000` 非法。
2. normal execution 没有 delegate context；只有 SubAgentSession 外层的 delegate context 影响 Knowledge/Skills/Tools，Local 始终用 parent context。
3. context 只有 `isolated` 和 `parent_summary`，不接受 full history。
4. request 的 target/task/expectedOutput 必填；policy 经唯一 normalizer 补默认并执行 max clamp。
5. result 和 runtime state 都是 discriminated union；terminal state 的 `status` 必须与 `result.status` 一致。
6. prompt 只能说明能力，真正的安全边界必须落在 scope-aware catalog、handler、router 与 MCP Auth。
7. command 只按稳定 Agent ID 委派；并行通过同一 assistant response 的多个独立 tool calls 表达，不提供 batch subcommand。
8. list/describe 必须复用与 run 相同的 delegates resolver；describe 不得输出 system prompt、outgoing graph 或其它 cold 配置。
9. facade 每次执行都必须以对应 `Profile` 取得 command facade；首次才调 `SubAgentManager.forProfile(profile)` 创建并 WeakMap 缓存，后续不能在每次 tool call 新建 registry/router。Profile 选择是 tool/IPC 边界职责，manager 不重复校验 `profileId`；RegularSession/JobRun 只在 catalog 实际含 `subagent` 时追加 Agent graph guidance。
10. 有共享基字段的 union 分支使用命名 `interface extends Base`；`type` 只负责聚合这些分支，不用 `type Variant = Base & {...}` 表达继承。
11. delegate context 存在时 catalog 排除交互式 `ask` 与真实 `subagent` LocalTool 对象，禁止嵌套；其它 LocalTool 保持普通能力。
12. Knowledge/Skill 在 delegate context 下选 delegateId；`web research` 与已知 shell device-auth 在执行边界拒绝，MCP OAuth 保持普通全局交互流。
### 当前公共契约

- persisted shared：`SubrunId`、`isSubrunId`、`parseSubrunId`、`formatSubrunId`、`SubAgentRunContext`、`SubAgentRunPolicy`、`SubAgentRunRequest`、`SubAgentRunUsage`、`SubAgentRunResult`、`SubrunDataFile`（均来自 `@shared/persist/types`）；runtime shared：`SubAgentRunStep`、`SubAgentRuntimeState`（来自 `@shared/types/subAgentRunTypes`）；
- persist：parent `Session.createSubrun/getSubrun/listSubruns` 与 `Subrun` 的 `PersistSessionLike`、`start()`、`finish(result)`；空 reservation/非法 ID/已终态转换均显式返回 union，不写 SQLite、files 或普通 session events；
- manager：`SubAgentManager.forProfile(profile)` 是唯一生产 construction；每个 `Profile` 只有一个 WeakMap 管理的 lifecycle owner，内部 map key 仅为 parent Agent/session。manager 信任调用方已通过 Profile 选择边界，`profileId` 只随 `SubAgentRuntimeState`、日志与对外 parent identity 传递。`cancelRun({ profileId,parentAgentId,parentSessionId,subrunId })`、`cancelByParentSession(parent)`、`subscribe(listener)`、`getRuntimeState(key)` 都保留完整参数契约。短锁用 `Promise.withResolvers()` 串行单次 `listSubruns → recovery → total gate → reservation → active registration`，max parallel=5、persisted total=20；已中止的 parent signal 在 session 创建前也会转发到实际 abortor；
- runtime state：`runtimeState.ts` 只包含纯 state projection/reducer；profile-bound manager 持有有界 active snapshot 与 listener，terminal 从 `SubrunDataFile` 重新派生；无 active entry 的 stale `running` 由 manager 写为 interrupted failed；
- construction：commands 与 `createSubAgentCommand(manager)` 直接接收真实 `SubAgentManager`；`tools/subagent.ts` 以 `WeakMap<Profile, AppCommand>` 缓存每个 Profile 的 immutable command facade，只复用 cmdline parse/dispatch/format；同一 `LocalTool` 对象加入 delegated catalog blacklist；
- formal-result seam：`SubmitResultController`、`createSubmitResultTool(controller)`、`buildFormalResult(input)`、`decideMissingSubmit(input)`；`ToolCatalog.withSubmitResult(tool)` 是唯一私有路由，普通 catalog/global registry 均不可见。
- session seam：`SubAgentSession({ subrun, signal, parentTracer?, callbacks? })`，`run()` 返回 `{ kind:'result', result } | { kind:'not_pending', status }`。它在最外层建立 delegate scope，使用执行 Agent config/catalog/prompt，局部收集 usage/deliverables；每次调用 BaseSession 都是完整、自然结束的 ReAct user turn，未提交时只追加/flush 一条真实 reminder user message 后再跑一次完整 turn。
- Step 11 IPC：`subagentRun` 的 query/cancel 都先沿 active Profile → parent Agent → parent Session → Subrun 解析；metadata 只返回 `SubrunDataFile`，不读 messages。manager 的 process-level state subscription 转发所有 profile-bound manager event；renderer 以完整 profile/parent identity + correlation 关联 live card，final tool result/persisted data 是终态事实。

## 常见变更

| 场景 | 必须同步 |
|---|---|
| 修改 request/context/policy | `types.ts`、顶层 command parser、persist request snapshot、manager、`refactor/unit-test.md` |
| 修改 result status/字段 | submit controller、subrun data union、tool result JSON、renderer card、IPC、累积测试计划 |
| 修改 runtime state/step | manager event sink、renderer IPC/card；key 始终保留完整 parent identity |
| 修改 `SubrunId` 规则 | allocator、persist 路径、IPC 参数、renderer 显示及测试候选 |
| 新增 delegated capability | 真实 handler/router/auth 执行点 + delegate context；不能只改 prompt，也不新增 policy facade |
| 修改 delegate context | `lib/delegateExecutionScope.ts`、Pi tool、Internal URL、appcmd、MCP Auth、所有下游 step 文档 |
| 修改 runtime card / IPC | `shared/ipc/subagentRun.ts`、startup/preload/renderer bridge、`tool/renderers/subagent/`；query/cancel 先验证 parent ownership，state 不得以裸 subrunId 或裸 correlationId 关联 |

## 注意事项

- `SubrunId` 是普通字符串语义名，禁止把 `001` 当全局 map key、日志 identity 或全局查询参数。
- request normalization 只处理已类型化输入；cmdline 的 flag/positional 解析先完成类型收窄，再调用唯一 normalizer。
- Step 1 不预建 result/usage/list 的通用 normalizer；真实不可信输入与权限边界由 Step 7 submit/result reducer 在单一入口校验。模型只能提交 completed/partial/blocked；runtime metadata、failed/cancelled 继续由 Step 8/9 生成。
- policy 默认 `maxTurns=25`；未显式给 timeout 时按每 turn 60 秒推导，最大 60 分钟。显式 `maxTurns` 最大 clamp 为 100，timeout 最大 clamp 为 60 分钟。
- 不为未来文件创建空壳、no-op 或 fake manager。
- `run` JSON 输出为 `{ outcome }`；顶层与 subcommand help 均提示通过同一 response 多次调用实现并行，manager 的共享 admission/allocator 必须并发安全。
- `list` 只消费 resolver hot records；`describe` 才按需读取一个 authorized AgentDetail，避免列表 fan-out，也避免泄漏 systemPrompt/delegates/zero。
- normal Agent 不创建 AsyncLocalStorage context；只有 SubAgentSession 建立 `{ delegateId }`。
- scope 不跨 IPC/worker/child process；所有授权判断必须在主进程 delegate run 链路内完成。
- `SubAgentSession` 不读取 parent history；`parent_summary` 只以明确“不可信参考”提示包入 delegated prompt。manager 才拥有 timer、cancel、state 与 recovery。
- parent `AbortSignal` 在 `Subrun.start()` 后立即监听；只在关键边界收敛取消：启动前、写 turn metadata 后，以及每个完整 BaseSession ReAct turn 的前后。listener 在 loop 内直接 abort current controller；不要在每个 await 后重复检查。
- `SubAgentManager` 不可全局单例：它持有 active runs、locks 与 listeners，必须通过 `SubAgentManager.forProfile(profile)` 绑定 Profile；不得按 profileId 建普通 `Map`，避免已 evict Profile 的运行态被长期保留。
- 通用 `buildSystemPrompt()` 不读取 legacy/new delegates，也不指导委派。未来只有需要 delegation 的父 BaseSession 子类可在其通用 prompt 后显式追加基于新 Agent graph 的 guidance；SubAgentSession 永不追加。

## Co-Change Map

| 改动 | 协变模块 |
|---|---|
| persisted request/result/data | `src/shared/persist/types/subrun.ts`、本目录、main persist store、future run IPC、renderer tool card；runtime state/step 仍在 `src/shared/types/subAgentRunTypes.ts` |
| Agent graph / delegates | `src/shared/persist/types/agent.ts`、`src/main/persist/agent.ts`、prompt、manager authorization |
| session ownership | `pi/tools/types.ts`、internal URL resolve context、persist session adapter、本目录 policy/store |
| tool command grammar | `pi/subagent/commands/`、`pi/tools/subagent.ts`、renderer parser、tool-system 文档 |

## 相关文件

- 上层 Pi 架构：[`../ai.prompt.md`](../ai.prompt.md)
- turn loop：[`../../../../ai.prompt/agent-loop.md`](../../../../ai.prompt/agent-loop.md)
- 持久化架构：[`../../../../ai.prompt/persist.md`](../../../../ai.prompt/persist.md)
- 工具系统：[`../../../../ai.prompt/tool-system.md`](../../../../ai.prompt/tool-system.md)
- 重构共享契约：[`../../../../refactor/context.md`](../../../../refactor/context.md)
