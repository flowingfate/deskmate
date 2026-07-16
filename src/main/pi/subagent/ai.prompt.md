<!-- Last verified: 2026-07-16 (Step 3：未注册 cmdline facade 与 runner seam 已实现) -->
# pi/subagent 模块 — Agent 委派运行时

> 普通 Agent 在父 session 中被委派执行一次任务的运行时边界。Sub-Agent 是运行角色，不是第二种配置实体。
> 当前已固定共享契约、request normalization 与未注册的顶层 cmdline facade；manager、session、持久化尚未生产接线。

## 关键文件

| 文件 | 职责 | 规模 |
|---|---|---|
| `types.ts` | request/result 运行时归一化、policy 默认值与上限 | 小 |
| `../../../shared/types/subAgentRunTypes.ts` | main/IPC/renderer 共用的 request/result/state、三位 `SubrunId` helper | 中 |
| `commands/types.ts` | `SubAgentCommandRunner` 三方法 DI seam、result/rejected outcomes、list/describe 安全 view 与父 session scope | 中 |
| `commands/_shared.ts` | 三命令共享 help flags 与 `{ outcome }` 输出/exit 规则 | 小 |
| `commands/list.ts` / `describe.ts` / `run.ts` / `index.ts` | allowed delegates 列表、单 target 安全能力详情、委派执行、可扩展 registry/router | 中 |
| `../tools/subagent.ts` | 必须注入 runner 才能构造的 `createSubagentTool` 薄 facade；Step 3 未注册 | 极小 |

以下文件是后续步骤的规划边界，**当前尚未实现**：`policy.ts`、`prompt.ts`、`catalog.ts`、`submitResult.ts`、`subrunStore.ts`（或 persist adapter）、`session.ts`、`manager.ts`。

## 架构

### 模块职责

- 表达父 session 向普通 Agent 发起一次委派的 request、正式 result 和运行状态；
- 后续负责 reduced capability catalog、显式结果提交、subrun 生命周期和 orchestration；
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
        ↓
pi session/tool/internal-url + main/persist public subrun adapter（后续 Steps 4–9）
```

`src/main/lib/subAgent/` 仅作只读参考。新生产代码禁止 import 旧 manager、chat、旧 SubAgent 持久化类型或旧 `app subagent` command。

### 核心不变量

1. `SubrunId` 只在 `(profileId, parentAgentId, parentSessionId)` 内唯一；合法范围是 `001..999`，`000` 非法。
2. executor 是 `delegateAgentId`；父 session 的 owner 单独决定 `local://` 与 subrun 物理位置。
3. context 只有 `isolated` 和 `parent_summary`，不接受 full history。
4. request 的 target/task/expectedOutput 必填；policy 经唯一 normalizer 补默认并执行 max clamp。
5. result 和 runtime state 都是 discriminated union；terminal state 的 `status` 必须与 `result.status` 一致。
6. prompt 只能说明能力，真正的安全边界必须落在 catalog/router/dispatcher policy。
7. command 只按稳定 Agent ID 委派；并行通过同一 assistant response 的多个独立 tool calls 表达，不提供 batch subcommand。
8. list/describe 必须复用与 run 相同的 delegates resolver；describe 不得输出 system prompt、outgoing graph 或其它 cold 配置。
9. facade 构造函数必须接收实现三个方法的真实 runner；`tools/index.ts` 在 Step 9 前不得注册 `subagent`。
10. 有共享基字段的 union 分支使用命名 `interface extends Base`；`type` 只负责聚合这些分支，不用 `type Variant = Base & {...}` 表达继承。

### 当前公共契约

- shared：`SubrunId`、`isSubrunId`、`parseSubrunId`、`formatSubrunId`、`SubAgentRunContext`、`SubAgentRunPolicy`、`SubAgentRunRequest`、`SubAgentRunUsage`、`SubAgentRunResult`、`SubAgentRunStep`、`SubAgentRuntimeState`；
- main private：`normalizeSubAgentRunRequest`、`SUB_AGENT_RUN_POLICY_LIMITS`；`SubAgentCommandRunner.listDelegates/describeDelegate/run`；各命令的 `result | rejected` outcome；list/describe 安全 view types；
- construction seam：`createSubAgentCommand(runner)` 与 `createSubagentTool(runner)`；两者未从 Pi root 导出，`tools/index.ts` 也未注册。

## 常见变更

| 场景 | 必须同步 |
|---|---|
| 修改 request/context/policy | `types.ts`、顶层 command parser、persist request snapshot、manager、`refactor/unit-test.md` |
| 修改 result status/字段 | submit controller、subrun data union、tool result JSON、renderer card、IPC、累积测试计划 |
| 修改 runtime state/step | manager event sink、renderer IPC/card；key 始终保留完整 parent identity |
| 修改 `SubrunId` 规则 | allocator、persist 路径、IPC 参数、renderer 显示及测试候选 |
| 新增 delegated capability | `policy.ts` 与 catalog/dispatcher 同步；不能只改 prompt |

## 注意事项

- `SubrunId` 是普通字符串语义名，禁止把 `001` 当全局 map key、日志 identity 或全局查询参数。
- request normalization 只处理已类型化输入；cmdline 的 flag/positional 解析先完成类型收窄，再调用唯一 normalizer。
- Step 1 不预建 result/usage/list 的通用 normalizer；真实不可信输入与权限边界出现后，由 Step 7 的 submit/result reducer 在单一入口校验。
- policy 默认 `maxTurns=25`；未显式给 timeout 时按每 turn 60 秒推导，最大 60 分钟。显式 `maxTurns` 最大 clamp 为 100，timeout 最大 clamp 为 60 分钟。
- 不为未来文件创建空壳、no-op 或 fake manager。
- `run` JSON 输出为 `{ outcome }`；顶层与 subcommand help 均提示通过同一 response 多次调用实现并行，manager 的共享 admission/allocator 必须并发安全。
- `list` 只消费 resolver hot records；`describe` 才按需读取一个 authorized AgentDetail，避免列表 fan-out，也避免泄漏 systemPrompt/delegates/subAgents/zero。

## Co-Change Map

| 改动 | 协变模块 |
|---|---|
| shared request/result/state | `src/shared/types/subAgentRunTypes.ts`、本目录、未来 subrun persist type、未来 run IPC、renderer tool card |
| Agent graph / delegates | `src/shared/persist/types/agent.ts`、`src/main/persist/agent.ts`、prompt、manager authorization |
| session ownership | `pi/tools/types.ts`、internal URL resolve context、persist session adapter、本目录 policy/store |
| tool command grammar | `pi/subagent/commands/`、`pi/tools/subagent.ts`、renderer parser、tool-system 文档 |

## 相关文件

- 上层 Pi 架构：[`../ai.prompt.md`](../ai.prompt.md)
- turn loop：[`../../../../ai.prompt/agent-loop.md`](../../../../ai.prompt/agent-loop.md)
- 持久化架构：[`../../../../ai.prompt/persist.md`](../../../../ai.prompt/persist.md)
- 工具系统：[`../../../../ai.prompt/tool-system.md`](../../../../ai.prompt/tool-system.md)
- 重构共享契约：[`../../../../refactor/context.md`](../../../../refactor/context.md)
