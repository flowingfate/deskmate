# Agent / Sub-Agent 统一重构进度

<!-- Last updated: 2026-07-16 -->

## 执行管控
- 每个 session 只聚焦做一个 step 的任务，绝不跨 step；
- 如果要做 todo list，那么每个 step 只做一个 todo list，绝不跨 step；

## 当前状态

- 总体阶段：**Step 3 complete，等待开始 Step 4**
- 当前门禁：Step 4 `pending`；尚未开始计划 review
- 业务步骤：3 / 13 complete
- 测试步骤：Step 14 尚未开始
- 生产代码变更：新增未注册的顶层 `subagent` command/facade construction seam；旧 `app subagent` 仍是生产入口
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
| 1 | [目标契约与 Pi/Subagent 边界](step1.md) | complete | `context.md` | `src/shared/types/subAgentRunTypes.ts`；`src/main/pi/subagent/types.ts`；模块依赖规则 |
| 2 | [Agent description/delegates 持久化](step2.md) | complete | Step 1 AgentId/contract | 可落盘的 Agent graph、ID resolver、IPC patch |
| 3 | [独立顶层 subagent cmdline facade](step3.md) | complete | Step 1 request grammar | 未注册的新 facade/registry/run parser，供 Step 9 接 manager |
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
| 多个 tool calls 并发分配序号冲突 | per-parent-session allocator lock + atomic reservation | 6 | 已规划 |
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

每个后续 step 完成后继续追加同结构记录。
