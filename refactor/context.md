# Agent / Sub-Agent 统一重构：跨 Session 共享上下文

<!-- Last updated: 2026-07-16 -->

> 本文件是多 session 重构的共享事实源。它记录稳定目标、已确认决策、目标模块边界、阶段之间的数据契约，以及“规划何时必须失效并重写”的规则。每个执行 session 必须先读本文件、`progress.md`、`unit-test.md` 和对应 `stepN.md`。

## 1. 最终目标

DESKMATE 只保留一种用户可配置实体：`Agent`。Sub-Agent 不再是第二种配置实体，而是普通 Agent 在一次父会话委派中的**运行角色**。

最终模型：

```text
Agent（唯一配置实体）
  ├─ id / name / description / system prompt
  ├─ model / thinking / tools / MCP / Skills / Knowledge
  └─ delegates: AgentId[]

Parent Session
  ├─ messages.jsonl
  ├─ files/                         # 父与所有 subrun 共享产物目录
  └─ subruns/
      ├─ 001/
      │   ├─ data.json
      │   └─ messages.jsonl
      ├─ 002/
      └─ ...

Sub-Agent Run（运行角色）
  ├─ parent agent/session
  ├─ executing agent
  ├─ task / expectedOutput / context policy / limits
  ├─ reduced capability policy
  ├─ hidden persisted transcript
  └─ formal result
```

原始讨论输入：`tmp/unify-agent-subagent.md`。讨论稿不是实现约束；本文件中用户后续确认的决策优先。

## 2. 已确认决策

### 2.1 唯一 Agent 实体与委派关系

- Agent 新增 `description?: string`，用于介绍专长和帮助父 Agent 选择委派对象。
- Agent 新增 `delegates?: string[]`，元素是稳定 Agent ID，不按 name 引用。
- 自委派禁止。
- 被归档或暂时不存在的 target ID 保留为 dangling reference：UI 显示 unavailable，运行时明确拒绝；目标恢复后关系自然恢复。
- duplicate Agent 时复制其 outgoing delegates；不修改其它 Agent 的 incoming references。
- 不新增第二套“被委派时专用 Agent 配置”。

Step 2 实际落地 API（2026-07-16）：

- `AgentRecord.description?` 是 `agents.json` hot 缓存；源真值仍是 AGENT.md front-matter `description`；`AgentDetail` 不重复该字段。
- AGENT.md front-matter 与 `AgentDetail` 新增 `delegates?: string[]`；`AgentFrontPatch` 支持 description/delegates，`CreateAgentInput` 支持 description。
- 不再提供独立 delegates normalization helper；`Agent.patchFront` 按类型化输入原样保存 delegates，避免为简单数组制造第二层抽象。
- `Profile.resolveDelegates(parentId): Promise<ResolvedAgentDelegates | null>` 在解析时 trim/去空/稳定去重；parent record/AGENT.md 缺失返回 `null`，self/dangling/archived ID 进入 `unavailableIds`，available 按配置顺序 join active registry。
- duplicate 复制 description 与 outgoing delegates；archive 不改其它 Agent 的 incoming references。
- renderer 既有 `AgentPersona` bridge 暂时映射 description/delegates；Step 10 UI 使用 `agents.atom` candidates + `agentDetail.atom.delegates`，不读取旧 subAgents atom。
- 错误契约原则：可预期业务失败必须出现在 TypeScript 返回类型中；普通函数/方法不得通过未声明的 `throw` 表达 not-found、self-reference、invalid-state 等正常分支。

### 2.2 不做旧数据迁移

- **不读取、不转换、不备份、不删除用户磁盘上的旧 `sub-agents/` 数据。**
- 新功能只读取普通 Agent registry 和新 subrun 数据。
- 旧数据留在原位置，不进入新 snapshot、prompt、runtime 或 UI；它只是未使用的历史数据。
- 因为没有迁移，计划中不存在 migration journal、legacy model 决策、legacy Knowledge 复制或兼容入口。

### 2.3 新实现的位置和依赖方向

新主体直接实现于：

```text
src/main/pi/subagent/
  ├─ types.ts / policy.ts
  ├─ prompt.ts
  ├─ catalog.ts
  ├─ submitResult.ts
  ├─ subrunStore.ts 或 persist adapter
  ├─ session.ts
  ├─ manager.ts
  ├─ commands/
  └─ ai.prompt.md
```

确切文件可在 Step 1 review 时按实现边界调整，但必须满足：

- 新生产路径不继续扩写 `src/main/lib/subAgent/`；
- 对 Pi turn loop、ToolCatalog、message bridge、persist Session 的复用通过清晰接口完成；
- 不复制一套与 `BaseSession` 长期漂移的完整聊天引擎；
- `src/main/pi/subagent` 只依赖 Pi 内部与公开 persist API，外部模块通过 `@main/pi` 或明确的新入口使用，不产生反向循环。

### 2.4 旧代码采用并行替换，不做就地演进

旧代码包括：

- `src/main/lib/subAgent/`；
- `src/main/persist/subAgents.ts`、`lib/subAgentMarkdown.ts`；
- `src/main/pi/appcmd/builtins/app/subagent/`；
- 独立 Sub-Agent CRUD IPC/UI/atom。

后续规则：

1. 新实现只从当前通用基础设施和已确认的新契约生长；旧代码最多只读了解产品问题，不作为实现模板，也不打开旧测试寻找预期。
2. cutover 前，未来 step 的修改文件清单不得包含旧目录/文件；不得修旧 bug、改旧签名、补旧测试或给旧实现适配新 API。
3. 若共享接口变更会让旧调用方无法编译，优先新增只由新路径消费的 additive seam，或把 breaking change 延后到 cutover；禁止通过修改旧 caller 解围。
4. Step 5–8 的新 policy/session 不能仅凭 `mode:'delegate'` 全局激活，因为 Step 4 的旧 bridge 也暂用该 mode；新能力必须由新 catalog/executor/session 显式接线。
5. cutover 先从生产 root 删除对旧模块的 import/注册/路由，再证明旧子树不可达；一旦某个旧子树成为 orphan，就在同一步整体删除源码和旧测试，不留下编译期耦合，也不逐文件“维护到能编译”。
6. 物理删除源码不等于迁移或删除用户数据：磁盘上的旧 `sub-agents/` 目录始终不读、不改、不删。
7. Step 4 已存在的 `delegateId=agentId` 是唯一历史例外；后续不再扩展它，Step 9 通过整体删除旧 backend 源码消除，而不是继续修改 bridge。

### 2.5 独立顶层 `subagent` 工具

不再把委派能力放在 `app subagent ...`。

LLM 顶层工具目标：

```text
read / write / find / search / ask / shell / app / web / subagent
```

`subagent` 与 `app`、`web` 并列，使用同一 cmdline facade 范式：

```text
subagent("--help")
subagent("list")
subagent("describe <agent-id>")
subagent("run <agent-id> --task \"...\" --expect \"...\"")
```

架构：

- `src/main/pi/tools/subagent.ts` 只是与 `app.ts` / `web.ts` 对等的薄 facade；
- registry、commands 和业务 kernel 归 `src/main/pi/subagent/commands/`；
- 可复用 `appcmd/makeRouterCommand.ts`、`executeCommandFacade.ts`、flags/tokenizer 等通用基础设施；顶层 LocalTool 的 schema、description 与 handler 保持在各自工具文件中；
- 不把新业务重新塞进 `appcmd/builtins/app/`；
- 被委派 Agent 的 catalog 完全移除 `subagent` 顶层工具，从结构上禁止嵌套。

Step 3 实际落地 API（2026-07-16）：

- `createSubAgentCommand(manager)` 构建注册 `list` / `describe` / `run` 的独立 registry/router；顶层 facade 不持有全局 runner，而是在每次 tool handler 调用时，从显式 `ToolContext.profileId` 对应的 active `Profile` 取回其 WeakMap-cached command facade（首次以 `SubAgentManager.forProfile(profile)` 创建）。
- command scope 包含 profile、parent Agent/session、signal、tracer、correlationId；manager 方法直接返回既有显式 `result | rejected` outcomes。
- `list` 返回 resolver 配置顺序的 available hot summaries（ID/name/description/model）与 `unavailableIds`；`describe` 只接受 available ID，再按需读取一个 target detail，排除 system prompt、delegates、legacy subAgents、zero state。
- `run` flags 固定为 `--task`、`--expect`、`--with-parent-summary`、`--max-turns`、`--timeout-seconds`、`--help/-h`；不支持 `--json`、name key、旧 share-context/full-history 或 run-many。旧 `app subagent` 和 `lib/subAgent` backend/测试已整体删除。被委派 catalog 通过同一 LocalTool 对象 blacklist 排除 `subagent`。

### 2.5.1 Step 9 production manager（2026-07-16）

- `SubAgentManager.forProfile(profile)` 返回每个 Profile 唯一的 WeakMap-bound command runner 与 lifecycle owner；调用方先在 tool/IPC 边界选择 Profile，manager 不再重复比较传入 `profileId`，内部 map key 因而只需 parent Agent/session。每个 parent identity 以短锁串行 `listSubruns → stale-running recovery → total gate → createSubrun → active registration`，max parallel=5、persisted reservation max total=20。
- `cancelRun` / `cancelByParentSession` / `getRuntimeState` 都要求完整 parent identity；runtime state 只作该 Profile 的有界进程内 live snapshot，terminal/reload 事实从 Subrun data 派生。无 active entry 的 stale `running` 写成 interrupted failed。已中止 parent signal 在 listener 绑定前也会 abort 实际 session controller。
- RegularSession/JobRun 仅在实际 catalog 含 `subagent` 时于通用 prompt 后追加 Agent graph guidance；RegularSession stop 会通过所属 Profile 的 manager 取消同 parent 的 active runs。SubAgentSession 不获得 delegation guidance。

### 2.6 Subrun 三位序号

- Subrun ID 是父 session 内局部唯一的三位十进制字符串：`001`、`002`、…、`010`、…、`099`、…、`999`。
- 类型/校验规则：`001..999`，等价于 `^(?!000$)[0-9]{3}$`；`000` 非法。
- ID 只在 `(profileId, parentAgentId, parentSessionId)` scope 内有意义；IPC/日志不得把 `001` 当全局唯一键。
- allocator 在父 session 下使用单飞锁：扫描/读取已分配的最大序号，取 `max + 1`，原子创建 `subruns/<id>/data.json` 完成 reservation。
- 并发多个 `subagent` tool calls 必须通过 per-parent-session allocator lock 获得不重复、按 reservation 顺序递增的编号。
- 当前每父 session 最多 20 次委派，因此正常范围只到 `020`；仍实现 `001..999` 的完整校验。超过 `999` 明确拒绝，不复用旧编号。
- 目录名和对外 `subrunId` 使用同一个三位字符串，不再另造 run ULID。
- `SubrunId` 及 `isSubrunId` / `parseSubrunId` / `formatSubrunId` 是 persist contract，定义于 `src/shared/persist/types/subrun.ts`；`SubrunId` 是非 branded 的语义别名。

### 2.7 Delegate Execution Context 与资源归属

`src/main/lib/delegateExecutionScope.ts` 是**仅限委派运行**的 AsyncLocalStorage：

```ts
interface DelegateExecutionContext {
  delegateId: string;
}
```

- 正常 Agent execution 不建立 store，`getDelegateExecution()` 返回 undefined。
- 未来 `SubAgentSession` 在真正执行 delegated Agent 的最外层以 `runWithDelegateExecution({ delegateId }, action)` 包住整个 run；不在 RegularSession、JobRun、工具 dispatcher 或 Internal URL router 建 scope/fallback。
- scope 只表达“当前正在执行 delegated Agent”及其 delegate ID，不重复 parent profile/agent/session identity；这些继续来自现有 ToolContext/ResolveContext。

资源规则：

- `local://` → 现有 parent `agentId/sessionId` files，永远不看 scope；
- `knowledge://` / `skill://` → `getDelegateExecution()?.delegateId ?? ctx.agentId`；
- 不默认暴露父 Agent Knowledge；subrun 不建独立 files 目录。

新/通用能力在需要差异时只读取 `getDelegateExecution()`：有值是 delegated run，无值是原有正常路径。禁止 agent scope、scope fallback、`enterWith()`、全局 mutable flag、eventSender 或 IPC 角色推断。

### 2.7.1 Step 8 单 run session 实际契约（2026-07-16）

- `SubAgentSession({ subrun, signal, parentTracer?, callbacks? })` 只消费 pending `Subrun` 已落盘 data；不接收第二份 parent/delegate/request，避免身份与 request 双事实源。
- `run()` 的可预期非启动结果为 `{ kind:'not_pending', status }`；成功收敛为 `{ kind:'result', result }`。terminal persistence 失败是 I/O 错误，向上抛出且不会返回内存结果。
- session 最外层建立 delegate scope；执行 Agent runtime config、通用 prompt 和 catalog 归 delegate，`ToolContext` 仍持 parent identity + delegateId。通用 prompt 不包含委派指导，SubAgentSession 不追加该部分。
- `BaseSession` 只新增通用 protected run-environment/iteration/completion seams。Regular/Job 不加角色分支；submit/missing-submit 语义完全在 SubAgentSession 的 loop 外编排：每次 BaseSession 调用都是完整 ReAct user turn，外层结束后才被动读取 controller，必要时 append reminder 并开始下一 turn。`maxTurns` 跨这些 turn 累计，不依赖 `toPiContext` options。
- 终态顺序：assistant/tool transcript flush → formal result build → running metadata/context persist → terminal `Subrun.finish` → `onResult` / return。manager 仍负责授权、admission、timer、abort ownership 和 runtime state。
- parent abort 覆盖 BaseSession abortor 创建前的 startup window：SubAgentSession 在启动前、mark-turn metadata persist 后，以及每个完整 ReAct turn 前后收敛 cancelled；进入 loop 后 listener 直接 abort BaseSession controller。不得让已取消 run 发起首个 LLM 请求。

### 2.7.2 未来 delegated follow-up 边界（待独立设计）

- 当前 Subrun persisted union 是 `pending → running → terminal`，`Subrun.start()` 仅接受 pending、`finish()` 仅接受 running；Step 8 的 session 因此是 one-shot terminal delivery，不具备 terminal 后续聊 API。
- 主 Agent 后续追问同一 delegate 不能通过重开 terminal Subrun 实现，否则会破坏 formal result、finishedAt 与 reload-safe audit 事实。未来需明确选择“长寿命 delegated conversation + 多次 delivery records”或“新的 continuation Subrun + 明确 history/reference link”，在独立 step review 后再变更 persisted contract。

### 2.8 委派请求和上下文

`SubAgentRunRequest`（`src/shared/persist/types/subrun.ts`）包含：

- `delegateAgentId: string`；
- `task: string`；
- `expectedOutput: string`；
- `context: SubAgentRunContext`，默认 `{ kind: 'isolated' }`，可选 `{ kind: 'parent_summary', summary }`；
- `policy: { maxTurns, timeoutMs }`。

main 私有唯一归一化入口是 `normalizeSubAgentRunRequest`：文本 trim + 非空校验；`maxTurns` 默认 25、最大 clamp 100；timeout 缺省按归一化后的 maxTurns × 60 秒推导，最大 clamp 60 分钟。
首版：

- 不支持 full history；
- 不支持 JSON Schema typed output；
- 不改成异步 handle + join，父 tool call 同步等待正式结果；
- 同一个 target Agent 在不同调用中可接不同 expectedOutput/limits。

### 2.9 正式结果与显式提交

被委派 Agent 必须通过 delegated-only `submit_result` 动作交付。它不进入普通 Agent catalog。

正式结果 `SubAgentRunResult` 是 discriminated union：

- `completed`：`content`；
- `partial`：`content + incompleteReason`；
- `blocked`：`reason`，可带 `content`；
- `failed`：`error`；
- `cancelled`：`reason`。

共享字段固定为：`subrunId`、`delegateAgentId`、`deliverables`、`warnings`、`usage`；usage 是 `turns + durationMs + tokenUsage?`。Step 1 只固定类型，不预建 result/usage/list normalizer；真实校验留给 Step 7 的 submit/result 边界，deliverable URI 权限同时由 policy 校验。

`SubAgentRuntimeState` 同样是 discriminated union：所有事件携带 `profileId + parentAgentId + parentSessionId + subrunId`；terminal 分支的 `status` 与 `result.status` 在类型上强关联。

共享 union 的各分支使用命名 `interface extends Base` 表达公共字段继承；`type` 只聚合分支。存在可选 interface 方案时，不写 `type Xxx = Aaa & Bbb`。

未调用 submit_result：

- 最多给一次固定 reminder；
- 达到轮数/timeout 后按 partial 或 failed 收敛；
- 不用自然语言 regex 猜“是否做完”；
- 不把最后一条 assistant 文本直接冒充 completed。

Step 7 实际 API（2026-07-16）：

- `createSubmitResultTool(controller)` 生成未注册的 `LocalTool`；`ToolCatalog.withSubmitResult(tool)` 只为一个 delegated catalog snapshot 追加普通 local route。所有 local route 直接持有 tool object、走同一执行 helper；普通 catalog 和全局 registry 均不可见。
- `SubmitResultController` 的状态只允许 `open → submitted`；重复调用返回显式 rejected，首份合法模型 payload 不可覆盖。
- 模型只能提交 completed/partial/blocked；分支文本、warnings/deliverables、`local://` parent path 都在唯一输入边界校验。runtime metadata、failed/cancelled 不信任或接收模型参数。
- `buildFormalResult()` 合并可信 `subrunId`、delegate、usage、工具产物；`decideMissingSubmit()` 只产生一次 reminder 或 `result_not_submitted` partial/failed，Step 8 负责注入 transient reminder 和最终持久化。

Step 7 用户 review（2026-07-16）已确认：`submit_result` 是 dedicated tool，但它只作为 delegated catalog 的普通 local route 存在；所有 catalog local route 直持选中的 `LocalTool`，`resolveIdentity()` 对未知 route 仅作展示性 fallback，执行边界仍拒绝未知调用。

### 2.10 能力硬边界

被委派 Agent 的能力边界只在 `getDelegateExecution()` 有值时于真实执行点收紧：

- ToolCatalog 按 LocalTool 对象黑名单过滤；黑名单包含交互式 `ask` 与已注册的真实 `subagent` 对象，禁止嵌套委派。
- `read`、`write`、`find`、`search`、`shell`、download 及 app/web 的非交互子命令与普通 Agent 行为一致；Local 仍用 parent context，Knowledge/Skill 仍用 delegate ID。
- `web research` 在 delegated run 拒绝；已知 shell device-auth 命令在启动前拒绝，不能创建当前委派会话的 human-loop 卡片。
- MCP OAuth 使用同一全局 consent/client-id/browser flow，不因 delegate context 降级；自身已授权的 MCP tools 与普通 Agent 同行为。
- 无 delegate context 时，普通 Agent 路径保持既有行为。

Step 5 实际目标 API（delegate-only redesign）：

- scope API 只有 `DelegateExecutionContext`、`runWithDelegateExecution`、`getDelegateExecution`、`isDelegatedExecution`；normal execution 不建 store。
- ToolCatalog 仅在 delegate context 下按 LocalTool 对象黑名单过滤；Step 7 的 `withSubmitResult()` 是已落地且仅限单次 delegated catalog 的私有 route。
- 新 LocalTool 默认可见；Step 9 注册真实 `subagent` 对象时加入黑名单。只有 `web research` 与已知 shell device-auth 命令在执行边界读取 delegate context 并拒绝；MCP Auth 不读取它。

### 2.11 持久化和详情 UI

目标布局：

```text
agents/{parentAgentId}/sessions/{YYYYMM}/{parentSessionId}/
  data.json
  messages.jsonl
  files/
  subruns/
    001/
      data.json
      messages.jsonl
```

- subrun 不进 regular session picker，不进 `regular_sessions` / `job_runs` SQL 表；
- transcript 持久化用于 review、调试和后续 UI；
- app crash 后遗留 running subrun 收敛为 interrupted/failed，不自动续跑；
- 父 session 删除/归档时自然携带 subruns。
- `SubrunId`、request/result/usage/context/policy 与 `SubrunDataFile` 都是落盘 contract，定义于 `src/shared/persist/types/subrun.ts` 并经其唯一入口导出；`shared/types/subAgentRunTypes.ts` 只保留不落盘的 runtime state/step。main `Subrun` store 是唯一 fs owner，`Session.createSubrun/getSubrun/listSubruns` 以 parent scope 暴露它。`Subrun` 直接实现 Pi 的最小 `PersistSessionLike`，用临时 per-`subruns/` lock 完成 scan → atomic mkdir reservation → initial data write；load 不自动改变 stale running，Step 9 负责唯一 recovery。
- Step 6 用户 review 已确认该类型归属：任何会写入磁盘的 Subrun 类型必须留在 `shared/persist/types`；不得将其移回 runtime shared types。

Renderer 基线必须能渲染委派工具卡片和正式结果。消息详情 Dialog 是独立 Step：

- 如果核心 card 与 audit IPC 完成后成本可控，则实现；
- 如果需要大规模改动 message render pipeline，则只保留经过代码现状校验的详细后续方案，不阻塞核心重构；
- 是否实施由 Step 11 review 后的用户决定，不能擅自扩大。

## 3. 动态规划更新机制（强制）

用户会在每个 step review 后给出新意见。任何意见都可能使后续规划失效，因此计划不是一次性冻结文档。

### 3.1 每个新 session 的固定动作

1. 读取 `context.md`、`progress.md`、`unit-test.md`、当前 `stepN.md`；
2. 检查 `progress.md` 的“最近决策变更”和“失效步骤”；
3. 对照当前仓库 review 当前 step；
4. 若计划过时，**先改文档，不改代码**；
5. 将当前 step 标记为 `reviewing-plan`，用户 review 同意后才 `in-progress`。

### 3.2 用户反馈后的级联更新

收到影响架构/契约的反馈时，同一 session 必须：

- 更新 `context.md` 的稳定决策；
- 更新 `progress.md` 的决策日志和依赖图；
- 更新当前 step；
- 找出所有依赖当前输出契约的未来 steps，逐一更新；
- 更新 `unit-test.md` 中受影响的测试候选；
- 若暂时无法确定后续方案，将相关 step 标成 `needs-replan`，不得继续按旧文档执行。

禁止只改当前 step 而让后续文档继续引用废弃字段、命令或目录。

### 3.3 Step 完成后的交接

每个业务 step 完成后必须更新：

- 实际新增/修改文件和导出；
- 已实现契约与原计划偏差；
- 静态验证结果；
- 未执行的行为验证；
- `unit-test.md` 新增候选测试；
- 对后续 steps 的输入是否仍成立。

然后停下等待用户 review，不自动进入下一 step。

## 4. 验证策略

用户要求开发过程不做端到端测试，且新单元测试统一后置。

### 4.1 实施 Steps 1–13

- 不写新的单元测试文件；
- 不做 Electron/browser/manual runtime smoke；
- 不做端到端测试；
- 不主动启动应用验证行为；
- 每 step 更新 `unit-test.md`，记录未来需要保护的 observable contracts；
- 仅进行代码静态验证：`check:impact`、类型检查/构建、必要的 lint/编译诊断；
- 仓库若对被修改模块强制要求已有回归命令，只运行既有检查，不在该阶段扩写测试；
- 如果某行为只有运行才能判定，停止并交给用户测试，不自行代测。


### 4.2 Step 14

所有业务逻辑稳定并逐步 review 通过后，统一 review `unit-test.md`，经用户确认后再写/运行单元测试。即使到这一步仍不做端到端测试，除非用户另行改变决定。

## 5. 新旧代码边界

### 5.1 新生产代码

| 模块 | 目标职责 |
|---|---|
| `src/main/pi/subagent/types.ts` | main 私有运行类型与 request normalization |
| `src/main/lib/delegateExecutionScope.ts` | 仅限委派 run 的 AsyncLocalStorage `delegateId`；normal execution 没有 store |
| `src/main/pi/tool.ts` | delegate-aware catalog；Step 7 再按需添加 submit route |
| `src/main/pi/subagent/prompt.ts` | delegated operating prompt / context boundary |
| `src/main/pi/subagent/subrunStore.ts` | 三位 ID allocator + hidden transcript/data adapter |
| `src/main/pi/subagent/submitResult.ts` | explicit result submission |
| `src/main/pi/subagent/session.ts` | BaseSession-based delegated run |
| `src/main/pi/subagent/manager.ts` | limits/cancel/state/lifecycle |
| `src/main/pi/subagent/commands/` | `list` / `describe` / `run` 与未来真实子命令的 router 扩展点 |
| `src/main/pi/tools/subagent.ts` | 顶层 facade |

文件拆分在 Step 1 以实际依赖为准；禁止为了凑地图创建空壳或无价值 wrapper。

### 5.2 必须协变的现有代码

- `src/shared/persist/types/agent.ts`；
- `src/main/persist/agent.ts` / `profile.ts` / `session.ts`；
- `src/main/pi/session/base.ts` / regular/job；
- `src/main/pi/tool.ts` / tools types / internal URLs；
- generic appcmd facade/router；
- shared delegation IPC + preload + renderer binding；
- Agent editor / agents atom / tool renderer。

旧 `lib/subAgent` 与 `app subagent` backend 已在 Step 9 production cutover 整体删除。旧 persist SubAgents store、独立 CRUD IPC/UI/atom 仍待 Step 10/11/13 在其生产引用归零后分别删除；旧磁盘数据始终不读、不改、不删。

## 6. 步骤依赖总图

```text
Step 1  契约 + 新模块骨架
  ├─> Step 2  Agent delegates 持久化
  ├─> Step 3  顶层 subagent facade/command grammar
  └─> Step 4  executor/session-owner 上下文分离

Step 2 + Step 3 + Step 4
  └─> Step 5  delegated capability policy/catalog

Step 1 + Step 2 + Step 4
  └─> Step 6  三位 subrun store

Step 1 + Step 5
  └─> Step 7  submit_result + formal result lifecycle

Step 2 + Step 4 + Step 5 + Step 6 + Step 7
  └─> Step 8  BaseSession-based delegated session

Step 3 + Step 6 + Step 8
  └─> Step 9  manager + command + production main cutover

Step 2
  └─> Step 10 Agent Delegation 配置 UI

Step 6 + Step 9
  └─> Step 11 runtime card + cancel + audit IPC

Step 11 review
  └─> Step 12 可选 messages Dialog（可 deferred）

Steps 9–12
  └─> Step 13 入口收口、旧代码隔离、文档

Steps 1–13 review complete
  └─> Step 14 统一编写单元测试
```

这张图是承上启下的权威关系。任何 step 输出契约变化，必须沿箭头更新所有下游计划。

## 7. 明确不做

- 旧本地 Sub-Agent 数据迁移；
- Claude Code Sub-Agent import/export 兼容；
- 任意深度嵌套委派；
- async spawn handle + join；
- full parent history；
- JSON Schema typed output；
- token/cost 硬预算；
- delegated shell；
- subrun 进入普通 session picker/SQL index；
- 开发过程中的端到端测试；
- 业务完成前新增单元测试；
