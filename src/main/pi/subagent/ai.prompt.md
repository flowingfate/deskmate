<!-- Last verified: 2026-07-16 (Step 7：delegated-only submit_result 与 formal result reducer 已落盘) -->
# pi/subagent 模块 — Agent 委派运行时

> 普通 Agent 在父 session 中被委派执行一次任务的运行时边界。Sub-Agent 是运行角色，不是第二种配置实体。
> 当前已固定共享契约、未注册的顶层 cmdline facade、delegate-only execution context、parent-scoped subrun persist store，以及只挂在单次 delegated catalog 的正式结果提交；manager/session 尚未生产接线。

## 关键文件

| 文件 | 职责 | 规模 |
|---|---|---|
| `types.ts` | request/result 运行时归一化、policy 默认值与上限 | 小 |
| `../../lib/delegateExecutionScope.ts` | 仅在 delegated run 外层建立的 AsyncLocalStorage delegateId；Step 8 将使用 | 极小 |
| `../../../shared/persist/types/subrun.ts` | 所有会写入 `data.json` 的 Subrun ID/request/result/data union；经 `@shared/persist/types` 导入 | 中 |
| `../../persist/subrun.ts` | `@main/persist` 导出的 `Subrun` store：allocator/reservation、data/message persistence 与 `PersistSessionLike` | 大 |
| `commands/types.ts` | `SubAgentCommandRunner` 三方法 DI seam、result/rejected outcomes、list/describe 安全 view 与父 session scope | 中 |
| `commands/_shared.ts` | 三命令共享 help flags 与 `{ outcome }` 输出/exit 规则 | 小 |
| `commands/list.ts` / `describe.ts` / `run.ts` / `index.ts` | allowed delegates 列表、单 target 安全能力详情、委派执行、可扩展 registry/router | 中 |
| `submitResult.ts` | 未注册 `submit_result` tool、一次性 controller、formal result builder、未提交纯决策 | 中 |
| `../tools/subagent.ts` | 必须注入 runner 才能构造的 `createSubagentTool` 薄 facade；Step 3 未注册 | 极小 |

以下文件是后续步骤的规划边界，**当前尚未实现**：`prompt.ts`、`session.ts`、`manager.ts`。

## 架构

### 模块职责

- 表达父 session 向普通 Agent 发起一次委派的 request、正式 result 和运行状态；
- 依赖 delegate-only context 约束 delegated capability；负责显示提交与正式结果归并，后续再接通 subrun 生命周期和 orchestration；
- 通过 Pi turn loop 和 persist 的公开接口复用模型执行、消息桥接与持久化。
- 将 shell-style `list` / `describe` / `run` 输入交给显式注入的 runner；run 在执行前收敛成 normalized request；

### 非职责

- 不拥有 Agent 配置或 Agent graph；
- 不把 subrun 注册成 regular/job session；
- 不直接实现通用 LLM turn loop；
- 不读取、迁移或兼容旧 `sub-agents/` 数据。

### 依赖方向

```text
shared run contract
        ↑
appcmd infrastructure ← pi/subagent/commands → injected manager seam
        ↑                         ↓
delegate context → common tool/router/resource/MCP boundaries + main/persist（后续 Steps 6–9）
```

`src/main/lib/subAgent/` 仅作只读参考。新生产代码禁止 import 旧 manager、chat、旧 SubAgent 持久化类型或旧 `app subagent` command。

### 核心不变量

1. `SubrunId` 只在 `(profileId, parentAgentId, parentSessionId)` 内唯一；合法范围是 `001..999`，`000` 非法。
2. normal execution 没有 delegate context；只有 SubAgentSession 外层的 delegate context 影响 Knowledge/Skills/Tools，Local 始终用 parent context。
3. context 只有 `isolated` 和 `parent_summary`，不接受 full history。
4. request 的 target/task/expectedOutput 必填；policy 经唯一 normalizer 补默认并执行 max clamp。
5. result 和 runtime state 都是 discriminated union；terminal state 的 `status` 必须与 `result.status` 一致。
6. prompt 只能说明能力，真正的安全边界必须落在 scope-aware catalog、handler、router 与 MCP Auth。
7. command 只按稳定 Agent ID 委派；并行通过同一 assistant response 的多个独立 tool calls 表达，不提供 batch subcommand。
8. list/describe 必须复用与 run 相同的 delegates resolver；describe 不得输出 system prompt、outgoing graph 或其它 cold 配置。
9. facade 构造函数必须接收实现三个方法的真实 runner；`tools/index.ts` 在 Step 9 前不得注册 `subagent`。
10. 有共享基字段的 union 分支使用命名 `interface extends Base`；`type` 只负责聚合这些分支，不用 `type Variant = Base & {...}` 表达继承。
11. delegate context 存在时 catalog 仅排除交互式 `ask`；Step 9 注册真实 `subagent` 对象时加入同一黑名单，禁止嵌套委派。其它 LocalTool 保持普通能力。
12. Knowledge/Skill 在 delegate context 下选 delegateId；`web research` 与已知 shell device-auth 在执行边界拒绝，MCP OAuth 保持普通全局交互流。

### 当前公共契约

- persisted shared：`SubrunId`、`isSubrunId`、`parseSubrunId`、`formatSubrunId`、`SubAgentRunContext`、`SubAgentRunPolicy`、`SubAgentRunRequest`、`SubAgentRunUsage`、`SubAgentRunResult`、`SubrunDataFile`（均来自 `@shared/persist/types`）；runtime shared：`SubAgentRunStep`、`SubAgentRuntimeState`（来自 `@shared/types/subAgentRunTypes`）；
- persist：parent `Session.createSubrun/getSubrun/listSubruns` 与 `Subrun` 的 `PersistSessionLike`、`start()`、`finish(result)`；空 reservation/非法 ID/已终态转换均显式返回 union，不写 SQLite、files 或普通 session events；
- main private：`normalizeSubAgentRunRequest`、`SUB_AGENT_RUN_POLICY_LIMITS`；`SubAgentCommandRunner.listDelegates/describeDelegate/run`；各命令的 `result | rejected` outcome；list/describe 安全 view types；
- construction seam：`createSubAgentCommand(runner)` 与 `createSubagentTool(runner)`；两者未从 Pi root 导出，`tools/index.ts` 也未注册；
- execution seam：`DelegateExecutionContext`、`runWithDelegateExecution`、`getDelegateExecution`、`isDelegatedExecution`；Step 8 是唯一的 scope root；
- formal-result seam：`SubmitResultController`、`createSubmitResultTool(controller)`、`buildFormalResult(input)`、`decideMissingSubmit(input)`；`ToolCatalog.withSubmitResult(tool)` 是唯一私有路由，普通 catalog/global registry 均不可见。

## 常见变更

| 场景 | 必须同步 |
|---|---|
| 修改 request/context/policy | `types.ts`、顶层 command parser、persist request snapshot、manager、`refactor/unit-test.md` |
| 修改 result status/字段 | submit controller、subrun data union、tool result JSON、renderer card、IPC、累积测试计划 |
| 修改 runtime state/step | manager event sink、renderer IPC/card；key 始终保留完整 parent identity |
| 修改 `SubrunId` 规则 | allocator、persist 路径、IPC 参数、renderer 显示及测试候选 |
| 新增 delegated capability | 真实 handler/router/auth 执行点 + delegate context；不能只改 prompt，也不新增 policy facade |
| 修改 delegate context | `lib/delegateExecutionScope.ts`、Pi tool、Internal URL、appcmd、MCP Auth、所有下游 step 文档 |

## 注意事项

- `SubrunId` 是普通字符串语义名，禁止把 `001` 当全局 map key、日志 identity 或全局查询参数。
- request normalization 只处理已类型化输入；cmdline 的 flag/positional 解析先完成类型收窄，再调用唯一 normalizer。
- Step 1 不预建 result/usage/list 的通用 normalizer；真实不可信输入与权限边界由 Step 7 submit/result reducer 在单一入口校验。模型只能提交 completed/partial/blocked；runtime metadata、failed/cancelled 继续由 Step 8/9 生成。
- policy 默认 `maxTurns=25`；未显式给 timeout 时按每 turn 60 秒推导，最大 60 分钟。显式 `maxTurns` 最大 clamp 为 100，timeout 最大 clamp 为 60 分钟。
- 不为未来文件创建空壳、no-op 或 fake manager。
- `run` JSON 输出为 `{ outcome }`；顶层与 subcommand help 均提示通过同一 response 多次调用实现并行，manager 的共享 admission/allocator 必须并发安全。
- `list` 只消费 resolver hot records；`describe` 才按需读取一个 authorized AgentDetail，避免列表 fan-out，也避免泄漏 systemPrompt/delegates/subAgents/zero。
- normal Agent 不创建 AsyncLocalStorage context；Step 8 才在 delegated run root 建立 `{ delegateId }`。
- scope 不跨 IPC/worker/child process；所有授权判断必须在主进程 delegate run 链路内完成。

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
