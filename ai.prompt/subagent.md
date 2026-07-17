<!-- Last verified: 2026-07-17 -->
# Agent 委派与 Subrun 架构

> **Agent 是唯一可配置实体；Sub-Agent 是普通 Agent 在一次委派中的运行角色。**
> 生产入口唯一为顶层 `subagent` 工具，执行链路为 `tool → SubAgentManager → persisted Subrun → SubAgentSession`。

## 模型与授权

- Agent 的 `description` 用于介绍专长；`delegates: AgentId[]` 定义可委派关系，均由 `AGENT.md` 持久化。
- `Profile.resolveDelegates(parentAgentId)` 是唯一关系解析入口：按配置顺序返回可用 Agent，并将 self、缺失或已归档的 ID 返回为 `unavailableIds`。运行前必须重新解析，不能信任 UI 或 prompt 快照。
- 委派只接受稳定 Agent ID；不按名称查找。复制 Agent 会复制其出边；归档不会改写其它 Agent 的 dangling 引用，目标恢复后关系自然恢复。

## 配置入口

- Agent 编辑器的 Basic tab 管理 `description`；Delegation tab 管理 `delegates`。没有独立 Sub-Agent 配置实体、路由或 CRUD。
- 候选来自 active Agent；当前 Agent 不可选择。dangling ID 仍显示为 unavailable 并可移除，目标恢复后自动成为正常候选。
- `description` 是 Agent 选择与委派提示的热数据；`delegates` 是按需读取的 Agent 详情配置。保存仍走同一 Agent front-matter patch。

## 委派工具

`subagent` 是与 `app`、`web` 并列的顶层 LocalTool，使用 shell 风格命令：

```text
subagent("list")
subagent("describe <agent-id>")
subagent("run <agent-id> --task \"...\" --expect \"...\"")
subagent("continue <subrun-id> --message \"...\"")
```

- `list` 返回当前父 Agent 的可委派目标和 `unavailableIds`；`describe` 仅展示已授权目标的安全能力摘要，不泄露 system prompt、委派图或其它冷配置。
- `run` 创建新的 Subrun：`task`、`expectedOutput` 必填；可选 `--with-parent-summary`、`--max-turns`、`--timeout-seconds`。`continue` 仅接受当前父 session 内已终态的 `subrunId` 与非空 `--message`；复用持久 transcript，不读取父会话完整历史，也不接受 parent summary。
- 一个 assistant response 的多个独立 `subagent("run …")` 调用可并行执行；同一 `subrunId` 的并发 `continue` 只有一个可进入运行，其余显式拒绝。

## 请求与正式结果

- request 在唯一 normalizer 中校验和归一化：`task`、`expectedOutput` 非空；默认 `maxTurns=25`，最大 100；未提供 timeout 时按归一化后的 turn 数 × 60 秒计算，显式或推导值均不超过 60 分钟。
- `parent_summary` 仅作为明确标注为不可信的参考文本注入 delegated prompt，不能改变工具指令或授权边界。
- 所有正式结果都带可信的 `subrunId`、delegate Agent ID、usage、warnings 与 deliverables。状态为 `completed`（content）、`partial`（content + incomplete reason）、`blocked`（reason，可带 content）、`failed`（error）或 `cancelled`（reason）。
- 模型只能提交 `completed`、`partial`、`blocked`；`failed`、`cancelled`、usage 和身份元数据由 session/manager 生成。terminal runtime state 必须与正式 result 的状态一致。

## 执行与能力边界

`SubAgentSession` 从已落盘的 pending Subrun 读取父身份、执行 Agent 和请求，复用 Pi `BaseSession` 的模型循环、压缩、消息桥接与 transcript 持久化。

1. `SubAgentManager` 校验父 Agent 对目标的授权，分配 Subrun，并持有 timeout、取消、并发准入和运行时状态。
2. `SubAgentSession` 在最外层建立 `DelegateExecutionContext { delegateId }`，以目标 Agent 的模型、thinking、prompt、Knowledge 和 Skills 执行。
3. Local 工具仍使用父会话的 `agentId/sessionId`，因此 `local://` 始终属于父会话；Knowledge/Skill 在 delegate context 下使用目标 Agent。
4. 委派 catalog 不含交互式 `ask` 和真实 `subagent` 工具，禁止嵌套。`web research` 与 shell device-auth 在执行边界拒绝；其余 LocalTool 和全局 MCP OAuth 流程保持可用。
5. 委派 Agent 必须通过仅在该 run catalog 中可见的 `submit_result` 交付 `completed`、`partial` 或 `blocked`。未提交时至多提醒一次，之后收敛为 partial 或 failed；取消、超时和异常由运行时生成 cancelled 或 failed。


### 可继续会话

- Subrun 是父 session 内的一段可继续 delegated conversation。首次执行为 `pending → running → terminal`；终态后可由 `continue` 直接进入下一次 `running → terminal` execution，不能在 pending/running 状态下重入。
- 每次 execution 都是完整的 ReAct user turn。初始 execution 使用 `request.task`，未提交时至多追加一条真实 reminder 并再执行一个完整 turn；continuation 将 `--message` 作为真实 user message 追加到同一 transcript，并在消息末尾直接附加 `system-reminder`，该 reminder 计入一次性提醒额度，不再产生独立 reminder turn。提交结果后待当前 turn 自然结束才 formalize。
- 每次 execution 的正式结果与 assistant/tool transcript 均在结束前落盘；终态写入失败不会向父工具调用返回成功。`data.json.histories` 每项对应一次 execution，最后一项是当前/最新状态；terminal 项内保存去除 owner 身份与重复 status 后的正式 result。

## Subrun 持久化与生命周期

Subrun 属于父 Agent 的普通或 Job session，不是独立 session：

```text
agents/{parentAgentId}/sessions/{YYYYMM}/{parentSessionId}/
  files/                 # 父会话与所有 subrun 共享
  subruns/
    001/
      data.json
      messages.jsonl
```

- `SubrunId` 是父 session 局部的三位字符串 `001..999`，`000` 非法。任何 API、IPC 或状态关联都必须携带 profile、父 Agent 和父 session 身份，不能把 ID 视作全局 key。
- `Session.createSubrun/getSubrun/listSubruns` 是唯一持久化入口；`Subrun` 是消息写入与 `data.json` 状态转换的唯一 owner，不进入普通 session SQL 索引，也不单独创建 files 目录。
- `data.json` 使用 `PersistSubrunDataFile` v1：目录链提供 profile、父 Agent/session 身份，文件只保留 `id` 校验、delegate、可恢复 session 状态与 execution histories。首项 initial history 持有重建初始 request 所需的 task、expected output、context、policy；每次 continuation 追加一项，状态变化原位更新该项，不记录冗余 transition event。每个父 session 最多保留 20 个 Subrun reservation，continuation 不创建 reservation。manager 的 `admitExecution()` 在同一父身份短锁内为 run/continue 统一完成 stale recovery、并发准入与 active 注册；分支仅负责 create 或 terminal→running 状态转换，并发 execution 上限为 5。
- 崩溃后没有 active entry 的最新 running history 收敛为 interrupted failed，不自动续跑。进程内 live state 仅用于进度显示；终态和重载事实始终来自持久化 history 投影与正式工具结果。

- 空 reservation、非法 ID 和非法状态转换均以显式结果返回；Subrun 不写普通 session events、SQL index 或独立 files 目录。

## 可见性、取消与 IPC

- 父 RegularSession 或 JobRun 只在 catalog 实际启用 `subagent` 时追加可委派目标提示；SubAgentSession 不获得委派提示。
- `RegularSession.stopStream` 会取消同一父身份下的 active runs。单 run cancel 只影响完整 parent identity + subrunId 指向的目标，不影响并行 sibling。
- `subagentRun` IPC 以 active profile → parent Agent → parent Session → Subrun 的 ownership chain 查询或取消：
  - `getRunState` 返回 manager 的 `SubAgentRuntimeState`；
  - `getRunMessages` 只在详情 Dialog 打开后惰性读取 canonical Domain `Message[]`；
  - `stateUpdate` 推送同一个 `SubAgentRuntimeState` union 的 live 更新。
- renderer 的工具卡片以 profile、父 Agent/session、correlationId 和已知 subrunId 关联 live state；对应父 tool formal result 优先表示该次调用的终态，`getRunState` 负责事件丢失或重载后的恢复。详情 Dialog 只读、关闭即释放 transcript，不进入主聊天缓存。

- runtime state 是带完整 parent identity 的判别联合；live steps 有界且不落盘，重载 state 从持久化 history 重新投影。

## 关键约束

- 不读取、迁移、转换或删除历史 `sub-agents/` 磁盘数据；新路径只使用 Agent graph 与 `subruns/`。
- `Profile.getSubAgentManager()` 是唯一生产构造点：直接 `new SubAgentManager(profile.store)` 并缓存；manager 绑定该 Profile 的 active runs、锁与订阅者，不能作为跨 Profile 全局单例或 static cache。
- 所有可预期业务拒绝通过 discriminated union 返回，不以未声明异常表达。
- 会落盘的 Subrun 类型以 `PersistSubrunDataFile` / `PersistSubrunHistory` 为唯一契约；正式结果只定义一个 `SubAgentRunResult` 判别联合，需要具体分支时通过 `SubAgentRunResultByStatus[Status]` 读取。persisted terminal history 与 runtime terminal state 都复用同一份显式 status→data 映射，不使用 `Extract` / `Omit` 等二次变换。`Subrun` 通过 request/execution/status/timestamp/result 等明确 getter 向 main 暴露语义，manager 与 IPC 统一投影为 `SubAgentRuntimeState`。

## 代码地图

| 区域 | 入口 / 职责 |
|---|---|
| `src/main/pi/subagent/` | request 归一化、commands、formal result、session、manager 与 runtime state |
| `src/main/pi/tools/subagent.ts` | 顶层工具 facade；按当前 Profile 取得缓存 command facade |
| `src/main/persist/subrun.ts` | `Subrun` store、allocator、messages 与状态落盘 |
| `src/shared/persist/types/subrun.ts` | 所有 persisted request/result/data contract |
| `src/shared/types/subAgentRunTypes.ts` | 运行时 state/step contract |
| `src/main/lib/delegateExecutionScope.ts` | delegated-only AsyncLocalStorage scope |
| `src/main/startup/ipc/subagent-run.ts` | metadata、transcript、cancel 与 live-state IPC |
| `src/renderer/components/chat/tool/renderers/subagent/` | 顶层工具结果、运行卡片与 transcript Dialog |

实现细节与协变范围见 [`src/main/pi/subagent/ai.prompt.md`](../src/main/pi/subagent/ai.prompt.md)。
