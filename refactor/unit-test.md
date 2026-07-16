# 统一重构：累积单元测试规划

<!-- Last updated: 2026-07-16 -->

> 目的：业务 Steps 1–13 只写生产代码，不新增单元测试。每个 step 完成后把需要保护的 observable contracts 追加到本文件。所有业务逻辑和用户逐步 review 完成后，Step 14 再统一删减、编写和运行测试。

## 使用规则

1. 当前内容是候选测试，不是承诺全部实现；
2. 每条测试必须保护可观察行为、边界、状态转换或真实错误，不测源码文本和内部实现细节；
3. 用户改变 contract 时，当前 session 同步更新/删除失效候选；
4. Steps 1–13 不创建新 `*.test.ts`；
5. 如果实现阶段遇到必须依赖运行验证才能继续的风险，停止请用户测试，不提前偷写测试；
6. Step 14 开始前先让用户 review 本文件，再确定最终测试集合；
7. 本重构不规划 E2E 测试。

## 优先级

- P0：数据不变量、安全边界、取消/并发/持久化状态机；
- P1：核心 command/request/result contract、reload 行为；
- P2：纯显示/helper，只有真实回归价值时保留。

## Step 1 候选：共享契约

- [ ] P0 `SubrunId` 接受 `001/010/999`，拒绝 `1/01/000/1000/abc`。
- [ ] P1 runtime policy 默认值与 max clamp 行为明确。
- [ ] P1 isolated / parent_summary context union 不接受 full_history。

### Step 1 实际补充 — 2026-07-16
- 实际 contract：`SubrunId` 非 branded，合法范围 `001..999`；request 由唯一 main 私有 normalizer 收敛；result/runtime state 只在 shared 固定 discriminated union。
- 新增候选：policy 缺省 timeout 随 normalized maxTurns 推导并受 60 分钟上限约束。
- 删除/改写候选：删除 Step 1 result/usage/list normalizer 测试；真实 result validation、数组稳定去重和 parent-local URI 授权统一归 Step 7。
- 最高风险：`SubrunId` 是 parent-scoped 普通字符串，后续 store/IPC 不得单独用它做 key。
- 需要用户在 Step 14 前决定：无。

## Step 2 候选：Agent graph

- [ ] P0 resolver trim/忽略空值/稳定去重，保持首次出现顺序。
- [ ] P0 self ID 保留在配置但只解析为 unavailable，永不进入 available。
- [ ] P0 dangling target 保留并解析为 unavailable；archive/restore 状态切换正确。
- [ ] P1 description/delegates AGENT.md round-trip。
- [ ] P1 duplicate 原样复制 outgoing delegates。
- [ ] P1 reload + patch 后 AgentRecord/AgentDetail 同步；snapshot 不 fan-out 读 AGENT.md。

### Step 2 实际补充 — 2026-07-16
- 实际 contract：description 是 AGENT.md 源真值 + AgentRecord hot 缓存；delegates 是 AgentDetail cold 字段；resolver 返回按配置顺序的 available records + unavailable IDs。
- 新增候选：resolver 对 parent record/AGENT.md 缺失返回 null；self/dangling/archived 进入 unavailable；resolver 不读取 target AGENT.md。
- 删除/改写候选：删除独立 normalizer、Markdown 新增 throw、patch/load self error 和 normalization round-trip 测试；delegates 写路径只验证原样 round-trip。
- 最高风险：任何 manager/prompt 调用方绕过 `Profile.resolveDelegates` 会漏掉 self/dangling/archive 规则。
- 需要用户在 Step 14 前决定：无。

## Step 3 候选：顶层 cmdline facade

- [ ] P0 `run` 必须有 agent-id、task、expect。
- [ ] P0 `list` 保持 resolver available 配置顺序并返回 unavailable IDs；parent config 缺失显式 rejected。
- [ ] P0 `describe` 只接受 available ID；安全投影不含 systemPrompt/delegates/subAgents/zero。
- [ ] P1 `--help` / unknown command / malformed quoting 遵循 app/web facade 统一语义。
- [ ] P1 Step 3 尚未 production register，不能出现在普通 catalog。

### Step 3 实际补充 — 2026-07-16
- 实际 contract：registry 当前注册 `list` / `describe` / `run`；三者统一使用必填 runner DI 与 `{ outcome }` envelope，保留未来真实子命令扩展空间。
- 新增候选：`list` 的 hot summary 字段、顺序、unavailable IDs 与 rejected；不得 fan-out 读取 target detail。
- 新增候选：`describe` 单 target cold read，localTools 用 `all | selected` union，MCP/Skills 只投影安全选择；任意未授权/失效 ID rejected。
- 新增候选：run 秒到毫秒转换拒绝非正/非 safe integer，policy 上限仍由 normalizer clamp；parent summary getter 缺失/失败显式返回命令错误。
- 新增候选：runner 的 result/rejected outcomes 均产生 `{ outcome }`，rejected 设 exit 1；顶层 help 与 `run --help` 指导同一 response 多 call 并行。
- 改写候选：Step 3 的“未 production register”只做 registry/catalog observable 检查，不测源码文本；Step 9 注册后改为 cutover 测试。
- 最高风险：Step 9 adapter 绕过 resolver、describe 泄漏 cold 敏感字段，或 run 共享 admission/allocator 无法承受并发 tool calls。
- 需要用户在 Step 14 前决定：是否保留 help 文案关键句断言；默认不做整段 snapshot。

## Step 4/5 候选：Delegate Execution Context 与能力边界

- [ ] P0 normal execution 没有 delegate store，既有 catalog/app/web/MCP 行为不变。
- [ ] P0 `runWithDelegateExecution({ delegateId })` 跨 await/parallel tool calls 保持 delegateId，不污染同时运行的 normal execution。
- [ ] P0 delegated catalog 不含黑名单中的 `ask` 对象；Step 9 注册真实 `subagent` 对象后，同一测试证明它也不可见。
- [ ] P0 delegated read/write/find/search、shell、download 与非交互 app/web 子命令保持普通 Agent 行为；Knowledge/Skill 仍使用 delegateId，Local 始终使用 parent ToolContext。
- [ ] P0 delegated `web research` 与已知 shell device-auth 命令在创建 human-loop 前拒绝；其它 shell 命令可执行。
- [ ] P0 delegated MCP OAuth 可走全局 consent/client-id/browser 流程，与普通 Agent 同行为。

### Delegate-only redesign 实际补充 — 2026-07-16
- normal Agent 不创建 AsyncLocalStorage context；只有 Step 8 SubAgentSession 外层建立 `{ delegateId }`。
- 删除候选：不测试 agent scope、normal scope root、scope fallback、`withTool` 或提前 inline route；Step 7 再按真实 submit_result 输入设计最小私有 route。
- 最高风险：normal path 意外获得 delegate context，或 Local 误用 delegateId。
- 需要用户在 Step 14 前决定：无。

## Step 6 候选：三位 subrun store

- [ ] P0 新父 session 首次分配 `001`，之后 `002`，已有 gap 不复用。
- [ ] P0 并发 reservation 不重复且得到连续编号。
- [ ] P0 `999` 后明确 exhausted，不覆盖旧 run。
- [ ] P0 data 状态 union round-trip，running stale load 收敛 interrupted failure。
- [ ] P0 messages append/flush/rehydrate 保持 tool response 关联。
- [ ] P1 subrun 不产生 files 目录、不写 regular/job SQL index。
- [ ] P1 regular parent 与 job-run parent 路径正确。

### Step 6 实际补充 — 2026-07-16
- 实际 contract：所有会写入 `data.json` 的 `SubrunId`、request/result/usage/context/policy、`SubrunDataFile` 均位于 `shared/persist/types/subrun.ts`；该文件通过 `@shared/persist/types` 导出。未落盘的 `SubAgentRunStep` / `SubAgentRuntimeState` 留在 `shared/types/subAgentRunTypes.ts`。data union 以 pending/running/五类 terminal 命名 interface 表示；nested `session` 直接满足 `PersistSessionLike` 的 title/updatedAt/contextState/turn。
- 新增候选：`getSubrun` 区分 invalid ID、missing、empty-reservation `incomplete` 与 parent identity 不匹配 `corrupt`；`start` 仅 pending 可进入 running，`finish` 仅 running 可接受自身 ID/delegate 一致的 result。
- 删除/改写候选：不让 load 自动把 stale running 改为 failed；Step 9 的唯一 bootstrap/query recovery 入口测试该收敛。
- 最高风险：allocator 必须覆盖同一 parent 的并发 `Session` 实例；目录 reservation 成功而 data write 失败时 ID 绝不复用。
- 需要用户在 Step 14 前决定：无。

## Step 7 候选：正式提交

- [ ] P0 submit_result 只在 delegated catalog 可见。
- [ ] P0 completed/partial/blocked 参数验证和 formal result 映射正确。
- [ ] P0 result normalizer 校验各 status 必填字段、usage 非负整数及 parent-local deliverable URI。
- [ ] P0 重复 submit 被拒，不覆盖首个正式结果。
- [ ] P0 deliverables/warnings 去重且保持顺序。
- [ ] P1 未 submit 一次 reminder 后仍无 submit → partial/failed。

### Step 7 实际补充 — 2026-07-16
- 实际 contract：`submit_result` 是 `ToolCatalog.withSubmitResult()` 追加的未注册普通 local route；所有 catalog local route 都直持选中的 `LocalTool`，controller 一次性保存首份合法模型 payload，formal builder 才注入 trusted runtime metadata。
- 新增候选：普通 `buildToolCatalogForAgent()` 与全局 `ToolsRegistry` 永不出现 submit_result；private handler 的 rejected 仍按正常 tool error 回填。
- 新增候选：空白/错误类型文本、failed/cancelled 模型 status、非 local URI、空 path、`.`/`..` traversal deliverable 都被拒；tool 与 submit deliverables、warnings 按首次顺序合并去重。
- 新增候选：invalid usage metadata 返回 explicit invalid_metadata；system partial/failed/cancelled 可由 runtime 构建，而模型提交不能伪造它们。
- 改写候选：未提交 fallback 在首次可继续时仅返回固定 reminder；已提醒、无 tool 或 max-turn 时才按 assistant content 收敛 `result_not_submitted` partial/failed。
- 最高风险：Step 8 不能绕过 controller/formal builder、自行把最后文本标 completed，或把 submit tool 注册进全局 registry。
- 需要用户在 Step 14 前决定：无。

## Step 8 候选：SubagentSession

- [ ] P0 使用 target Agent 自己的 model/prompt/thinking/catalog。
- [ ] P0 transcript 在每轮/每个 tool result 后持久化。
- [ ] P0 submit 立即结束后续 LLM iteration。
- [ ] P0 maxTurns/timeout/cancel/error 映射到正确 terminal result/data。
- [ ] P0 parent summary 作为不可信 reference boundary 注入。
- [ ] P1 RegularSession/JobRun 既有 turn loop 行为不被新增 hooks 改变。

### Step 8 实际补充 — 2026-07-16
- 实际 contract：SubAgentSession 从 pending Subrun data 唯一派生 parent/delegate/request，在 delegate scope 内使用 delegate runtime config/catalog/prompt；`ask` 不在 catalog、`submit_result` 只在该 session snapshot 内。
- 新增候选：pending 以外的 `run()` 返回 explicit `not_pending`；submit_result 不会提前终止当前 ReAct loop，只有该完整 loop 自然结束后才 formalize；无 submit 时外层仅 append/flush 一条 reminder user message，再执行完整第二 turn，transcript 保持 user → assistant → user → assistant；总 maxTurns 跨两 turn 累计，耗尽后按 `result_not_submitted` partial/failed 收敛；parent abort/stream abort → cancelled，runtime error → failed。
- 新增候选：每轮 assistant/tool transcript 先 flush，terminal `Subrun.finish` 成功后才 resolve result；finish I/O 失败不得返回 completed；回调只收到 bounded text snippet、tool step 与 terminal formal result。
- 新增候选：BaseSession default environment 和 Regular/Job 既有 30-turn/stop 行为不因 delegated seams 改变。
- 最高风险：manager 重复拼 prompt/result、把 parent identity 替换为 delegate identity，或在 terminal persist 前向父 tool call 返回成功。
- 需要用户在 Step 14 前决定：无。
- 新增候选：parent abort 落在 `Subrun.start()` 与 BaseSession abortor 创建之间、mark-turn persist 后、首条 transcript append 后时，均先收敛 cancelled 且不进入首次 LLM stream。
- 后续独立设计候选（不纳入当前 Step 14）：terminal Subrun 不可被 reopen；若引入 delegated follow-up，必须验证每次 delivery 与 conversation lifetime 的 persisted state 不混淆。

## Step 9 候选：Manager 与生产工具

- [ ] P0 parent delegates 未授权/self/dangling/archived target 全部明确拒绝。
- [ ] P0 list/describe adapter 都复用 `Profile.resolveDelegates`；describe 只对一个已授权 target 读取 detail。
- [ ] P0 每 parent session max parallel/max total 生效；所有 terminal finally 释放 active slot。
- [ ] P0 timeout 触发真实 abort，而非只 Promise.race 返回。
- [ ] P0 cancel single 不影响 siblings；cancel parent 取消全部。
- [ ] P0 多个并发 `subagent` tool calls 共享 max parallel/total，单个失败不取消 siblings。
- [ ] P1 production catalog 注册顶层 subagent，app registry 不再注册 subagent command。
- [ ] P1 tool result JSON 可稳定恢复 formal results 与 subrun IDs。

### Step 9 实际补充 — 2026-07-16
- 实际 contract：manager 以完整 parent identity 管理 active run；短锁将 persisted total gate、stale-running recovery、reservation 与 active registration 串行化，timeout abort 实际 controller 后等待 SubAgentSession 收尾。
- 新增候选：跨进程残留的 running Subrun 仅在没有同 parent active entry 时收敛为 interrupted failed；`cancelRun` 只影响一个完整 key，`cancelByParentSession` 取消全部 siblings；runtime state steps FIFO 上限 50，terminal state 可由 persisted data 恢复。
- 新增候选：同一 `Profile` 的多次 `SubAgentManager.forProfile(profile)` 返回同一 owner，不同 Profile 的 active run/lock/listener 互不共享；Profile 选择只在 tool/IPC 边界完成，manager 不维护第二套 cross-profile rejection 分支。
- 新增候选：parent signal 在 active registration 后、abort listener 绑定前已经中止时，实际 session signal 仍为 aborted，且最终释放 active slot。
- 删除/改写候选：删除旧 `app subagent spawn/spawn-many`、旧 manager 和 legacy catalog builder 的测试候选；生产 catalog 应验证顶层 subagent 可见时 delegate catalog 不含同一 LocalTool 对象。
- 最高风险：并发 run 绕过 reservation total gate，或 parent cancel/timeout 只中断等待而没有 abort 真正 session。
- 需要用户在 Step 14 前决定：无。

## Step 10 候选：配置 UI 数据层

- [ ] P1 editor patch 将 description/delegates 正确映射到 persist API。
- [ ] P1 current Agent 不出现在可选 target；dangling selection 保留可移除。
- [ ] P2 dirty tracking/save-all 在 tab 切换后不丢 delegates。
- [ ] P2 独立 `/settings/sub-agents` 不再有生产 route。

## Step 11 候选：runtime renderer/IPC

- [ ] P0 state event 用 parent identity + subrunId 区分不同 session 的 `001`。
- [ ] P0 cancelRun 校验 active profile/parent ownership/terminal state。
- [ ] P1 live event 更新正确 task；reload 后只靠 persisted final tool result 仍能渲染。
- [ ] P1 completed/partial/blocked/failed/cancelled 均映射正确 label/content。
- [ ] P1 audit query 返回 data，不自动拉 messages。

## Step 12 候选：Messages Dialog（仅实施时）

- [ ] P1 打开时 lazy fetch messages，关闭前不请求。
- [ ] P1 loading/error/empty/transcript 状态切换。
- [ ] P2 Dialog focus restore、Esc close、terminal transcript 只读。

若 Step 12 deferred，删除本节候选或保留在明确的“后续独立任务”区，不纳入 Step 14。

## Step 13 候选：入口收口

- [ ] P1 registry/snapshot/prompt 不再读取旧 SubAgents store。
- [ ] P1 旧源码即使存在，也没有 production imports/registration/routes。
- [ ] P1 feature flag 不会隐藏新 delegation 能力。

## Step 14 执行顺序建议

1. 先写 P0 pure/store/policy tests；
2. 再写 manager/session tests；
3. 再写 command/parser 与 renderer data tests；
4. P2 只在实现真的脆弱且测试稳定时写；
5. 运行相关模块测试，再按仓库要求运行完整 `npm test`；
6. 不新增 Playwright/Electron E2E。

## Step 完成更新模板

```text
### Step N 实际补充 — YYYY-MM-DD
- 实际 contract：
- 新增候选：
- 删除/改写候选：
- 最高风险：
- 需要用户在 Step 14 前决定：
```
