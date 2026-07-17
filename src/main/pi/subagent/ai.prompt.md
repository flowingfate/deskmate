<!-- Last verified: 2026-07-17 (Subrun result/status maps simplified) -->
# pi/subagent 模块 — Agent 委派运行时

> 普通 Agent 在父 session 中被委派执行一次任务的运行时边界。Sub-Agent 是运行角色，不是第二种配置实体。
> 生产路径唯一为顶层 `subagent` tool → manager → persisted Subrun → `SubAgentSession`。

## 关键文件

| 文件 | 职责 | 规模 |
|---|---|---|
| `types.ts` | request/result 运行时归一化、policy 默认值与上限 | 小 |
| `../../lib/delegateExecutionScope.ts` | 仅在 delegated run 外层建立的 AsyncLocalStorage delegateId | 极小 |
| `../../../shared/persist/types/subrun.ts` | 所有会写入 `data.json` 的 Subrun ID/request/result/data union；经 `@shared/persist/types` 导入 | 中 |
| `../../persist/subrun.ts` | `@main/persist` 导出的 `Subrun` store：allocator/reservation、data/message persistence 与 `PersistSessionLike` | 大 |
| `commands/types.ts` | command scope、result/rejected outcomes、list/describe 安全 view types | 中 |
| `commands/_shared.ts` | 命令共享 help flags、整数校验与 `{ outcome }` 输出/exit 规则 | 小 |
| `commands/list.ts` / `describe.ts` / `run.ts` / `continue.ts` / `index.ts` | 目标发现、安全详情、新建委派、续聊已持久 subrun 与 registry/router | 中 |
| `submitResult.ts` | 未注册 `submit_result` tool、每次 execution 的一次性 controller、formal result builder、未提交纯决策 | 中 |
| `prompt.ts` | initial / continuation delegated execution contract，以及仅给 parent Regular/Job 追加的新 Agent graph guidance | 小 |
| `session.ts` | `SubAgentSession`：一个 active initial/continuation execution 的 BaseSession loop、scope、submit/result、transcript 与 progress callbacks | 大 |
| `runtimeState.ts` | 纯 runtime state construction/reducer/terminal projection；不保存 active state 或 listener | 中 |
| `manager.ts` | `SubAgentManager.forProfile(profile)` 返回唯一 profile-bound manager：授权、reservation、stale recovery、limits、timeout/cancel、active state；local subscribers 服务运行时，`subscribeStateUpdates()` 服务唯一 main IPC bridge | 大 |
| `../tools/subagent.ts` | 每次工具执行按 `ToolContext.profileId` 取得 active `Profile`；每个 Profile 只创建一次、由 WeakMap 缓存的 command facade，再以其 manager 执行 | 小 |

## 架构

### 模块职责

- 表达父 session 向普通 Agent 发起的初始委派与后续消息、正式 result 和运行状态；
- manager 复用 Agent graph resolver，持有授权、admission、timeout、cancel、stale running recovery 与 live-state；
- 通过 Pi `BaseSession` 复用模型循环、压缩、overflow、message bridge 与持久化，`Subrun` 是可继续 transcript/data 的唯一 owner；
- 将 shell-style `list` / `describe` / `run` / `continue` 输入交给真实 manager runner；所有 execution 在执行前由 command 归一化。

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

新生产代码只依赖当前 Pi、persist 与 Agent graph；磁盘上的历史 `sub-agents/` 数据不读、不迁移、不删除。

### 核心不变量

1. `SubrunId` 只在 `(profileId, parentAgentId, parentSessionId)` 内唯一；合法范围是 `001..999`，`000` 非法。
2. normal execution 没有 delegate context；只有 SubAgentSession 外层的 delegate context 影响 Knowledge/Skills/Tools，Local 始终用 parent context。
3. initial request 的 context 只有 `isolated` 和 `parent_summary`，continuation 只使用既有 subrun transcript 和显式 message，不接受 full parent history。
4. initial request 的 target/task/expectedOutput 必填；continuation message 必填；policy 经唯一 normalizer 补默认并执行 max clamp。
5. 磁盘首项 initial history 保存重建初始 request 所需的 message、expectedOutput、context 与 policy；后续每项都是 continuation。`Subrun` 直接以 request/execution/owner getter 暴露运行语义，不构造 owner-complete data-file 镜像。
6. 每个 history 对应一次 execution，状态变化原位更新最后一项；terminal history 的 result 去除重复 status、subrunId 和 delegateAgentId。`Subrun.result` 在需要时补回可信身份与 status，manager/IPC 统一投影 `SubAgentRuntimeState`。
7. prompt 只能说明能力，真正的安全边界必须落在 scope-aware catalog、handler、router 与 MCP Auth。
8. command 只按稳定 Agent ID 创建委派；`continue` 从 parent-owned subrun 取得 delegate 并重新授权。并行通过同一 assistant response 的多个独立 tool calls 表达，不提供 batch subcommand。
9. list/describe 必须复用与 run 相同的 delegates resolver；describe 不得输出 system prompt、outgoing graph 或其它 cold 配置。
10. facade 每次执行都必须以对应 `Profile` 取得 command facade；首次才调 `SubAgentManager.forProfile(profile)` 创建并 WeakMap 缓存，后续不能在每次 tool call 新建 registry/router。Profile 选择是 tool/IPC 边界职责，manager 不重复校验 `profileId`；RegularSession/JobRun 只在 catalog 实际含 `subagent` 时追加 Agent graph guidance。
11. shared contract 只导出消费方需要的聚合判别联合；正式结果的逐状态分支通过显式 `SubAgentRunResultByStatus[Status]` 读取，persisted terminal history 与 runtime terminal state 复用同一份 status→data 映射，不使用 `Extract` / `Omit` 等二次变换。
12. delegate context 存在时 catalog 排除交互式 `ask` 与真实 `subagent` LocalTool 对象，禁止嵌套；其它 LocalTool 保持普通能力。
13. Knowledge/Skill 在 delegate context 下选 delegateId；`web research` 与已知 shell device-auth 在执行边界拒绝，MCP OAuth 保持普通全局交互流。
### 当前公共契约

- persisted shared：`PersistSubrunDataFile`、`PersistSubrunHistory`、canonical `SubrunExecution`、`SubrunId` 与 request/result contracts；`SubAgentRunResult` 是唯一正式结果联合，`SubAgentRunResultByStatus` 提供显式逐状态索引。旧 `Pending/Running/TerminalSubrunDataFile` 和逐状态 result/history 接口已删除。runtime shared：`SubAgentRunStep`、`SubAgentRuntimeState`（来自 `@shared/types/subAgentRunTypes`），terminal state 直接按 status 索引正式结果映射；
- persist：parent `Session.createSubrun/getSubrun/listSubruns` 与 `Subrun` 的 `PersistSessionLike`、明确运行 getter、`start()`、`continueConversation(execution)`、`finish(result)`；v1 磁盘 histories 首项为 initial，每次 continuation 追加一项，当前状态原位替换最后一项。terminal result 只存未来重载需要的 payload/usage/deliverables/warnings，不重复 identity/status。磁盘形态只信任当前 writer，不迁移或校验旧 current-snapshot v1 数据；
- manager：`SubAgentManager.forProfile(profile)` 是唯一生产 construction；每个 `Profile` 只有一个 WeakMap 管理的 lifecycle owner，内部 map key 仅为 parent Agent/session。`run()` 与 `continueRun()` 共用 `admitExecution()`，在同一短锁内统一 stale recovery、active gate 与 active registration；分支 callback 只负责 reservation/create 或 terminal→running 状态转换。max parallel=5、persisted subrun total=20，continuation 不增加 total；
- runtime state：`runtimeState.ts` 直接从 `Subrun` getter 投影 state，不经过 data-file snapshot；profile-bound manager 持有有界 active snapshot 与 listener，重载也返回同一个 `SubAgentRuntimeState` union。无 active entry 的 stale `running` 由 manager 将最后一项写为 interrupted failed；
- construction：commands 与 `createSubAgentCommand(manager)` 直接接收真实 `SubAgentManager`；`tools/subagent.ts` 以 `WeakMap<Profile, AppCommand>` 缓存每个 Profile 的 immutable command facade，只复用 cmdline parse/dispatch/format；同一 `LocalTool` 对象加入 delegated catalog blacklist；
- formal-result seam：`SubmitResultController`、`createSubmitResultTool(controller)`、`buildFormalResult(input)`、`decideMissingSubmit(input)`；`ToolCatalog.withSubmitResult(tool)` 是唯一私有路由，普通 catalog/global registry 均不可见。
- session seam：`SubAgentSession({ subrun, signal, parentTracer?, callbacks? })`，`run()` 返回 `{ kind:'result', result } | { kind:'not_pending', status }`。它在最外层建立 delegate scope，使用执行 Agent config/catalog/prompt，局部收集 usage/deliverables；initial 未提交时只追加/flush 一条真实 reminder user message 后再跑一次完整 turn，continuation 则在首条 user message 末尾预附同一 reminder，并直接消耗该 execution 的一次提醒额度。
- IPC：`subagentRun` 的 query/cancel 都先沿 active Profile → parent Agent → parent Session → Subrun 解析；`getRunState` 返回 manager 的 `SubAgentRuntimeState`，与 live `stateUpdate` 共用唯一模型；`getRunMessages` 仅在 renderer Dialog 打开后调用 `Subrun.loadDomainMessages()` 并返回同 owner 的 Domain `Message[]`。renderer 以完整 profile/parent identity + correlation 关联 live card，final tool result/runtime state 是终态事实。

## 常见变更

| 场景 | 必须同步 |
|---|---|
| 修改 request/context/policy | `types.ts`、顶层 command parser、persist request snapshot、manager 与相关测试 |
| 修改 result status/字段 | submit controller、subrun data union、tool result JSON、renderer card、IPC、累积测试计划 |
| 修改 runtime state/step | manager event sink、renderer IPC/card；key 始终保留完整 parent identity |
| 修改 `SubrunId` 规则 | allocator、persist 路径、IPC 参数、renderer 显示及测试候选 |
| 新增 delegated capability | 真实 handler/router/auth 执行点 + delegate context；不能只改 prompt，也不新增 policy facade |
| 修改 delegate context | `lib/delegateExecutionScope.ts`、Pi tool、Internal URL、appcmd、MCP Auth 与相关模块文档 |
| 修改 runtime card / IPC | `shared/ipc/subagentRun.ts`、startup/preload/renderer bridge、`tool/renderers/subagent/`；所有 query/cancel 先验证 parent ownership，messages 只在 Dialog lazy load，state 不得以裸 subrunId 或裸 correlationId 关联 |

## 注意事项

- `SubrunId` 是普通字符串语义名，禁止把 `001` 当全局 map key、日志 identity 或全局查询参数。
- request/continuation normalization 只处理已类型化输入；cmdline 的 flag/positional 解析先完成类型收窄，再调用唯一 normalizer。
- 不预建 result/usage/list 的通用 normalizer；真实不可信输入与权限边界由 submit/result reducer 在单一入口校验。模型只能提交 completed/partial/blocked；runtime metadata、failed/cancelled 由 session/manager 生成。
- policy 默认 `maxTurns=25`；未显式给 timeout 时按每 turn 60 秒推导，最大 60 分钟。显式 `maxTurns` 最大 clamp 为 100，timeout 最大 clamp 为 60 分钟。
- 不创建空壳、no-op 或 fake manager。
- `run` 与 `continue` JSON 输出均为 `{ outcome }`；同一 subrun 的 concurrent continuation 必须由 manager 短锁收敛为一次 execution。
- `list` 只消费 resolver hot records；`describe` 才按需读取一个 authorized AgentDetail，避免列表 fan-out，也避免泄漏 systemPrompt/delegates/zero。
- normal Agent 不创建 AsyncLocalStorage context；只有 SubAgentSession 建立 `{ delegateId }`。
- scope 不跨 IPC/worker/child process；所有授权判断必须在主进程 delegate run 链路内完成。
- `SubAgentSession` 不读取 parent history；`parent_summary` 只以明确“不可信参考”提示包入 initial delegated prompt。continuation 从自身 persisted transcript 恢复，将显式 message 与 `submit_result` system reminder 合并为一条 user message；manager 才拥有 timer、cancel、state 与 recovery。
- parent `AbortSignal` 在 execution active 后立即监听；initial 在 `Subrun.start()` 后、continuation 在 `continueConversation()` 后建立 listener，只在关键边界收敛取消。
- `SubAgentManager` 不可全局单例：它持有 active runs、locks 与 listeners，必须通过 `SubAgentManager.forProfile(profile)` 绑定 Profile；不得按 profileId 建普通 `Map`，避免已 evict Profile 的运行态被长期保留。
- 通用 `buildSystemPrompt()` 不读取 legacy/new delegates，也不指导委派。未来只有需要 delegation 的父 BaseSession 子类可在其通用 prompt 后显式追加基于新 Agent graph 的 guidance；SubAgentSession 永不追加。

## Co-Change Map

| 改动 | 协变模块 |
|---|---|
| persisted request/result/data | `src/shared/persist/types/subrun.ts` 的唯一磁盘 schema、main persist `Subrun` getter、本目录 runtime projection、run IPC、renderer tool card；runtime state/step 在 `src/shared/types/subAgentRunTypes.ts` |
| Agent graph / delegates | `src/shared/persist/types/agent.ts`、`src/main/persist/agent.ts`、prompt、manager authorization |
| session ownership | `pi/tools/types.ts`、internal URL resolve context、persist session adapter、本目录 policy/store |
| tool command grammar | `pi/subagent/commands/`、`pi/tools/subagent.ts`、renderer parser、tool-system 文档 |

## 相关文件

- 上层 Pi 架构：[`../ai.prompt.md`](../ai.prompt.md)
- turn loop：[`../../../../ai.prompt/agent-loop.md`](../../../../ai.prompt/agent-loop.md)
- 持久化架构：[`../../../../ai.prompt/persist.md`](../../../../ai.prompt/persist.md)
- 工具系统：[`../../../../ai.prompt/tool-system.md`](../../../../ai.prompt/tool-system.md)
