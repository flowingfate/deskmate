<!-- Last verified: 2026-07-16 -->
# pi/subagent 模块 — Agent 委派运行时

> 普通 Agent 在父 session 中被委派执行一次任务的运行时边界。Sub-Agent 是运行角色，不是第二种配置实体。
> 当前 Step 1 只固化共享契约和归一化；manager、session、持久化和工具尚未生产接线。

## 关键文件

| 文件 | 职责 | 规模 |
|---|---|---|
| `types.ts` | request/result 运行时归一化、policy 默认值与上限 | 小 |
| `../../../shared/types/subAgentRunTypes.ts` | main/IPC/renderer 共用的 request/result/state、三位 `SubrunId` helper | 中 |

以下文件是后续步骤的规划边界，**当前尚未实现**：`policy.ts`、`prompt.ts`、`catalog.ts`、`submitResult.ts`、`subrunStore.ts`（或 persist adapter）、`session.ts`、`manager.ts`、`commands/`。

## 架构

### 模块职责

- 表达父 session 向普通 Agent 发起一次委派的 request、正式 result 和运行状态；
- 后续负责 reduced capability catalog、显式结果提交、subrun 生命周期和 orchestration；
- 通过 Pi turn loop 和 persist 的公开接口复用模型执行、消息桥接与持久化。

### 非职责

- 不拥有 Agent 配置或 Agent graph；
- 不把 subrun 注册成 regular/job session；
- 不直接实现通用 LLM turn loop；
- 不读取、迁移或兼容旧 `sub-agents/` 数据。

### 依赖方向

```text
shared run contract
        ↑
pi/subagent → pi session/tool/internal-url public seams
        ↓
main/persist public subrun adapter（后续 Step 6）
```

`src/main/lib/subAgent/` 仅作只读参考。新生产代码禁止 import 旧 manager、chat、旧 SubAgent 持久化类型或旧 `app subagent` command。

### 核心不变量

1. `SubrunId` 只在 `(profileId, parentAgentId, parentSessionId)` 内唯一；合法范围是 `001..999`，`000` 非法。
2. executor 是 `delegateAgentId`；父 session 的 owner 单独决定 `local://` 与 subrun 物理位置。
3. context 只有 `isolated` 和 `parent_summary`，不接受 full history。
4. request 的 target/task/expectedOutput 必填；policy 经唯一 normalizer 补默认并执行 max clamp。
5. result 和 runtime state 都是 discriminated union；terminal state 的 `status` 必须与 `result.status` 一致。
6. prompt 只能说明能力，真正的安全边界必须落在 catalog/router/dispatcher policy。
7. 有共享基字段的 union 分支使用命名 `interface extends Base`；`type` 只负责聚合这些分支，不用 `type Variant = Base & {...}` 表达继承。

### 当前公共契约

- shared：`SubrunId`、`isSubrunId`、`parseSubrunId`、`formatSubrunId`、`SubAgentRunContext`、`SubAgentRunPolicy`、`SubAgentRunRequest`、`SubAgentRunUsage`、`SubAgentRunResult`、`SubAgentRunStep`、`SubAgentRuntimeState`；
- main private：`normalizeSubAgentRunRequest`、`SUB_AGENT_RUN_POLICY_LIMITS`；
- `src/main/pi/index.ts` 当前不导出任何 subagent 符号：尚无 pi 子树外真实调用方。

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
- request normalization 只处理已类型化输入；Step 3 解析 JSON cmdline 时必须先用显式 JSON type guard 收窄，不能把不可信输入强转为业务类型。
- Step 1 不预建 result/usage/list 的通用 normalizer；真实不可信输入与权限边界出现后，由 Step 7 的 submit/result reducer 在单一入口校验。
- policy 默认 `maxTurns=25`；未显式给 timeout 时按每 turn 60 秒推导，最大 60 分钟。显式 `maxTurns` 最大 clamp 为 100，timeout 最大 clamp 为 60 分钟。
- 不为未来文件创建空壳、no-op 或 fake manager。

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
