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

## Step 4 候选：资源 ownership

- [ ] P0 executor=B、owner=A 时 local 命中 A session，knowledge/skill 命中 B。
- [ ] P0 B 无法通过 knowledge URI 读取 A knowledge。
- [ ] P0 regular/job 非委派路径 executor===owner，行为不回归。
- [ ] P1 ToolContext/ResolveContext 转换不丢 signal/owner。

## Step 5 候选：能力 policy

- [ ] P0 delegated catalog 永远不含 subagent/ask/shell，即使 Agent tools 显式选择。
- [ ] P0 write 只允许 local；absolute/knowledge/skill 拒绝。
- [ ] P0 read/find/search 只允许 local/own knowledge/bound skill。
- [ ] P0 app Agent/MCP/Skill/Schedule 写命令拒绝，只读命令允许。
- [ ] P0 web research 拒绝，search/fetch/download 允许且 download 目标只能 local。
- [ ] P0 MCP human-loop/auth/elicitation 拒绝。
- [ ] P1 未分类的新 command 默认 deny。

## Step 6 候选：三位 subrun store

- [ ] P0 新父 session 首次分配 `001`，之后 `002`，已有 gap 不复用。
- [ ] P0 并发 reservation 不重复且得到连续编号。
- [ ] P0 `999` 后明确 exhausted，不覆盖旧 run。
- [ ] P0 data 状态 union round-trip，running stale load 收敛 interrupted failure。
- [ ] P0 messages append/flush/rehydrate 保持 tool response 关联。
- [ ] P1 subrun 不产生 files 目录、不写 regular/job SQL index。
- [ ] P1 regular parent 与 job-run parent 路径正确。

## Step 7 候选：正式提交

- [ ] P0 submit_result 只在 delegated catalog 可见。
- [ ] P0 completed/partial/blocked 参数验证和 formal result 映射正确。
- [ ] P0 result normalizer 校验各 status 必填字段、usage 非负整数及 parent-local deliverable URI。
- [ ] P0 重复 submit 被拒，不覆盖首个正式结果。
- [ ] P0 deliverables/warnings 去重且保持顺序。
- [ ] P1 未 submit 一次 reminder 后仍无 submit → partial/failed。

## Step 8 候选：SubagentSession

- [ ] P0 使用 target Agent 自己的 model/prompt/thinking/catalog。
- [ ] P0 transcript 在每轮/每个 tool result 后持久化。
- [ ] P0 submit 立即结束后续 LLM iteration。
- [ ] P0 maxTurns/timeout/cancel/error 映射到正确 terminal result/data。
- [ ] P0 parent summary 作为不可信 reference boundary 注入。
- [ ] P1 RegularSession/JobRun 既有 turn loop 行为不被新增 hooks 改变。

## Step 9 候选：Manager 与生产工具

- [ ] P0 parent delegates 未授权/self/dangling/archived target 全部明确拒绝。
- [ ] P0 list/describe adapter 都复用 `Profile.resolveDelegates`；describe 只对一个已授权 target 读取 detail。
- [ ] P0 每 parent session max parallel/max total 生效；所有 terminal finally 释放 active slot。
- [ ] P0 timeout 触发真实 abort，而非只 Promise.race 返回。
- [ ] P0 cancel single 不影响 siblings；cancel parent 取消全部。
- [ ] P0 多个并发 `subagent` tool calls 共享 max parallel/total，单个失败不取消 siblings。
- [ ] P1 production catalog 注册顶层 subagent，app registry 不再注册 subagent command。
- [ ] P1 tool result JSON 可稳定恢复 formal results 与 subrun IDs。

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
