# Step 4 — 分离执行 Agent 与父 Session 资源所有权

> 状态：complete；用户已确认最终 mode union、旧代码隔离与后续并行替换门禁
> 前置：Step 1 execution identity 命名已确定
> 下游：Steps 5、6、8、9
> 目标是修正上下文模型，不启用新 runtime。

## 1. 问题

当前 ToolContext 的 `agentId` 同时被用于：

- 决定 Agent 的 Skills/Knowledge/配置；
- 定位 `local://` 的 session files。

旧 Sub-Agent 通过注入父 agentId 让 local 恰好正确，却也因此错误使用父 Knowledge/Skills。统一 Agent 后必须表达两个 owner，否则任何新 session 实现都会在资源边界上犯同样错误。

## 2. 开始前 review

1. 阅读 tools/internal-url 模块、persist Session 路径、RegularSession/JobRun 的 ToolContext 构造；
2. 全仓搜索 `ToolContext = {`、`ResolveContext`、`WriteContext`、`toResolveContext`；
3. 将所有生产和 fixture 构造点列入修改清单，不能依靠 optional fallback；
4. 运行 impact 并读工具、Pi、persist 文档；
5. 旧 SubAgentSession 只为编译可做最小字段补齐，不借此重构旧逻辑、不测试旧模块。

## 3. 目标语义

ToolContext：

- `agentId`：`sessionId` 所属的 Agent，保持普通会话原语义；
- `sessionId`：regular session 或 job run；
- `mode: 'agent'`：普通 Agent 在自己的 session 中执行；
- `mode: 'delegate'` + `delegateId`：由普通 Agent 委派给另一个 Agent 执行。

普通 Regular/Job：`{ mode: 'agent', agentId, sessionId }`。

新 Sub-Agent run：`{ mode: 'delegate', agentId: parentAgentId, sessionId: parentSessionId, delegateId }`。

## 4. Internal URL 规则

`ResolveContext` / `WriteContext` 同步采用相同的 mode union：

- LocalProtocolHandler 始终用 `agentId` 找 session；
- KnowledgeProtocolHandler 在 delegate mode 使用 `delegateId`，否则使用 `agentId`；
- SkillProtocolHandler 同样按 execution Agent 检查 bindings；
- `toResolveContext/toWriteContext` 显式保留 discriminant 与 delegateId；
- delegate mode 缺 delegateId 是编译错误，不做 optional fallback。

这一步只解决 ownership，不在 handler 内加入 delegated allowlist；URI/absolute path policy 属于 Step 5。

## 5. Tool/AppCommand context 协变

- 所有 ToolContext 构造点显式填写 `mode`；delegate 分支必须填写 `delegateId`；
- AppCmdContext 使用相同 discriminated union；新 `subagent run` 仅保留正式的 parent-summary getter，不承载旧 Sub-Agent 配置读取；
- shell URI resolution、read/write/find/search 使用新的 resolve context；
- tools debug IPC 使用 `mode: 'agent'`；若 debug path 无 session，保持现有失败语义，不伪造成功；
- tracer/correlation fields 以 execution Agent 与 parent session 分别记录，命名不能歧义。

## 6. Persist owner seam

Step 6 需要从父 session root 创建 `subruns/`。本 step 应确认/提供不按路径猜 kind 的 API：

- `Agent.findSessionAcrossKinds(sessionId)` 可作为天然不区分 regular/job 的 lookup；
- 新代码通过 `agentId + sessionId` 取得 parent `Session`；
- 不在 ToolContext 传绝对 session path，避免权限绕过和持久化布局泄漏。

若需要新增公共 helper，只暴露最小 Session 共同能力，不能把整个 store 泄漏给工具层。

## 7. 旧代码处理

旧代码不属于 Step 4 稳定输出，也不获得新兼容契约。由于旧 `app subagent` 到 Step 9 前仍是生产入口，只允许一个临时安全适配：

- 旧 `lib/subAgent/SubAgentSession` 构造 delegate mode，因旧模型没有普通 Agent delegate ID，临时以父 `agentId` 填 `delegateId`，仅用于保持递归拒绝；
- 旧配置读取封装在旧 command/kernel 内，不进入 `ToolContext`、`AppCmdContext` 或 `BaseSession`；
- 不为该 bridge 增加测试候选、不继续协变旧 runtime；Step 9 取消旧注册时必须删除 bridge 与旧 guard。

## 8. 静态验证

- 搜索确认所有 ToolContext/ResolveContext object literals 已显式赋 owner；
- typecheck/build/impact；
- 不运行 internal-url integration test，不做端到端测试或手工文件读写；如用户希望验证，停下交给用户。

## 9. 下游交接

记录最终字段名和 owner lookup API：

- Step 5 用它约束 local/knowledge/skill；
- Step 6 用 owner 解析 parent session root；
- Step 8 构造 executor/owner 不同的 session tool context；
- Step 9 manager 校验 parent ownership。

同步更新 `unit-test.md` 候选，不创建测试。

## 10. Review 门禁

用户已 review 通过。Step 5 仍需在新的 session/明确指令下开始，不自动跨 step。
