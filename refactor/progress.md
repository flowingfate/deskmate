# Agent / Sub-Agent 统一重构进度

<!-- Last updated: 2026-07-17 -->

## 执行管控
- 每个 session 只聚焦做一个 step 的任务，绝不跨 step；
- 如果要做 todo list，那么每个 step 只做一个 todo list，绝不跨 step；

## 当前状态

- 总体阶段：**Step 14 complete**
- 当前门禁：14 个重构步骤均已由用户确认
- 业务步骤：Step 9、Step 10、Step 11、Step 12、Step 13 均为 `complete`
- 测试步骤：Step 14 的 P0/P1 核心单测、全量测试与构建验证均已完成；不含 E2E
- 生产修复：delegate resolver trim/去空、top-level tool 初始化环与 manager read-only 路径的 session eager-load 已获用户确认
- 共享契约：`refactor/context.md`
- 累积单测方案：`refactor/unit-test.md`
- 记得看看 [这个](../tmp/code-standard.md)，这是我对高质量好代码的理解

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
| 1 | [目标契约与 Pi/Subagent 边界](step1.md) | complete | `context.md` | `src/shared/persist/types/subrun.ts`（persisted contract）；`src/shared/types/subAgentRunTypes.ts`（runtime state/step）；`src/main/pi/subagent/types.ts`；模块依赖规则 |
| 2 | [Agent description/delegates 持久化](step2.md) | complete | Step 1 AgentId/contract | 可落盘的 Agent graph、ID resolver、IPC patch |
| 3 | [独立顶层 subagent cmdline facade](step3.md) | complete | Step 1 request grammar | 未注册的新 facade/registry/run parser，供 Step 9 接 manager |
| 4 | [执行 Agent 与 Session owner 分离](step4.md) | complete | Step 1 execution scope | parent `agentId/sessionId` context；legacy mode union；delegate-only context 由 Step 5 追加 |
| 5 | [Delegate Execution Context 与能力边界](step5.md) | complete | Steps 2–4 | `DelegateExecutionContext`、delegate-only capability checks |
| 6 | [三位序号 Subrun 持久化](step6.md) | complete | Steps 1,2,4 | `001..999` allocator、parent-owned data/messages store、`PersistSessionLike` adapter、persisted type contract |
| 7 | [submit_result 与正式结果状态机](step7.md) | complete | Steps 1,5,6 | delegated-only ordinary local submit route、一次性 controller、formal result reducer、missing-submit decision |
| 8 | [BaseSession 驱动的新 SubagentSession](step8.md) | complete | Steps 2,4,5,6,7 | 单个 persisted delegated run 的 session；用户 review 通过 |
| 9 | [Manager、顶层工具接线与主进程 cutover](step9.md) | complete | Steps 3,6,8 | production `subagent` tool、limits/cancel/state；旧 app command/backend 下线 |
| 10 | [Agent Delegation 配置 UI](step10.md) | complete | Step 2 | description/delegates UI；独立 Sub-Agent 管理入口下线 |
| 11 | [委派运行卡片与 audit/cancel IPC](step11.md) | complete | Steps 6,7,9 | reload-safe card、live state、single cancel、run metadata query、完整 renderer Story matrix |
| 12 | [可选 Messages Dialog](step12.md) | complete | Step 11 review | parent-owned lazy messages IPC、只读 Dialog、Ladle Transcript demo |
| 13 | [证明新路径唯一并删除残留旧源码](step13.md) | complete | Steps 9–12 | 新路径唯一生效；残留旧源码/测试删除；全局文档更新 |
| 14 | [统一编写单元测试](step14.md) | complete | Steps 1–13 + `unit-test.md` | 已确认的 P0/P1 核心单测与验证记录；无 E2E |

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
| 多个 tool calls 并发分配序号冲突 | per-parent-session allocator lock + atomic reservation | 6 | 已规划 |
| ToolContext 混淆 session 与 execution identity | `agentId/sessionId` 固定 parent；`mode:'delegate'` 分支强制 `delegateId` | 4 | 已实现 |
| 顶层工具注册后但 manager 未完成形成空壳 | Step 3 不注册，Step 9 原子注册并接线 | 3/9 | 已规划 |
| `app` 内只读/写命令混杂 | delegated router policy；新 spawn 不再放 app | 5 | 已规划 |
| shell 绕过 sandbox | delegated catalog 完全隐藏 shell | 5 | 已规划 |
| submit 未调用 | 一次 fixed reminder，随后 partial/failed | 7/8 | 已规划 |
| timeout 只停止等待不 abort | manager/session 持实际 AbortController | 8/9 | 已规划 |
| live event 丢失后 UI 卡死 | final tool result + persisted subrun 为 reload 事实源 | 11 | 已规划 |
| Dialog 改动过大拖慢核心重构 | Step 12 单独 review，可 deferred | 12 | 已规划 |
| 旧代码牵引新设计 | Steps 5–8 零修改旧路径；shared breaking change additive/延后；cutover 删除引用后整体删 orphan 源码 | 全程/9/10/11/13 | 强制门禁 |
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

### 2026-07-16 — Step 1 类型风格 review

- 用户明确偏好：存在选择时，公共字段继承使用 `interface Xxx extends Base`，不使用 `type Xxx = Base & {...}`；
- `SubAgentRunResult`、`SubAgentRunStep`、`SubAgentRuntimeState` 的所有分支已改为命名 interface，union type 只负责聚合；
- 该调整不改变运行契约和下游字段名。

### 2026-07-16 — Step 1 normalization 简化 review

- 删除 `normalizeSubAgentRunResult` 以及 `normalizeRunUsage`、`normalizeTokenUsage`、`normalizeSubrunId`、`normalizeRequiredText`、`normalizeOptionalText`、`normalizeStringList`、数字 helper；
- 仅保留有真实集中价值的 `normalizeSubAgentRunRequest`，并把少量校验直接写在函数内；
- result 的运行时校验延后到 Step 7 的真实 submit/reducer 边界，避免 Step 1 先造第二层抽象。

### 2026-07-16 — Step 2 启动

- 用户明确要求开始 Step 2，视为 Step 1 review 通过；Step 1 状态切为 `complete`。
- Step 2 计划按当前仓库复核后无需改写：`description` 保持 AGENT.md 源真值 + AgentRecord hot 缓存，`delegates` 保持 AgentDetail cold 字段；resolver 只按需读取父 Agent detail，再 join active registry，不在 snapshot/bootstrap fan-out 读取 AGENT.md。
- 当时计划采用 trim/去空/稳定去重与 self 拒绝；该实现已被下方“Step 2 error contract review”替代。

### 2026-07-16 — Step 2 error contract review

- 用户指出 `normalizeAgentDelegates` 属于过度设计，已删除；delegates 由现有 patch/config 路径原样持久化。
- 用户确认错误处理原则：普通函数/方法不能用签名不可见的 `throw` 表达可预期业务失败；此类失败必须返回 discriminated union、Result、null 等显式类型。
- `Profile.resolveDelegates` 改为返回 `ResolvedAgentDelegates | null`；parent record/AGENT.md 缺失返回 null。resolver 内联完成解析所需 trim/去空/稳定去重，self/dangling/archived 进入 unavailable，不抛领域异常。
- 删除本 step 新增的 Markdown description/delegates throw 校验；既有 parser 契约不在本 review 扩大重构。

### 2026-07-16 — Step 3 启动与 grammar review

- 用户确认 Step 2 完成并要求开始 Step 3，Step 2 状态切为 `complete`。
- 现有计划经当前 app/web facade、通用 parser/router、旧 app subagent 参数形态与 Step 1 request contract 复核，无需改写后进入实现。
- 用户 review 决定删除 `run-many`：并行由同一 assistant response 中的多个独立 `subagent` tool calls 表达，现有 session 会并行执行 tool-call 数组。
- 保留 cmdline facade、registry 与 router，作为未来新增真实管理子命令的扩展空间；当前不创建 placeholder。
- runner 对可预期 pre-run 拒绝继续使用显式 `kind: 'rejected'`，不通过未声明 throw 或伪造 failed formal result表达。
- 用户要求新增两个有价值的管理子命令；选择 `list`（低成本刷新可委派目标）与 `describe`（按需查看单个已授权 target 的安全能力摘要）。
- `list` 只读 resolver hot records，不 fan-out；`describe` 先 resolver 授权再单 target cold read，禁止输出 systemPrompt/outgoing graph/zero 等非选择信息。
- 用户确认 Step 3 可视为完成；`list` / `describe` / `run` grammar、runner seam 与未注册门禁正式作为下游稳定输入。

### 2026-07-16 — Step 4 启动与 ownership review

- 用户确认 Step 3 完成并要求开始 Step 4，Step 3 状态保持 `complete`。
- 现有计划经 ToolContext、Internal URL、RegularSession/JobRun、AppCommand、media/attachment renderer 边界与 persist Session API 复核，无需改写后进入实现。
- ownership 采用两个必填平铺字段：`agentId` 是 executor，`sessionAgentId` 是 session 所属 Agent；不提供 optional fallback、nested scope 或绝对 session path。
- 普通 RegularSession/JobRun 两者相同；新 delegated run 到 Step 8 才构造 executor=delegate、owner=parent。旧 runtime 只补同 ID 字段保持原行为。

### 2026-07-16 — Step 4 字段命名 review

- 用户否决 `sessionOwnerAgentId`：该名称把可从上下文推导的 `owner` 冗余塞进标识符，属于堆词式长命名。
- 最终改为 `sessionAgentId`：`session` 已表达归属关系，字段直接表示“这个 session 属于哪个 Agent”；与 executor `agentId` 并列即可读懂。
- 该调整只改字段名，不改变 local/knowledge/skill 分流、必填约束或下游 ownership 契约。

### 2026-07-16 — Step 4 execution identity 反向设计 review

- 用户确认恢复 `agentId + sessionId` 的原始语义：二者始终表示当前 parent session。
- 不采用 `subagent?: string`；最终采用 discriminated union，delegate 分支通过 `mode:'delegate' + delegateId` 强制表达执行 Agent，agent 分支为 `mode:'agent'`。
- `mode` 取代 `isSubAgent`，避免两个字段描述同一运行角色；该变更使 Steps 5/6/8/9 的输入契约同步改写。

### 2026-07-16 — Step 4 旧兼容路径 review

- 用户再次确认：不兼容历史数据，也不为终将下线的旧 Sub-Agent 实现维护新 API 契约。
- 删除 `ToolContext` / `AppCmdContext` / `BaseSession` 的旧 `getSubAgentConfig` callback seam；冻结旧 command/kernel 自己读取旧配置，依赖不再外溢到新通用上下文。
- `getParentContextSummary` 明确为新 `subagent run --with-parent-summary` 的正式 seam，不再与旧配置 callback 混为一谈。
- 旧 `SubAgentSession` 的 `delegateId=agentId` 只保留为 Step 9 前阻止旧入口递归的单点安全 bridge；它不属于稳定契约、不进入 Step 14 测试候选，Step 9 必须随旧注册和旧 guard 删除。
- 删除本次 Step 4 对旧命令新增的 delegate/callback 兼容测试维护；新 ownership 的测试候选只覆盖正式 agent/delegate 资源边界。

### 2026-07-16 — 后续重构改为严格并行替换

- 用户确认期望的迁移方式：新实现独立生长，生产引用逐步切换；旧代码一旦成为 orphan 就整体删除，而不是继续协变或维护。
- 根因复盘：Step 4 直接替换共享 `ToolContext`，同时旧 runtime 仍注册并参与编译，导致类型系统迫使旧 caller 协变；这是步骤隔离设计不足，不是旧数据迁移需要。
- Steps 5–8 新增硬门禁：修改文件清单不得包含旧 Sub-Agent 路径；shared breaking change 必须 additive 或延后；新 policy不能仅凭 delegate mode全局激活。
- Step 9 改为从 production roots 原子切换引用，随后整体删除旧 backend/app command及测试，不再修改临时 bridge/guard。
- Step 10/11 在旧 UI/CRUD/persist/renderer引用归零后各自整体删除对应源码；Step 13负责最终残留证明和清除。
- 用户磁盘上的旧 `sub-agents/` 数据仍然不读、不迁移、不删除；“删除旧源码”与“删除旧数据”严格分离。

### 2026-07-16 — Step 5 启动与 policy review

- 用户确认 Step 4 完成并要求开始 Step 5，Step 4 状态保持 `complete`。
- 当前实际 LocalTools 为 read/write/find/search/ask/app/web/shell；app 域为 Agent/MCP/Skill/Schedule/Time + 旧 feature-gated subagent，web 域为 search/research/fetch/download。
- 计划无需改变安全边界，但按现有 ToolCatalog/MCP auth 结构确定落地方式：catalog-inline route 承载 per-catalog tool/guard，MCP 用 per-call AsyncLocalStorage scope，禁止用全局 mutable flag 或 `eventSender` 推断。
- 新 catalog 显式从 executor Agent selection 与系统 allowlist 取交集；修复了“selection 过滤成空后触发普通 catalog 空数组=全开”的设计陷阱，使用 `selectLocalTools([])` 表达 MCP-only/empty-local。

### 2026-07-16 — Step 5 scope redesign

- 用户否决 Step 5 的 reduced catalog + inline guard + 独立受限 registry 方案，认为其复杂度不可接受。
- 新决策：统一 `AsyncLocalStorage` execution scope。主 Agent 的 regular/job execution 与未来 delegated SubAgentSession 均在入口建立 scope；后续能力只通过 `getStore()` 获取运行角色和 parent/executor identity，不再把 `mode/delegateId` 当权限判断来源。
- 为避免现有旧 runtime 编译/行为被本 step继续维护，Step 4 union 暂保留为冻结 legacy ingress seed；新/通用能力在 Step 5 后只消费 scope。Step 9 删除旧 runtime 时再物理删除该 bridge/union consumer。
- Step 5 原有 policy/catalog 文件及 ToolCatalog `selectLocalTools/replaceTool/withoutMcpInteraction` 已判定为失效中间态，必须整体删除；`withTool()` 保留为 Step 7 delegated-only submit_result 的最小 runtime route。
- Steps 6–9、14 已同步改写为 scope contract；没有新增数据迁移或旧 runtime 兼容目标。
### 2026-07-16 — Step 5 delegate-only scope redesign

- 用户明确：正常 Agent execution 没有 delegate context，`getStore()` 应为 undefined；只有 subagent tool 真正执行 delegated Agent 时，才在外层 `run()` delegate context。
- 回退 Step 5 对 RegularSession/JobRun、executeToolCall、InternalUrlRouter 的 scope root/fallback 改动；它们继续用既有 context 表达 parent session。
- scope 只携带 `delegateId`；delegate 存在时 Knowledge/Skill 使用它，否则仍使用现有 `ctx.agentId`。Local 永远使用现有 parent context，不读 scope。
- 删除 Step 5 提前增加的 inline `ToolRoute`/`withTool`；Step 7 在真实 submit_result 输入出现时再实现最小私有 route，不预建 extension seam。
- Steps 6–9、14 已按 delegate-only context 重写；scope 文件重命名为 `delegateExecutionScope.ts`。
### 2026-07-16 — Step 5 LocalTool blacklist review

- 用户要求 delegated catalog 从 LocalTool 对象黑名单而非名称白名单过滤；当前黑名单仅包含已构造的 `ask`、`shell` 对象。
- `subagent` 仍是 runner-required factory，当前不能伪造或提前注册对象；Step 9 创建真实对象后再把该对象加入黑名单，继续禁止嵌套委派。
- 该选择使其它新 LocalTool 默认可见；相关 context、Step 5/9、模块文档与 Step 14 测试候选已同步改写。
### 2026-07-16 — Step 5 interaction-only capability review

- 用户确认委派 Agent 的默认能力应与普通 Agent 一致；只禁止 `ask`、嵌套 `subagent`，以及依赖当前会话 human-loop 的 `web research`、已知 shell device-auth。
- MCP OAuth 的 consent/client-id/browser UI 是全局应用流程，不依赖 parent/delegate identity；不再受 delegate context 限制。
- 删除 URI、shell、download、app/web allowlist 等委派限制；Local 继续用 parent context，Knowledge/Skill 继续用 delegateId。
- `ask` 是当前唯一 LocalTool 黑名单对象；真实 `subagent` 对象仍等 Step 9 创建后加入。相关 context、Steps 5/8/9、模块文档和测试候选已同步改写。


### 2026-07-16 — Step 6 启动与持久化计划复核

- 当前 `shared/persist/types` 被约束为不依赖 `shared/types`，因此新的 `SubrunDataFile` 放在既有 `shared/types/subAgentRunTypes.ts`：它可复用 `ContextState` 与 shared run request/result，且不反向污染 persist schema 层。
- 新 store 定为 `src/main/persist/subrun.ts` 的 `Subrun`，不继承现有 `Session`：后者的 data union、SQLite/index 与普通 session emit 契约均不适用；`Subrun` 直接实现 Step 8 所需的 `PersistSessionLike` 最小消息/配置契约。
- `Session` 仅新增 parent-owned `createSubrun/getSubrun/listSubruns`；allocator lock 以 parent `subruns/` 绝对路径为临时全局 key，在 reservation 完成后释放，兼容同一 parent 的多个内存 Session 实例而不留永久 map。
- `get` 对非法 ID、缺失目录、空 reservation 明确区分；load 不自动续跑或改写 running，Step 9 将作为唯一 crash recovery 事实入口。
- 该复核没有改变下游 public contract；Steps 7–12 保持有效。

### 2026-07-16 — Step 6 持久化类型归属修正

- 用户明确规则：任何定义后需要写入磁盘的数据类型，必须定义于 `src/shared/persist/types`。
- 自查结论：`SubrunDataFile` 及其嵌套 `SubrunId`、request/result/usage/context/policy 当前在 `shared/types/subAgentRunTypes.ts`，已违反该规则。
- 修正计划：把上述 persisted contract 完整移至新的 `shared/persist/types/subrun.ts` 并从其唯一入口导出；`shared/types/subAgentRunTypes.ts` 只保留未落盘的 step/runtime state，改为依赖 persisted contract。所有代码和下游文档同步到新 source，不留 re-export alias。
- 受影响下游：Steps 1、2、3、6–12、14 的类型路径改为需要回写；进入 Step 7 前必须完成迁移并重新静态验证。

### 2026-07-16 — Step 6 用户 review 通过

- 用户确认所有会写入磁盘的 Subrun 类型均应位于 `src/shared/persist/types`；已完成的 `shared/persist/types/subrun.ts` 归属、runtime-state 分离与静态验证获通过。
- Step 6 状态切为 `complete`；Step 7 仍为 `pending`，只能由用户另行开始。

### 2026-07-16 — Step 7 启动与状态机复核

- Step 5 已删除早期 catalog extension seam；真实 `submit_result` 出现后，仅为它增加精确的 `ToolCatalog.withSubmitResult()`，不复活通用 replacement/guard API。
- 该 route 保留在单个 catalog snapshot 并携带未注册 tool 对象；普通 `buildToolCatalogForAgent()` 与全局 `ToolsRegistry` 均无此名称，旧 runtime caller 不修改。
- controller 只保存首份已校验的 completed/partial/blocked payload；formal result builder 才注入可信 subrun/delegate/usage/tool deliverables，failed/cancelled 保持 runtime 专属。
- missing-submit 规则固定为一次 reminder，之后或无 tools/max turns 按 content 收敛为 `result_not_submitted` partial/failed；不使用意图 regex 或最后文本 completed 推断。

### 2026-07-16 — Step 7 ToolRoute review 修订

- 用户接受 dedicated `submit_result` tool，但明确拒绝 `kind:'submit_result'` 进入通用 `ToolRoute` union。
- 所有 local route 改为直接持有选中的 `LocalTool` snapshot；registry 与 catalog-private tool 通过同一 `executeLocalTool()` helper 收敛取消和异常。
- `submit_result` 因此是普通 `{ kind:'local', tool }` route；它只由 `withSubmitResult()` 追加到单次 delegated catalog，不注册全局 registry，也没有第二个 dispatcher 分支。

### 2026-07-16 — Step 7 路由容错与 registry cleanup

- `ToolCatalog.resolveIdentity()` 的 route miss 继续回退原始 LLM name，不能抛错：它在流式 tool-call 展示和 assistant message rehydrate 阶段调用；真正的执行边界 `executeToolCall()` 会把不在 catalog 的调用收敛为 tool error，保证 assistant/tool 配对完整。
- `ToolsRegistry.execute(name,args,ctx)` 没有生产调用方，只有其自身的旧单测；已删除。registry 保留注册/选择职责，`executeLocalTool(tool,args,ctx)` 成为 catalog selected tool 的唯一执行边界。

### 2026-07-16 — Step 7 用户 review 通过

- 用户确认 dedicated `submit_result` tool、普通 local route 直持 `LocalTool`、`resolveIdentity()` route miss 展示性 fallback，以及删除无生产调用的 `ToolsRegistry.execute()`；Step 7 状态切为 `complete`。
- Step 8 仍为 `pending`，只能由用户另行开始。

### 2026-07-16 — Step 8 启动与 BaseSession 复核

- 已完整复核 `BaseSession`、RegularSession、JobRun、persist `Subrun`、submit reducer、tool catalog、message bridge 与 Pi/session 文档；未读取或修改旧 Sub-Agent runtime/test。
- 当前 BaseSession 的硬编码点为 config/model/prompt/catalog、30-turn cap、per-round context、tool-batch continuation 与无上下文 completion；实际只需 additive `prepareRunEnvironment`、iteration、assistant transient-reminder、tool-batch stop 和 completion metadata seams。Regular/Job 维持原流程，不增加 delegate mode 分支。
- `toPiContext(..., { transientReminder })` 已是现成的非落盘入口；Step 8 以它实现一次 fixed reminder，而不是写入伪 user message。
- delegated prompt 将复用普通 `buildSystemPrompt` 的 identity/knowledge/skills/global 逻辑，通过新增默认开启的 `includeConfiguredSubAgents` 参数排除 legacy configured subAgents，再追加 run contract；不复制 skill format。
- 下游 Step 9/11 的稳定输入预定为 `SubAgentSession` 的 pending-start outcome、terminal formal result 与 `{ onStep?, onResult? }` 窄回调；manager 保持唯一的授权、timeout、并发和取消 owner。

### 2026-07-16 — Step 9 启动与 cutover plan review

- 用户明确开始 Step 9，视为 Step 8 review 已通过；Step 8 保持 `complete`，Step 9 进入 `reviewing-plan`，此时禁止修改生产代码。
- 已按实际 Step 3 command runner、Step 6 parent-scoped Subrun store、Step 8 `SubAgentSession`、当前 tool registration、parent cancellation、旧 runtime/import/test 与 prompt 路径复核。
- 初始计划修订：`mode:'delegate' + delegateId` 是新 SubAgentSession 所需的正式 ToolContext/AppCmdContext contract，不能随旧 bridge 删除；删除范围限于旧 app command/backend、其专属 BaseSession accessors和旧测试。
- manager admission 将以 parent identity 短锁串行持久 total gate、stale-running recovery、reservation 与 active registration；parent prompt 由 RegularSession/JobRun 在通用 prompt 后追加新 Agent graph guidance。

### 2026-07-16 — Step 9 Profile-bound manager review

- 用户要求删除跨 Profile 全局 `subAgentManager`，使每个 `Profile` 对应唯一 `SubAgentManager`；采用 `WeakMap<Profile, SubAgentManager>`，而非按 ID 的长期 `Map`。
- `SubAgentManager.forProfile(profile)` 是唯一 production construction；它绑定 Profile，`activeRuns`、locks、listeners 因而不跨 Profile 共享，内部 parent map key 只保留 Agent/session。
- Profile 选择已经由顶层 tool/未来 IPC 边界完成；用户指出跨 Profile 调用在该链路中不成立，因此删除 manager 内重复 `profileId` guard、重复 profile 参数与对应测试候选。
- 顶层 `subagent` LocalTool 仍是一个 registry object；handler 按显式 `ToolContext.profileId` 解析 active Profile，首次创建后以 WeakMap 复用该 Profile 的 command facade。它复用 facade 的 parse/dispatch/format，不重建第二套 cmdline 行为，也不恢复 runner adapter。
- admission 后的取消竞态修复保持：若 parent signal 已 aborted，manager 先 abort 实际 controller 再创建 SubAgentSession。

### 2026-07-16 — Step 9 explicit top-level tool review

- 用户确认顶层工具文件内保留少量 schema/description/handler 重复，换取直接可读性；删除无额外语义的 `makeCommandFacade` 工厂。
- `app.ts`、`web.ts`、`subagent.ts` 都显式定义 LocalTool；仅复用 `executeCommandFacade(command, cmdline, ctx)` 的 parse/dispatch/format 行为，避免复制实际执行协议。
- `_facade.ts` 重命名为 `executeCommandFacade.ts`；`AppCommand.toolDescription` 改为由顶层工具直接消费。
## 执行记录

### 2026-07-16 — Step 1 — complete
- Plan review 变化：确认 shared direct import 与 Pi root export 边界；按用户反馈将 union 分支改为命名 `interface extends Base`，并删除尚无真实输入边界的 result/usage/list 归一化层。
- 实际输入：第二轮 `context.md`；现有 `profileTypes.ts` 旧 runtime 只读参考；Pi public boundary。
- 实际输出/API：`SubrunId` helpers；`SubAgentRunRequest/Result/RuntimeState`；`normalizeSubAgentRunRequest`；`SUB_AGENT_RUN_POLICY_LIMITS`。
- 修改文件：`src/shared/types/subAgentRunTypes.ts`、`src/main/pi/subagent/types.ts`、`src/main/pi/subagent/ai.prompt.md`、`src/main/pi/ai.prompt.md`、`ai.prompt/arch-main.md`，以及本 refactor 交接文档。
- 静态验证：初版、interface 风格修订及 normalization 精简后均完成 `npm run check:impact -- <实际修改文件>`、`npm run typecheck`、`npm run build`，全部通过（仅既有 chunk-size warning）。
- 未做的运行验证：按用户确认的政策，未新增/运行单测，未启动应用，未做 smoke/E2E。
- unit-test.md 更新：保留 request policy normalization；result/usage/数组/URI validation 候选统一移至 Step 7。
- 影响的下游 steps：2、3、5、6、7、9、11、14 已回写真实名称与边界；其余计划契约仍成立。
- 用户 review 待确认：shared 字段、result 五态、policy 默认值/上限、`SubrunId` 规则。

### 2026-07-16 — Step 2 — complete
- Plan review 变化：无需重写原计划；确认 description 作为 AGENT.md 源真值 + AgentRecord hot 缓存，delegates 作为 AgentDetail cold 字段，resolver 只读父 detail 后 join hot registry。
- 实际输入：Step 1 shared request/ID 契约；persist Hot/Cold、AGENT.md、IPC/atom 既有写路径。
- 实际输出/API：`AgentRecord.description?`；AGENT.md/`AgentDetail.delegates?`；`AgentFrontPatch` description/delegates；`CreateAgentInput.description`；`Profile.resolveDelegates(parentId): Promise<ResolvedAgentDelegates | null>`。
- graph 语义：delegates 原样落盘；resolver trim/去空/稳定去重；parent 缺失返回 null；self/dangling/archived 进入 unavailable；duplicate 复制 description 与 outgoing delegates；archive 不重写 incoming references。
- 修改生产文件：`src/shared/persist/types/agent.ts`、`src/shared/persist/markdown.ts`、`src/shared/ipc/persist.ts`、`src/shared/types/profileTypes.ts`、`src/main/persist/{agent,profile,ipc,index}.ts`、`src/renderer/lib/chat/agentOps.ts`。
- 写路径闭合：create 可直接带 description；patch 同步 AGENT.md → AgentRecord；detail/event 下发 delegates；archive 列表保留 description；renderer compat bridge 双向映射 description/delegates。app agent command 未扩展新 CLI 参数。
- 静态与回归验证：初版及 error-contract review 修订后均完成 `check:impact`、workspace diagnostics、`npm run typecheck`、`npm run build`；全部通过（仅既有 chunk-size warning）。修订后 `npm test` 再次通过：145 files / 1618 tests。
- 未做的运行验证：按重构政策未启动应用、未做 smoke/E2E；未新增测试文件。
- unit-test.md 更新：删除独立 normalization/throw 候选；保留 graph round-trip，并新增 resolver null/self/dangling/archive/fan-out 候选。
- 影响的下游 steps：5、8、9、10 已回写真实 resolver/字段/atom 边界；6 仅依赖普通 Agent ID，计划仍成立。
- 用户 review 结果：通过；2026-07-16 进入 Step 3。

### 2026-07-16 — Step 3 — complete
- Plan review 变化：无需重写；确认复用 `AppCommandRegistry` / `makeRouterCommand` / `makeCommandFacade`，并给 router 增加可选 `helpFooter`，使顶层 help 能承载 Agent ID 来源和两层 limits。
- 实际输入：Step 1 `SubAgentRunRequest` / `normalizeSubAgentRunRequest`；app/web facade 通用基础设施；旧 `app subagent` 仅只读分析参数痛点。
- 实际输出/API：`createSubAgentCommand(manager)`；`subagent` facade 直接绑定 production manager；父 scope；三类 result/rejected outcomes；list/describe 安全 view types。
- grammar：`subagent list`、`subagent describe <agent-id>`、`subagent run <agent-id> --task --expect [--with-parent-summary] [--max-turns] [--timeout-seconds]`；不提供 `run-many`。
- list/describe：list 返回 resolver 顺序的 ID/name/description/model + unavailable IDs；describe 仅允许 available ID，返回 thinking/local-tools(all|selected)/MCP/Skills，明确排除 systemPrompt/delegates/subAgents/zero。
- run/parser/output：flag/positional 先类型收窄，再进入唯一 normalizer；timeout seconds 安全换算；三条命令统一输出 `{ outcome }`，rejected exit 1。
- 并行语义：顶层 help、tool description command synopsis 与 `run --help` 均提示 LLM 在同一 assistant response 发起多个 run calls；RegularSession/JobRun 会并行执行。
- 最终生产文件：`commands/{_shared,types,list,describe,run,index}.ts`、`tools/subagent.ts`、`appcmd/makeRouterCommand.ts`；review 中删除 `parse.ts` / `runMany.ts`。`tools/index.ts` 未修改。
- 生产未注册证据：`tools/index.ts` 搜索 `createSubagentTool` / `tools/subagent` 无结果；旧 `appCommands.register(subagentCommand)` 仍在 feature gate 内，等待 Step 9 原子 cutover。
- 静态验证：全部 command/facade diagnostics 无错误；最终 `npm run check:impact -- <8 个代码文件>` 通过，直接依赖只有已复核的 `tools/app.ts` / `tools/web.ts`；`npm run typecheck`、`npm run build` 通过（仅既有 chunk-size warning）。
- 未做的运行验证：按重构政策未新增/运行单测，未执行 command smoke，未启动应用，未做 E2E。
- 文档交接：更新 subagent/Pi/tool-system 文档，回写 `context.md`、Steps 3/9/11/14 与 `unit-test.md`。
- 用户 review 结果：通过；Step 3 complete，等待另行开始 Step 4。

### 2026-07-16 — Step 4 — complete（最终 mode union）
- Plan review 变化：用户最终选择反向 identity 设计；不再增加第二个 session owner ID，而是保持 `agentId/sessionId` 为 parent session，通过 mode union 表达 execution identity。
- 实际输出/API：`ToolContext`、`ResolveContext`、`WriteContext`、`AppCmdContext` 均为命名 interface 分支组成的 discriminated union；agent 分支无 delegateId，delegate 分支必填 `delegateId`；共享 `executorId()` 收敛 execution Agent 选择。
- ownership 语义：Local 始终用 parent `agentId/sessionId`；Knowledge/Skill 使用 `executorId(ctx)`；RegularSession/JobRun/debug/media/attachment 使用 agent mode；Step 8 新 runtime 将使用真实 delegate ID。
- 旧代码处理：旧配置读取已从通用 context/BaseSession 移回冻结的旧 kernel；仅剩旧 `SubAgentSession` 的 `delegateId=agentId` 单点安全 bridge，明确不属于稳定契约并由 Step 9 强制删除。
- 修改生产文件：`pi/tools/types.ts`、`pi/internal-urls/{types,handlers/{local,knowledge,skill}-protocol}.ts`、`pi/session/{base,regular,job}.ts`、`pi/appcmd/{types,dispatcher}.ts`、旧 subagent command/kernel 隔离点、`web download`、startup/media/attachment/旧 SubAgentSession；fixtures 按正式 context 收紧。
- 验证：最终 `check:impact` 通过；相关 LSP diagnostics 无错误；`npm run typecheck`、`npm run build` 通过（仅既有 chunk-size warning）；相关回归 5 files / 100 tests 通过；全量 `npm test` 145 files / 1613 tests 通过。
- 未做：未新增测试文件，未启动应用，未做 browser/manual file-write/E2E。
- 文档交接：已更新 `context.md`、Steps 4/9、`unit-test.md` 与相关模块文档；Step 9 有显式 bridge/guard 清理门禁。
- 用户 review 结果：通过；Step 4 complete，等待另行开始 Step 5。

### 2026-07-16 — Step 5 — complete（delegate-only context）
- 用户否决 normal agent scope、Regular/Job wrapper、scope fallback 和提前 inline route；最终只保留 delegated run 外层 AsyncLocalStorage。
- 实际输出/API：`DelegateExecutionContext { delegateId }`、`runWithDelegateExecution`、`getDelegateExecution`、`isDelegatedExecution`。normal execution 不创建 store。
- identity：Local 始终使用现有 parent ToolContext/ResolveContext；Knowledge/Skill 使用 `getDelegateExecution()?.delegateId ?? ctx.agentId`。不重复 parent profile/agent/session 到 scope。
- capability：delegate context 存在时 catalog 只排除 `ask`；Step 9 加入真实 `subagent` 对象。read/write/find/search、shell、download、app/web 非交互命令与 MCP OAuth 均保持普通行为；`web research` 与已知 shell device-auth 在执行边界拒绝。Local 仍用 parent identity，Knowledge/Skill 使用 delegateId。
- submit：删除 ToolCatalog inline route/withTool；Step 7 在真实 handler 出现时再实现最小 private route，普通 catalog 必须不可见。
- 修改生产文件：`lib/delegateExecutionScope.ts`、pi tool/tools/appcmd/Internal URL/MCP Auth；回退 session scope 改动，删除上一轮 general scope/提前 route 代码。
- review 修复：delegated 强制刷新先标记 access token 过期，再只走 `runRefreshOnly`；随后用户决定 MCP OAuth 直接复用普通全局交互流，已删除 delegate-only auth 分支。catalog 黑名单当前仅 `ask`；旧 `buildToolCatalogForSubAgent` 保持原有 selection 语义。
- 验证：相关 LSP diagnostics 无 error；初版、review 修复、LocalTool 黑名单及 interaction-only capability 调整后均完成 `check:impact`、`npm run typecheck`、`npm run build`（仅既有 renderer chunk-size warning）。按 Step 5 政策未新增/运行单测、未启动应用或做 E2E。
- 下游：Steps 6–9/14 已改为 delegate-only contract；Step 8 是唯一 scope root，Step 7 不再依赖预建 extension seam。
- 用户 review 结果：通过；Step 5 complete，等待用户另行开始 Step 6。

### 2026-07-16 — Step 6 — awaiting-review
- Plan review 变化：初版把 `SubrunDataFile` 与 nested persisted types 放在 `shared/types`，违反用户后续明确的持久化类型归属规则；本次修正后所有会写入 `data.json` 的类型均移至 `shared/persist/types/subrun.ts`，`shared/types/subAgentRunTypes.ts` 仅保留 runtime state/step。store 仍固定为独立 `src/main/persist/subrun.ts::Subrun`，不继承普通 `Session`。
- 实际输出/API：`SubrunDataFile` 的 pending/running/五类 terminal named-interface union；`Session.createSubrun/getSubrun/listSubruns`；`Subrun.create/load/list/start/finish`，以及直接实现的 `PersistSessionLike` 消息/配置接口。
- allocator：以 parent `subruns/` absolute path 为临时 single-flight key，扫描合法 `001..999`、原子 mkdir reservation、随后原子写初始 data；空 reservation 不复用；invalid directory 记录 warning；`999` 返回显式 exhausted。
- 查询与状态：`get` 显式区分 invalid ID、missing、incomplete、corrupt、found；`start` 仅允许 pending，`finish` 仅允许 running 且拒绝 mismatched subrun/delegate result；load 不自动续跑或改写 stale running，Step 9 是唯一 recovery 入口。
- 持久化边界：subrun 只落 `data.json`/`messages.jsonl`，无 files、无 SQLite/index、无普通 session IPC emit；parent 删除/归档自然携带目录。
- 修改生产文件：`src/shared/persist/types/{subrun,index}.ts`、`src/shared/types/subAgentRunTypes.ts`、`src/shared/persist/path.ts`、`src/main/persist/{subrun,session,index}.ts`、`src/main/pi/subagent/{types,commands/{types,run}}.ts`。
- 静态验证：`npm run check:impact -- <10 个生产文件>`、迁移后的 `npm run typecheck`、`npm run build` 均通过；build 仅报告既有 renderer chunk-size warning。LSP diagnostics 对新 persist type、runtime type、Subrun store 与 command type 均无问题。
- 未做的运行验证：按重构政策未新增/运行单测，未启动应用、未做 smoke/E2E。
- 文档交接：已更新 persist/Pi/subagent/主架构文档、`context.md`、`unit-test.md`、Step 1/2/6/7/8/9/11/12；所有 persisted type import 已切至 `@shared/persist/types`，Step 8/9 计划保留实际 store API。
- 用户 review 待确认：三位序号不复用、empty reservation 处理、data union 与 Step 9 stale-running recovery 边界。
- 用户 review 结果：通过；Step 6 complete，等待用户另行开始 Step 7。

### 2026-07-16 — Step 7 — awaiting-review
- Plan review 变化：旧计划引用已删除的 Step 5 extension seam；实现后用户否决 `kind:'submit_result'` ToolRoute。最终改为所有 local route 直持 `LocalTool`，用 registry 的统一 helper 执行，不新增第二个 route kind 或 dispatcher 分支。
- 实际输出/API：新 `pi/subagent/submitResult.ts` 的 `SubmitResultController`、`createSubmitResultTool`、`buildFormalResult`、`decideMissingSubmit`；`pi/tool.ts` 的 `ToolCatalog.withSubmitResult`。`executeLocalTool` 是 registry/public-catalog 共用的执行边界。
- 提交语义：模型仅可提交 completed/partial/blocked；文本 trim/非空、warnings/deliverables 稳定去重、parent `local://` path policy 在唯一输入边界校验。重复 submit 以可见 tool error 拒绝；metadata、failed/cancelled 不能由模型伪造。
- fallback：首次可继续的无 submit 停止只返回固定 transient reminder；已提醒、无 tools 或 max turns 才按 assistant content 生成 `result_not_submitted` partial/failed。timeout/cancel/error 仍由 runtime 优先。
- 修改生产文件：`src/main/pi/tool.ts`、`src/main/pi/tools/registry.ts`、`src/main/pi/subagent/submitResult.ts`；同步更新两个受影响既有 catalog/message bridge 测试。未修改旧 `lib/subAgent`、旧 app subagent、持久化 terminal、renderer 或顶层工具注册。
- 静态验证：LSP diagnostics 对生产文件和 tool catalog test 无错误；最终 `npm run typecheck`、`npm run build`、`npm run check:impact -- src/main/pi/tool.ts src/main/pi/tools/registry.ts src/main/pi/subagent/submitResult.ts` 全部通过。build 仅有既有 renderer chunk-size warning。
- 未做的运行验证：按当前重构政策未新增/运行单测，未启动应用或执行 smoke/E2E。
- 文档交接：更新 `context.md`、Step 7/8、`unit-test.md`、pi/subagent、pi/tools、pi 与主架构文档；Step 8 已绑定实际 route/controller/builder/fallback API。
- review cleanup：保留 `resolveIdentity()` 对未知 route 的展示性 fallback；删除无生产调用的 `ToolsRegistry.execute`，既有 registry tests 改为覆盖 `executeLocalTool` 的异常、取消与 context 透传。
- 用户 review 待确认：普通 local route 直持 tool object 的统一方向、submit schema、local deliverable policy、一次 reminder 后的 `result_not_submitted` 收敛语义。

### 2026-07-16 — Step 8 — awaiting-review
- Plan review 变化：完整复核 BaseSession/RegularSession/JobRun、Subrun、submit reducer、catalog/message bridge 后，未需大幅重写 BaseSession。只抽取 additive `prepareRunEnvironment`、iteration、assistant follow-up、tool-batch stop 与 completion metadata seams；Regular/Job 无 mode 分支、无需协变修改。
- 实际输出/API：新增 `pi/subagent/prompt.ts::buildDelegatedSystemPrompt` 与 `pi/subagent/session.ts::SubAgentSession`。构造仅接收 `{ subrun, signal, parentTracer?, callbacks? }`，从 persisted Subrun data 唯一派生 parent/delegate/request；`run()` 返回 `{ kind:'result', result } | { kind:'not_pending', status }`。
- execution：run 外层建立 delegate scope，加载 delegate config/model/thinking/catalog，普通 catalog snapshot 仅附私有 `submit_result`；ToolContext 保持 parent `agentId/sessionId` + `delegateId`。prompt 复用普通 identity/knowledge/skills/global，新增默认开启的 `includeConfiguredSubAgents` 参数以排除 legacy list，parent summary 只作不可信参考。
- loop/result：delegate request maxTurns 覆盖默认 30；stream callback 产生 bounded text/tool steps，收集 usage 与 deliverables。submit 后停止；无 submit 通过既有 `decideMissingSubmit` 只 append/flush 一条真实 reminder user message 后继续，后续收敛 partial/failed，保证 transcript 不出现连续 assistant。assistant/tool flush、formal build、metadata persist、`Subrun.finish`、callback/return 按该顺序执行；abort/stream-aborted 是 cancelled，运行异常是 failed。
- 修改生产文件：`src/main/pi/session/base.ts`、`src/main/pi/prompt.ts`、`src/main/pi/subagent/{prompt,session}.ts`。未修改旧 `lib/subAgent`、旧 app command、persist store、renderer 或全局 tools registry；搜索确认新 session/prompt 无旧 runtime import。
- 静态验证：最终 LSP diagnostics 对四个生产文件均无 error；`npm run check:impact -- src/main/pi/session/base.ts src/main/pi/prompt.ts src/main/pi/subagent/prompt.ts src/main/pi/subagent/session.ts` 通过（direct dependents 仅 session index/job/regular）；`npm run typecheck` 与 `npm run build` 通过。build 仅有既有 renderer chunk-size warning；npm 同时报既有 `.npmrc` unknown config warnings。
- 未做的运行验证：按重构政策未新增/运行单测，未启动应用、未做 smoke/E2E。
- 文档交接：更新 Pi/subagent/agent-loop/main architecture、`context.md`、Step 8/9 和 `unit-test.md`；Step 9 已改为消费实际 session outcome/callback seam。
- 用户 review 待确认：BaseSession 五个 minimal seams、session 从 Subrun data 单一派生 identity/request、一次 reminder/terminal 顺序、`not_pending` explicit outcome 与 Step 9 manager 边界。

### 2026-07-16 — Step 8 abort race 修复
- review 期间发现：parent signal 若在 `Subrun.start()` 后、BaseSession 创建 internal abortor 前触发，旧 listener 只能记录 `parentAborted`，可能仍进入首次 LLM stream。
- 修复：`SubAgentSession.run()` 在 mark-turn metadata persist 与首条 user transcript append 两个 await 边界后检查已记录 abort，命中时直接按 cancelled formal result flush/persist/finish/return；进入 BaseSession loop 后继续由同一 listener abort internal controller。
- 验证：LSP diagnostics 无 error；`npm run check:impact -- src/main/pi/subagent/session.ts`、`npm run typecheck && npm run build` 均通过。build 仅有既有 renderer chunk-size warning；未按 Step 8 政策新增/运行单测或启动应用。

### 2026-07-16 — Step 8 persisted missing-submit reminder review

- 用户否决 `toPiContext(..., { transientReminder })` 在新 BaseSession 路径的使用：它不落盘，会让 delegated transcript 出现连续 assistant，缺少真实 follow-up user message。
- 修复：删除 BaseSession 的 reminder state、第四参数传递及 overflow retry option；`afterAssistantMessage()` 改为返回 continue boolean。SubAgentSession 得到一次 reminder 后直接 `appendUserMessage(createUserMessage(...))` 并 flush，BaseSession 随即在同一 loop 继续下一 iteration。
- 新路径不使用 `transientReminder`；旧 `messageBridge` option 与旧 runtime 保持不动，等待 Step 9/13 旧路径整体删除。
- 验证：LSP diagnostics 对 `base.ts` / `subagent/session.ts` 无 error；确认新路径仅以三参数调用 `toPiContext`，无 `transientReminder` 引用；`npm run check:impact -- src/main/pi/session/base.ts src/main/pi/subagent/session.ts`、`npm run typecheck`、`npm run build` 均通过。build 仅有既有 renderer chunk-size warning；未新增/运行单测、未启动应用或做 E2E。

### 2026-07-16 — Step 8 natural ReAct turn review

- 用户确认 Subrun 的首要不变量是完整、可继续的合法会话；否决 `afterAssistantMessage` 与 `shouldStopAfterToolCalls` 对 BaseSession loop 的提交/缺提交控制。
- 修复：删除 BaseSession 的这两个 hooks 及其 context types。BaseSession 恢复为标准 ReAct user-turn loop，不读取 submit controller、不在 tool batch 后提前 break、也不注入 reminder。
- SubAgentSession 把 missing-submit 判断上移到外层：一次完整 loop 返回后才检查 controller；未提交时 append/flush 真实 reminder user message，再启动完整第二 turn；已提交则在自然结束后 formalize。request `maxTurns` 改为跨所有 outer turns 的总 iteration 预算。
- 验证：LSP diagnostics 对 `base.ts` / `subagent/session.ts` 无 error；搜索确认 submit controller 与 missing-submit reducer 只留在 SubAgentSession，BaseSession 无 `afterAssistantMessage` / `shouldStopAfterToolCalls`；`npm run check:impact -- src/main/pi/session/base.ts src/main/pi/subagent/session.ts`、`npm run typecheck`、`npm run build` 均通过。build 仅有既有 renderer chunk-size warning；未新增/运行单测、未启动应用或做 E2E。

### 2026-07-16 — Step 8 会话延续与取消密度 review

- 现状核对：当前 session 只支持单次 terminal delivery，不能满足未来“主 Agent 向已完成 delegate 追加追问”。原因是 persisted Subrun state machine 只允许 pending → running → terminal；直接 reopen 会破坏 result/finishedAt/audit contract。该能力记录为未来独立 persisted design，不在 Step 8 伪造续聊 API。
- missing-submit 兜底已显式限定为最多两个完整 BaseSession user turns：初始 task turn，至多一条 reminder follow-up turn。第二次决策由 `reminderSent` 强制 terminal，非无限循环。
- 取消检查收敛为 `finishIfAborted()`，只放在启动、turn metadata 写后，以及完整 ReAct turn 前后；删除 reminder decision 中的重复检查，不再按每个 await 机械重复。
- 验证：LSP diagnostics 对 `subagent/session.ts` 无 error；`npm run check:impact -- src/main/pi/subagent/session.ts`、`npm run typecheck`、`npm run build` 通过。build 仅有既有 renderer chunk-size warning；未新增/运行单测、未启动应用或做 E2E。

### 2026-07-16 — Step 8 通用 prompt 解耦 review

- 用户否决通过 `includeConfiguredSubAgents` 配置开关从通用 prompt 隐藏旧 Sub-Agent 指导；该开关把已废弃 legacy 行为泄漏到所有调用者。
- 修复：删除 `buildSystemPrompt` 的开关、旧 `buildSubAgents` 查询及 `promptTemplates` 中旧 `app subagent spawn/spawn-many` guidance。默认通用 prompt 只包含 identity/knowledge/skills/global。
- 后续策略：Step 9 生产注册新顶层 `subagent` 时，只有需要委派能力的 parent BaseSession 子类才能在通用 prompt 后显式追加基于新 Agent graph 的 guidance；SubAgentSession 不追加。
- 验证：LSP diagnostics 对 `pi/prompt.ts`、`pi/utils/promptTemplates.ts`、`pi/subagent/prompt.ts` 无 error；搜索无 `subAgentsBlock` / `SubAgentItem` / `includeConfiguredSubAgents` / legacy spawn guidance；`npm run check:impact -- src/main/pi/prompt.ts src/main/pi/utils/promptTemplates.ts src/main/pi/subagent/prompt.ts`、`npm run typecheck`、`npm run build` 通过。build 仅有既有 renderer chunk-size warning；未新增/运行单测、未启动应用或做 E2E。

### 2026-07-16 — Step 8 用户 review 通过

- 用户确认 Step 8 完结：BaseSession 保持完整自然 ReAct user turn；SubAgentSession 在 loop 外完成一次 missing-submit follow-up、总 turn budget、terminal result 与取消编排。
- 通用 prompt 已与 legacy/new delegation guidance 完全解耦；Step 9 才在需要委派能力的 parent session 子类中按新 Agent graph 显式追加。
- Step 8 状态切为 `complete`；Step 9 仍为 `pending`，只能由用户另行开始。

### 2026-07-16 — Step 9 — awaiting-review
- 实际输出/API：新增 `pi/subagent/{manager,runtimeState}.ts`。`SubAgentManager` 既是 commands 直接依赖的唯一生产对象，也是生命周期 owner；按完整 parent identity 完成授权、短锁 admission（persisted total=20、parallel=5）、stale running recovery、timeout/parent cancel 和有界 live state；`cancelRun`、`cancelByParentSession`、`subscribe`、`getRuntimeState` 作为 Step 11 稳定输入。
- 生产切换：`tools/index.ts` 构造并注册真实 `subagent` LocalTool，同时将同一对象加入 delegated catalog blacklist；RegularSession/JobRun 仅在该工具实际在 catalog 中时追加 Agent graph guidance，RegularSession stop 取消同 parent active runs。旧 `app subagent`、`lib/subAgent`、旧 catalog builder及其测试已整体删除；旧 CRUD/persist/IPC/renderer 未动，等待后续指定步骤。
- 结果与恢复：manager 不复制 SubAgentSession result 语义；Subrun terminal data 是事实源。无 active entry 的 persisted running run 由 manager 写为 `failed` / `Subrun interrupted by application restart.`；runtime state steps 上限 50，terminal state 可从 data 重新派生。
- 共享 cleanup：删除 BaseSession 只供旧 inherit/full-history 使用的 accessors，保留 `getContextSummary` 作为 `--with-parent-summary` seam；删除 pi root 无调用的 legacy catalog builder export。现有 resume/prompt/catalog tests 仅移除或改写旧 API 依赖，未新增测试文件。
- 静态验证：最终 LSP diagnostics 无 error；`npm run check:impact -- <14 个实际源/测试文件>` 已复核 direct dependents；`npm run typecheck` 与 `npm run build` 通过。build 仅报告既有 renderer chunk-size warning；npm 同时报既有 `.npmrc` unknown config warnings。
- 未做的运行验证：按重构政策未新增/运行单测，未启动应用、未做 smoke/E2E 或人工 LLM 委派验证。
- 下游交接：Step 11 消费 manager cancel/state seam；Step 13 只保留旧 CRUD/persist/UI/IPC cleanup，不能再假定旧 backend 存在。`unit-test.md` 已更新 manager observable contract 候选。
- 用户 review 待确认：manager 的 short-lock/recovery 边界、parent prompt仅在可见 tool 时追加、top-level tool cutover 与旧 backend 整体删除。
### 2026-07-16 — Step 9 runner abstraction review

- 用户否决 `SubAgentCommandRunner`：它只为唯一的 `SubAgentManager` 使用，DI interface 没有独立语义或第二个实现，属于无价值抽象。
- 本次修订必须将 commands、facade 与 manager 全部直接收敛到 `SubAgentManager`；删除 interface、`implements` 与所有 re-export，不改变命令 grammar、outcome、授权、state、limits 或 production registration。
- 修订完成：删除 `SubAgentCommandRunner`、其 re-export 与 `SubAgentManager implements`；`commands/{index,list,describe,run}` 和顶层 facade 直接使用 concrete manager，命令行为不变。
- 验证：LSP diagnostics 无 error；`npm run check:impact -- <7 个修改源文件>`、`npm run typecheck`、`npm run build` 均通过。build 仅有既有 renderer chunk-size warning，npm 同时报既有 `.npmrc` unknown-config warnings。
### 2026-07-16 — Step 9 runtime subscription simplification

- 用户确认不采用 EventEmitter；`SubAgentRuntimeStateStore` 只包了一组 listener 与单一 state event，改为内联到唯一 owner `SubAgentManager`。
- 保留同步通知、listener 异常隔离与 unsubscribe 返回值；`runtimeState.ts` 仅保留纯 state projection/reducer，不再拥有 listener store。
- 修订完成：删除 `SubAgentRuntimeStateStore`；manager 直接拥有 listener `Set`、`subscribe()` 与异常隔离的 private `publish()`。`runtimeState.ts` 现在只包含纯 state transition/projection。
- 验证：LSP diagnostics 无 error；`npm run check:impact -- src/main/pi/subagent/runtimeState.ts src/main/pi/subagent/manager.ts`、`npm run typecheck`、`npm run build` 均通过。build 仅有既有 renderer chunk-size warning，npm 同时报既有 `.npmrc` unknown-config warnings。



### 2026-07-16 — Step 9 manager simplification

- 用户确认 `toParent` 已由其自行删除，并要求继续清除同类无价值 helper；本次直接内联 delegate summary，删去冗余 parent/scope 双参传递。
- parent lock 改用现有项目已采用的 `Promise.withResolvers()`，替代手写 deferred resolver；锁的顺序、释放与 map cleanup 语义保持不变。
- 实现细节：删除 `toDelegateSummary`，把安全 summary 直接投影在 list 和 describe 的唯一消费点；`executeRun`/`registerActiveRun` 不再重复接收可由 `scope` 派生的 parent/correlation 字段。
- 验证：manager LSP diagnostics 无 error；`npm run check:impact -- src/main/pi/subagent/manager.ts`、`npm run typecheck`、`npm run build` 均通过。build 仅有既有 renderer chunk-size warning，npm 同时报既有 `.npmrc` unknown-config warnings。

### 2026-07-16 — Step 9 Profile-bound manager review

- 实现：删除全局 `subAgentManager`；`SubAgentManager.forProfile(profile)` 以 `WeakMap<Profile, SubAgentManager>` 返回唯一 profile-bound owner。顶层 `subagent` 在每次 handler 调用时按显式 profile 获得 manager，RegularSession stop 同样通过所属 Profile 取消 active runs。
- review 修复：admission 只读取一次 persisted subrun list 供 recovery 和 reservation gate 复用；已在 listener 注册前中止的 parent signal 立即 abort 实际 controller。
- 文档与测试计划：同步更新 Step 9 manager contract、appcmd reusable facade execution helper、Step 11 stable seam 和 profile-isolation/abort-race 测试候选；未新增测试。

### 2026-07-16 — Step 9 manager ownership guard review

- 用户指出 profile-bound manager 不存在生产跨 Profile 调用；确认顶层 tool、RegularSession cancel 与未来 IPC 都先选择 Profile 后才取得 `SubAgentManager.forProfile(profile)`。
- 删除 `owns()`、五处重复 guard，以及 `loadParentSession` / `authorizeDelegate` 中重复传递的 Profile；manager 保留 `profileId` 仅用于 runtime state、日志和对外 parent identity。
- 这不是降低授权边界：Agent/session/delegate 授权仍由绑定 Profile 的 `getAgent`、`findSessionAcrossKinds` 与 `resolveDelegates` 强制执行；Profile 选择边界保持在 tool/IPC。

### 2026-07-16 — Step 9 profile command cache review

- 用户指出 handler 每次 `createSubAgentCommand()` 会重复创建 registry/router；改为 `WeakMap<Profile, AppCommand>`，同一 Profile 的 immutable command facade 只在首个 tool call 创建。
- command 仍直接绑定该 Profile 的 `SubAgentManager.forProfile(profile)`；不把 command cache 塞入 manager，避免反转 manager → commands 的依赖方向。

### 2026-07-16 — Step 9 用户 review 通过

- 用户确认 Step 9 的 manager、Profile-bound lifecycle、顶层工具显式定义与 production cutover 可接受。
- Step 9 状态切为 `complete`；Step 10/11 前置均已满足，但保持 `pending`，等待用户明确开始。

每个后续 step 完成后继续追加同结构记录。

### 2026-07-16 — Step 10 — awaiting-review
- 实际输出/API：`AgentBasicTab` 将 `description` 纳入 dirty tracker 与 Save All；新增 `AgentDelegationTab`，候选只读 `agents.atom` hot records，selected IDs 只读 `AgentDetail.delegates`。当前 Agent 从候选排除；dangling ID 以 warning + ID 行展示且可取消选择，恢复后自然回到完整 Agent 行。新 tab route 为 `/agent/:agentId/settings/delegation`。
- 编辑器结构：将原 693 行 `AgentEditingView` 拆为 103 行 layout、`useAgentEditorState`（route/dirty/save）与 `AgentEditorTabs`（tab dispatch）；新增组件均低于 500 行。Delegation 提供 Create Agent 和按真实 ID 打开的 Agent settings 导航，使用原生 keyboard checkbox 与现有 semantic token/Lucide。
- 旧路径清理：删除独立 `/settings/sub-agents` route/sidepanel、CRUD UI/atom、CRUD IPC/preload bridge、profile snapshot/store/path/schema、`subAgents` Agent front-matter/detail/compat 字段、storage overview 分类、feature flag、旧 app subagent renderer及专属旧测试。用户磁盘 `sub-agents/` 目录未读取、迁移或删除。
- 计划级联：Step 11 明确旧 app renderer已在本 step删除，改为只注册新顶层 renderer；Step 13 收敛为最终全仓 reachability proof；`context.md`、`unit-test.md` 与架构/模块文档已同步。
- 静态验证：workspace LSP diagnostics 无 error；`npm run check:impact -- <26 个实际源文件>` 已复核受影响模块；`npm run typecheck` 通过；`npm run build` 通过（仅既有 renderer chunk-size warning，及 npm `.npmrc` unknown config warnings）。`src/**/*.ts(x)` 搜索旧 `subAgents`/CRUD IPC/feature-flag symbols 无匹配。
- 未做的运行验证：遵循 Steps 1–13 政策，未新增或运行单测，未启动应用、未做浏览器/smoke/E2E。
- 用户 review 建议：验证 description 保存；A 选择 B；自身排除；archive/restore 后 dangling 行与恢复；Save All/tab 切换；键盘、暗色与窄窗；旧 `/settings/sub-agents` 访问行为。

### 2026-07-16 — Step 10 用户 review 通过
- 用户确认 Step 10 完成；Delegation UI 拆分、dirty/save-all 闭包、路由和旧配置路径删除均获通过。
- Step 11 的前置已满足，但保持 `pending`，仅在用户另行开始后执行。

### 2026-07-16 — Step 11 — awaiting-review
- 实际输出/API：新增 `src/shared/ipc/subagentRun.ts` 的 `getRunData`、`cancelRun` 与 `stateUpdate`；`src/main/startup/ipc/subagent-run.ts` 以 active Profile → parent Agent → parent Session → Subrun 链解析，metadata query 不读取 messages，cancel 明确区分 terminal/not-active/lookup failure。preload 与 renderer client 完整接线。
- live state：`SubAgentManager.subscribeStateUpdates()` 让 IPC 覆盖所有 profile-bound manager；renderer cache 只保留 pending/running，并以 profileId + parent Agent/session + correlationId 关联，已知 result 后再核对 subrunId。final tool JSON 与 persisted data 是 terminal/reload 事实，不依赖 live cache。
- renderer：新顶层 `subagent` renderer 用 Zod 只做展示投影；run result 显示 Agent identity、#ID、文字+icon status、turn/duration、step/snippet、formal content/reason/error/warnings/deliverables 与单取消。list/describe 为只读结果，rejected 不伪造 ID；没有 messages API，故不放 View details placeholder。组件拆分后最大为 258 行。
- 静态验证：相关 LSP diagnostics 无 error；`npm run check:impact -- <12 个代码文件>`、`npm run typecheck`、`npm run build` 均通过。build 仅有既有 renderer chunk-size warning；npm 有既有 `.npmrc` unknown-config warnings。
- 未做：遵循 Steps 1–13 政策，未新增/运行单测，未启动应用、未做 browser/smoke/E2E 或人工 UI 验证。
- Step 12 go/no-go：现有 `MarkdownView` 已直接复用于 formal result，`ToolDetailView` 不需改；完整 hidden transcript 仍无 API。Dialog 至少需新增 messages IPC、懒加载/错误状态和只读 message list，改动跨 main/preload/renderer且仍须用户决定，当前不实施。
- Story 补充：新增 `src/renderer/story/tools/` 下 5 组 Ladle stories，覆盖 `AnimatedHeight`、`ToolChip`、`ToolDetailView` 的 app/shell/web/write/subagent renderer、`ToolCallsSection` 和 Subagent run final/live/cancel。mock Electron bridge 仅在 story helper，采用 lazy import 保证 production component 无 mock 分支。
- Story 验证：`npm run ladle:build` 通过，生成 5.40 MiB 静态预览；随后 `npm run typecheck` 与 `npm run build` 均通过。build 仅有既有 renderer chunk-size warning；npm 有既有 `.npmrc` unknown-config warnings。
- Story 浏览器修复：用户在 `subagent-run-card/formal-result` 实测发现 `undefined.invoke`。已用 browser 复现；根因为 `GeneratedFileCards → agentSessionCacheManager` 的 transitive bridge 依赖漏 mock。仅补齐 `story/tools/mockElectron.ts` 的 agentChat/research/log/human-loop mock，未改生产组件；live fixture 改用相对时间避免异常 duration。
- 浏览器复验：7 个 `Chat / Tools` story route 均无 page error；formal result、五个 renderer gallery、ToolCallsSection、running card 与 Cancel mock 均可渲染。最终 `npm run typecheck`、`npm run ladle:build`、`npm run build` 均通过；build 仅有既有 renderer chunk-size warning，npm 有既有 `.npmrc` unknown-config warnings。
- Subagent chip 补充：用户指出 Subagent card story 未见 tool chip。formal/live stories 现同时渲染真实 `ToolCallsSection` + builtin registry，初始展示 `subagent` chip，点击进入真实 input/output detail；下方保留独立 result card。为修复 check-mixed-imports，Story demo 只直接静态导入具体 production module，外层 story 只 lazy import demo，不混用 `@/components/chat/tool` barrel。浏览器复验无 page error，chip 点击后 detail 正常；`npm run typecheck`、`npm run ladle:build` 通过。
- Subagent chip 样式：`ToolChip` 以稳定顶层 name 识别 subagent，不增加 prop；使用 indigo surface、Bot 图标、delegated-agent tooltip 与专用 aria label，MCP 保持 violet。浏览器确认初始/选中样式与 detail 交互正常；`npm run typecheck`、`npm run ladle:build`、`npm run build` 通过。build 仅有既有 renderer chunk-size warning，npm 有既有 `.npmrc` unknown-config warnings。
- Subagent chip 归属修正：用户指出通用 `ToolChip` 不应有 subagent 分支。已恢复其 MCP-only特化；定制 UI 全部归 `subagentRenderer.Chip` override，class 直接内联 DOM。浏览器确认 indigo/Bot chip 仍正常；`npm run typecheck`、`npm run ladle:build`、`npm run build` 通过。build 仅有既有 renderer chunk-size warning，npm 有既有 `.npmrc` unknown-config warnings。
- Subagent Story matrix：用户要求不止两个 demo。已扩展为 11 个独立 Ladle route：custom chip 的 completed/executing/failed/interrupted、pending、running/cancel、completed/partial/blocked/failed/cancelled、rejected、list/describe read-only、unknown fallback。正式 terminal/rejected/read-only/fallback 都经真实 `ToolDetailView + subagentRenderer` 渲染。浏览器逐一加载 11 个 route 无 page error；`npm run typecheck`、`npm run ladle:build`、`npm run build` 通过。build 仅有既有 renderer chunk-size warning，npm 有既有 `.npmrc` unknown-config warnings。
- Subagent chip tooltip：按用户反馈将静态 tooltip 改为有用信息。`subagentRenderer.Chip` 现在展示 `Delegated Agent` + 当前 cmdline（无 cmd 时说明委派能力）；浏览器 hover 显示完整 run command。`npm run typecheck`、`npm run ladle:build`、`npm run build` 通过。build 仅有既有 renderer chunk-size warning，npm 有既有 `.npmrc` unknown-config warnings。

### 2026-07-16 — Step 11 用户 review 通过
- 用户确认 Step 11 完成：委派运行卡片、audit/cancel IPC、renderer-owned Subagent chip、完整 Ladle renderer Story matrix 均获通过。
- Step 11 状态切为 `complete`；Step 12 保持 `pending`，须由用户另行选择实施或 deferred。

### 2026-07-17 — Step 12 — awaiting-review
- Go 评估：`Session.getSubrun(...).found.subrun.loadDomainMessages()` 已满足 transcript 读取，无需 files/session-list API；现有 shadcn Dialog、MarkdownView 和 RunCard 局部状态即可实现，未触碰 ChatContainer/render-items/main chat cache。
- 实际输出/API：`subagentRun.getRunMessages(parent)` 返回完整 owner chain 的 canonical Domain `Message[]` 或既有 lookup/error union；main/preload/renderer 四层接线。`RunMessagesDialog` 只在 trigger 打开后发起请求，关闭清空状态并以 request token 忽略过期结果；`Chat / Tools / Subagent Run Card / Transcript` Story 直接挂载 production Dialog，mock user/assistant/tool transcript 仅留在 Story。
- 展示/边界：Header 具 Agent/`#ID`/文字+icon status/task/expected output/turn/duration/token usage/可点击 deliverable；Body 仅显示 user/assistant Markdown 与简化只读 tool call，不显示 thinking，不支持 edit/retry/compose/cancel/搜索/export/继续对话；单外层滚动、Radix focus/Esc/trigger focus restore。
- 静态验证：`npm run check:impact -- <7 个代码文件>`、`npm run typecheck`、`npm run build`、`npm run ladle:build` 通过。Ladle 产物 5.42 MiB；build 仅有既有 renderer chunk-size warning，npm 有既有 `.npmrc` unknown-config warnings。未按 Steps 1–13 政策新增/运行单测、启动应用或做 browser/smoke/E2E。
- 下游交接：Step 13 保留 `getRunMessages`、其四层 bridge 和 Dialog；不得把 subrun transcript 重新引入普通 session list、主 chat cache 或 render-items pipeline。Step 14 累积 lazy/owner/race/read-only 测试候选。

### 2026-07-17 — Step 12 用户 review 通过
- 用户确认 Messages Dialog、lazy transcript IPC 与 Ladle Transcript demo 先按当前实现完结；Step 12 状态切为 `complete`。
- Step 13 仍为 `pending`，只能由用户另行明确开始；保留既有 messages IPC/Dialog 作为其稳定输入。
### 2026-07-17 — Step 13 启动与 eval legacy cleanup 决策

- 全仓 production root 复核确认：`tools/index.ts` 仅注册顶层 `subagent`；Regular/Job 仅经新 manager/prompt 接线；`subagentRun` 是唯一 audit/cancel/messages IPC；旧 app command、CRUD IPC/UI/atom、persist store、feature flag 与 backend 目录均已不存在。
- 复核发现唯一功能性旧残留在 `src/main/lib/evalHarness/`：旧委派 JSON 提取和外部 `RunTestResponse` 嵌套 transcript 字段。用户明确选择 clean cutover：删除该字段、解析与专属旧测试；普通扁平 `messages` 仍保留所有工具结果。
- 计划已进入 `in-progress`；此变更不读、不迁移、不删除用户磁盘的历史委派数据。 

### 2026-07-17 — Step 13 — awaiting-review

- 实际清理：删除 AgenticEval 的旧嵌套委派 transcript 响应字段、JSON extractor 与专属旧测试；`messages` 继续以扁平 user/assistant/tool 形态返回普通工具结果。同步删除 bootstrap、shared persist、preload、renderer 注释中的旧命名。
- production root 证明：`tools/index.ts` 只注册顶层 `subagent`；Regular/Job 经新的 command facade/manager 接线；`subagentRun` 是唯一 metadata/lazy transcript/cancel/live-state IPC；全仓 `src` 无旧委派符号、旧 CRUD/store/feature-flag/backend 引用。
- 文档交接：刷新 Agent Loop、trace、主架构、persist、tool system、Pi/tools/subagent、eval harness 和 chat 模块文档；`context.md` 改为实际 `persist/subrun.ts` 路径；`unit-test.md` 仅保留新的 eval response contract 候选。
- 静态验证：`npm run check:impact -- <所有实际修改文件>`、`npm run typecheck`、`npm run build` 均通过；build 仅有既有 renderer chunk-size warning，npm 仍报告既有 `.npmrc` unknown-config warnings。按 Steps 1–13 政策未新增/运行单测，未启动应用、未做 browser/smoke/E2E。
- 下游交接：Steps 1–13 业务结构稳定，Step 14 只能在用户 review 本 step 与 `unit-test.md` 后开始。

### 2026-07-17 — Step 13 用户 review 通过
- 用户确认 Step 13 完成：唯一新委派路径、旧 eval 协议 clean cutover、残留源码清理与文档交接均获通过。
- Step 13 状态切为 `complete`；Step 14 仍为 `pending`，仅在用户明确开始并 review `unit-test.md` 后执行。

### 2026-07-17 — Step 14 — awaiting-review
- 用户要求扩展首批测试；最终新增/扩展 8 个相关测试文件，覆盖 request normalization、runtime state、Subrun allocator/state、delegate resolver、formal submit、command facade、manager admission/cancel/recovery 与 renderer outcome/live-state identity。
- 测试驱动的生产修复：`Profile.resolveDelegates()` 兑现 trim/去空 contract；delegated catalog 对 registry 内同一 `subagent` LocalTool object blacklist，消除静态初始化环；`SubAgentManager` 仅在 admission 后加载 `SubAgentSession`，read-only list/describe 不初始化 LLM session 依赖。
- 验证：expanded focused 8 files / 41 tests 通过；完整 `npm test` 143 files / 1442 tests 通过；`npm run typecheck`、`npm run build` 通过。build 仅有既有 renderer chunk-size warning；测试有既有 node-cron sourcemap、Node url.parse deprecation 和 CrashCapture mock warning，均不影响结果。
- 未做：未运行 E2E，未启动应用或代替用户执行人工委派/UI 验证；未为真实 LLM、跨进程 IPC 或 Dialog 视觉/focus 编写脆弱 mock 测试。
- 用户 review 待确认：扩展后的 P0/P1 筛选范围、三个生产修复与最终验证记录。

### 2026-07-17 — Step 14 用户 review 通过
- 用户确认 Step 14 完成：扩展后的 P0/P1 测试范围、delegate resolver / tool initialization / manager lazy session 三项生产修复，以及完整验证记录均获通过。
- Step 14 状态切为 `complete`；14 Step 重构全部完成。
