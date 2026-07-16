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

### 2.4 旧代码只作只读参考

旧代码包括：

- `src/main/lib/subAgent/`；
- `src/main/persist/subAgents.ts`、`lib/subAgentMarkdown.ts`；
- `src/main/pi/appcmd/builtins/app/subagent/`；
- 独立 Sub-Agent CRUD IPC/UI/atom。

规则：

1. 可以读它了解已有问题、UI 信息和取消/进度需求；
2. 不以旧类结构为新设计模板；
3. 不修旧 bug、不补旧单测、不为旧代码保持新 API 兼容；
4. production cutover 后取消注册和入口，但文件可暂时留在仓库作为 reference；
5. 后续是否物理删除由用户另行决定，本次不强制删除。

### 2.5 独立顶层 `subagent` 工具

不再把委派能力放在 `app subagent ...`。

LLM 顶层工具目标：

```text
read / write / find / search / ask / shell / app / web / subagent
```

`subagent` 与 `app`、`web` 并列，使用同一 cmdline facade 范式：

```text
subagent("--help")
subagent("run <agent-id> --task \"...\" --expect \"...\"")
subagent("run-many --config-json '[...]'")
```

架构：

- `src/main/pi/tools/subagent.ts` 只是与 `app.ts` / `web.ts` 对等的薄 facade；
- registry、commands 和业务 kernel 归 `src/main/pi/subagent/commands/`；
- 可复用 `appcmd/makeRouterCommand.ts`、`_facade.ts`、flags/tokenizer 等通用基础设施；
- 不把新业务重新塞进 `appcmd/builtins/app/`；
- 被委派 Agent 的 catalog 完全移除 `subagent` 顶层工具，从结构上禁止嵌套。

### 2.6 Subrun 三位序号

- Subrun ID 是父 session 内局部唯一的三位十进制字符串：`001`、`002`、…、`010`、…、`099`、…、`999`。
- 类型/校验规则：`001..999`，等价于 `^(?!000$)[0-9]{3}$`；`000` 非法。
- ID 只在 `(profileId, parentAgentId, parentSessionId)` scope 内有意义；IPC/日志不得把 `001` 当全局唯一键。
- allocator 在父 session 下使用单飞锁：扫描/读取已分配的最大序号，取 `max + 1`，原子创建 `subruns/<id>/data.json` 完成 reservation。
- 并发 `run-many` 必须得到不重复且按 reservation 顺序递增的编号。
- 当前每父 session 最多 20 次委派，因此正常范围只到 `020`；仍实现 `001..999` 的完整校验。超过 `999` 明确拒绝，不复用旧编号。
- 目录名和对外 `subrunId` 使用同一个三位字符串，不再另造 run ULID。
- shared helper 固定为 `isSubrunId` / `parseSubrunId` / `formatSubrunId`，定义于 `src/shared/types/subAgentRunTypes.ts`；`SubrunId` 是非 branded 的语义别名。

### 2.7 执行身份与资源归属

一个委派运行有两个 Agent 身份：

- `agentId` / executor：被委派 Agent，决定 model、prompt、Tools、MCP、Skills、Knowledge；
- `sessionOwnerAgentId`：父 session 的 owner，决定 `local://` / subrun 物理位置。

资源规则：

- `local://` → 父 session files；
- `knowledge://` → executor Agent 的 Knowledge；
- `skill://` → executor Agent 自己绑定的 Skills；
- 不默认暴露父 Agent Knowledge；
- subrun 不建独立 files 目录。

### 2.8 委派请求和上下文

`SubAgentRunRequest`（`src/shared/types/subAgentRunTypes.ts`）包含：

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

### 2.10 能力硬边界

被委派 Agent：

- catalog 不含 `subagent`、`ask`、`shell`；
- `write` 仅允许父 `local://`；
- `read/find/search` 仅允许父 local、自身 knowledge、已绑定 skill；
- `app` 只允许明确的只读子命令；Agent/MCP/Skill/Schedule 长期状态写入拒绝；
- `web search/fetch/download` 可用，research/human-loop 拒绝；download 只能写父 local；
- 自身已授权的 MCP tools 原则可用，但 human-loop/auth/elicitation 拒绝；
- prompt 规则只是说明，catalog/router/dispatcher 才是安全边界。

`shell` 暂不开放：cwd 限制不等于 OS sandbox。以后若设计出跨平台硬隔离，再单独立项。

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
| `src/main/pi/subagent/prompt.ts` | delegated operating prompt / context boundary |
| `src/main/pi/subagent/catalog.ts` | reduced catalog + submit tool |
| `src/main/pi/subagent/policy.ts` | local/app/web/MCP capability policy |
| `src/main/pi/subagent/subrunStore.ts` | 三位 ID allocator + hidden transcript/data adapter |
| `src/main/pi/subagent/submitResult.ts` | explicit result submission |
| `src/main/pi/subagent/session.ts` | BaseSession-based delegated run |
| `src/main/pi/subagent/manager.ts` | limits/cancel/state/lifecycle |
| `src/main/pi/subagent/commands/` | cmdline run/run-many |
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

### 5.3 旧参考代码

旧 `lib/subAgent`、persist SubAgents store、`app subagent`、独立 CRUD UI 不属于新生产依赖。取消入口后可以留文件，不测试、不协变、不从新代码 import。

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
- 本次强制物理删除旧参考源码。
