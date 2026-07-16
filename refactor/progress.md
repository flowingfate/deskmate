# Agent / Sub-Agent 统一重构进度

<!-- Last updated: 2026-07-16 -->

## 执行管控
- 每个 session 只聚焦做一个 step 的任务，绝不跨 step；
- 如果要做 todo list，那么每个 step 只做一个 todo list，绝不跨 step；

## 当前状态

- 总体阶段：**Step 7 complete，等待用户另行开始 Step 8**
- 当前门禁：Step 7 submit_result/state-machine 与 local route 统一设计已获用户 review 通过；未进入 Step 8
- 业务步骤：7 / 13 complete；Step 8 为 `pending`
- 测试步骤：Step 14 尚未开始；Step 7 未新增或运行单测
- 生产代码变更：新 submit tool 仍只存在于 delegated catalog snapshot，未注册到全局 registry；新 subagent facade 仍未注册，旧 `app subagent` 仍是生产入口
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
| 8 | [BaseSession 驱动的新 SubagentSession](step8.md) | pending | Steps 2,4,5,6,7 | 可执行单个 persisted delegated run 的 session |
| 9 | [Manager、顶层工具接线与主进程 cutover](step9.md) | pending | Steps 3,6,8 | production `subagent` tool、limits/cancel/state；旧 app command 下线 |
| 10 | [Agent Delegation 配置 UI](step10.md) | pending | Step 2 | description/delegates UI；独立 Sub-Agent 管理入口下线 |
| 11 | [委派运行卡片与 audit/cancel IPC](step11.md) | pending | Steps 6,7,9 | reload-safe card、live state、single cancel、run metadata query |
| 12 | [可选 Messages Dialog](step12.md) | pending | Step 11 review | 可实现则交付 Dialog；否则交付 verified deferred design 并标 deferred |
| 13 | [证明新路径唯一并删除残留旧源码](step13.md) | pending | Steps 9–12 | 新路径唯一生效；残留旧源码/测试删除；全局文档更新 |
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
- 实际输出/API：`createSubAgentCommand(runner)`；`createSubagentTool(runner)`；`SubAgentCommandRunner.listDelegates/describeDelegate/run`；父 scope；三类 result/rejected outcomes；list/describe 安全 view types。
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

每个后续 step 完成后继续追加同结构记录。
