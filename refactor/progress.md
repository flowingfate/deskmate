# Agent / Sub-Agent 统一重构进度

<!-- Last updated: 2026-07-16 -->

## 当前状态

- 总体阶段：**第二轮规划已重写，尚未开始生产代码**
- 当前门禁：等待用户 review 新的总体方案与 Step 1
- 业务步骤：0 / 13 complete
- 测试步骤：Step 14 尚未开始
- 生产代码变更：无
- 共享契约：`refactor/context.md`
- 累积单测方案：`refactor/unit-test.md`

## 为什么第一版规划失效

用户 review 指出第一版 step 过短、缺少上下游输出关系，并给出新的架构决策。第一版以下内容已经废弃：

- ULID subrun ID；
- `app subagent` 作为生产入口；
- 旧数据迁移和 migration journal；
- 新 runtime 继续围绕旧 `lib/subAgent` 演进；
- 每 step 立即新增/运行单测或执行端到端 smoke；
- 本次必须物理删除所有旧参考源码。

新计划以 `context.md` 2026-07-16 第二轮决策为准。

## 状态定义

| 状态 | 含义 |
|---|---|
| `pending` | 计划有效，前置尚未完成或尚未开始 |
| `reviewing-plan` | 当前 session 正在根据仓库和用户反馈 review/改写计划，不能改生产代码 |
| `needs-replan` | 上游决策已变化，本 step 内容失效；更新前禁止执行 |
| `in-progress` | 计划已 review，正在写生产代码 |
| `blocked-for-user-test` | 只有运行/人工验证才能继续，按用户要求停止等待 |
| `awaiting-review` | 代码、静态检查、文档、unit-test.md 已更新，等待用户 review |
| `complete` | 用户已 review 通过 |
| `deferred` | 用户明确决定后置，不阻塞核心目标（当前仅 Step 12 可用） |

## 14 Step 总览与输入/输出

| Step | 计划 | 状态 | 读取的上游产物 | 向下游交付的稳定产物 |
|---:|---|---|---|---|
| 1 | [目标契约与 Pi/Subagent 边界](step1.md) | pending | `context.md` | shared request/result/state types；`pi/subagent` 依赖规则与 public surface |
| 2 | [Agent description/delegates 持久化](step2.md) | pending | Step 1 AgentId/contract | 可落盘的 Agent graph、ID resolver、IPC patch |
| 3 | [独立顶层 subagent cmdline facade](step3.md) | pending | Step 1 request grammar | 未注册的新 facade/registry/run parser，供 Step 9 接 manager |
| 4 | [执行 Agent 与 Session owner 分离](step4.md) | pending | Step 1 execution scope | Tool/Internal URL 可表达 own knowledge + parent local |
| 5 | [委派能力 policy 与 reduced catalog](step5.md) | pending | Steps 2–4 | 硬 allow/deny policy、可构建 delegated catalog |
| 6 | [三位序号 Subrun 持久化](step6.md) | pending | Steps 1,2,4 | `001..999` allocator、data/messages store、persist adapter |
| 7 | [submit_result 与正式结果状态机](step7.md) | pending | Steps 1,5 | delegated-only submit route、terminal result reducer |
| 8 | [BaseSession 驱动的新 SubagentSession](step8.md) | pending | Steps 2,4,5,6,7 | 可执行单个 persisted delegated run 的 session |
| 9 | [Manager、顶层工具接线与主进程 cutover](step9.md) | pending | Steps 3,6,8 | production `subagent` tool、limits/cancel/state；旧 app command 下线 |
| 10 | [Agent Delegation 配置 UI](step10.md) | pending | Step 2 | description/delegates UI；独立 Sub-Agent 管理入口下线 |
| 11 | [委派运行卡片与 audit/cancel IPC](step11.md) | pending | Steps 6,7,9 | reload-safe card、live state、single cancel、run metadata query |
| 12 | [可选 Messages Dialog](step12.md) | pending | Step 11 review | 可实现则交付 Dialog；否则交付 verified deferred design 并标 deferred |
| 13 | [生产入口收口与文档一致性](step13.md) | pending | Steps 9–12 | 新路径唯一生效；旧源码只读隔离；全局文档更新 |
| 14 | [统一编写单元测试](step14.md) | pending | Steps 1–13 + `unit-test.md` | 用户确认后的新单测与测试执行记录；仍无 E2E |

## 关键路径

```text
1 → 2 ───────┐
│   └→ 10    │
├→ 3 ────────┼→ 9 ─→ 11 ─→ 12? ─→ 13 ─→ 14
└→ 4 → 5 → 7 │
    └────→ 6 → 8 ┘
```

- Step 3 只建立 facade/grammar，不注册空壳工具；Step 9 才与 manager 一次接通并生产注册。
- Step 6 先给出真实 persist adapter，Step 8 才能避免临时内存 transcript。
- Step 7 先固定正式终态，Step 8 才能正确设计 session stop condition。
- Step 10 可在 Step 2 后独立实现，但按 review 顺序仍排在后端 cutover 后，降低中间态心智负担。
- Step 12 是唯一可 deferred 的业务 step，不阻塞核心 runtime。
- Step 14 之前不新增单元测试文件；每步只更新 `unit-test.md`。

## 动态更新规则

### 每次用户 review 后

1. 把新意见写入本文件“决策变更日志”；
2. 更新 `context.md`；
3. 标出所有受影响 downstream steps；
4. 在同一个 session 内改完所有这些 step 文档；
5. 同步删改 `unit-test.md` 中失效测试候选；
6. 在依赖图重新一致之前，不开始下一步代码。

### 每个 Step 完成后

- 将该 step 置为 `awaiting-review`；
- 记录实际 exports、文件、静态验证和未验证行为；
- 更新下一 step 的“已具备输入”；
- 如果实现偏离原 contract，所有 downstream step 立即标 `needs-replan`；
- 更新 `unit-test.md`；
- 停止等待用户 review。

## 验证政策

### Steps 1–13

- 不新增 unit test；
- 不做端到端测试；
- 不启动应用、不开浏览器做 smoke；
- 不代替用户做人机行为测试；
- 只做 `check:impact`、类型检查/构建等静态验证；
- 若必须依赖运行结果才能继续，状态改为 `blocked-for-user-test` 并让用户验证；
- 若仓库硬性要求已有 regression command，仅运行已有检查，不在这一阶段写新测试。

### Step 14

- 先 review `unit-test.md`，由用户决定保留/删减；
- 再统一写和运行新单测；
- 仍不做 E2E，除非用户明确改变决定。

## 风险台账

| 风险 | 设计应对 | 首次处理 | 状态 |
|---|---|---:|---|
| `001` 在不同 session 冲突 | 所有 key/IPC 带 parent identity，subrunId 明确局部 scope | 1/6/11 | 已规划 |
| run-many 并发重复分配序号 | per-parent-session allocator lock + atomic reservation | 6 | 已规划 |
| ToolContext 一个 agentId 混淆两种 ownership | executor + sessionOwnerAgentId 分离 | 4 | 已规划 |
| 顶层工具注册后但 manager 未完成形成空壳 | Step 3 不注册，Step 9 原子注册并接线 | 3/9 | 已规划 |
| `app` 内只读/写命令混杂 | delegated router policy；新 spawn 不再放 app | 5 | 已规划 |
| shell 绕过 sandbox | delegated catalog 完全隐藏 shell | 5 | 已规划 |
| submit 未调用 | 一次 fixed reminder，随后 partial/failed | 7/8 | 已规划 |
| timeout 只停止等待不 abort | manager/session 持实际 AbortController | 8/9 | 已规划 |
| live event 丢失后 UI 卡死 | final tool result + persisted subrun 为 reload 事实源 | 11 | 已规划 |
| Dialog 改动过大拖慢核心重构 | Step 12 单独 review，可 deferred | 12 | 已规划 |
| 旧代码牵引新设计 | 禁止新生产 import，旧代码不改不测 | 全程/13 | 已规划 |
| review 改变上游 contract | downstream steps 标 needs-replan 并级联更新 | 全程 | 强制机制 |

## 决策变更日志

### 2026-07-16 — 第二轮总体规划 review

- step 需要显式写输入、输出、为什么此时做、如何交给下一步；
- subrun ID 从 ULID 改为父 session 局部三位序号；
- 新增独立顶层 `subagent` cmdline tool，与 app/web 并列；
- 删除全部存量数据迁移工作；
- 新主体放 `src/main/pi/subagent`；
- subrun messages Dialog 独立为可选 Step 12；
- 每次 review 必须级联更新未来规划；
- 旧代码只读参考，不修不测，不强制本次删除；
- 禁止 E2E；新单测统一延后到 Step 14，通过 `unit-test.md` 累积。

## 执行记录

尚未开始代码实施。

每个 step 完成后追加：

```text
### YYYY-MM-DD — Step N — awaiting-review
- Plan review 变化：
- 实际输入：
- 实际输出/API：
- 修改文件：
- 静态验证：
- 未做的运行验证：
- unit-test.md 更新：
- 影响的下游 steps：
- 用户 review 待确认：
```
