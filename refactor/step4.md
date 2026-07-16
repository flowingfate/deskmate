# Step 4 — 分离执行 Agent 与父 Session 资源所有权

> 状态：待执行
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

- `agentId`：executor Agent；
- `sessionOwnerAgentId`：拥有 `sessionId` 的 Agent；
- `sessionId`：regular session 或 job run；
- `isSubAgent` 暂保留作为运行角色标记，后续可改成更明确的 mode union，但本 step 不扩大。

普通 Regular/Job：两个 ID 相同。

新 Sub-Agent run：executor = delegate，sessionOwner = parent。

## 4. Internal URL 规则

`ResolveContext` / `WriteContext` 同步加入 `sessionOwnerAgentId`：

- LocalProtocolHandler 用 owner Agent 找 session；
- KnowledgeProtocolHandler 用 executor Agent；
- SkillProtocolHandler 用 executor Agent bindings；
- `toResolveContext/toWriteContext` 显式逐字段映射；
- 缺 owner 直接编译/运行错误，不猜 `agentId`。

这一步只解决 ownership，不在 handler 内加入 delegated allowlist；URI/absolute path policy 属于 Step 5。

## 5. Tool/AppCommand context 协变

- 所有 ToolContext 构造点显式填写 owner；
- AppCmdContext 只有确实需要资源定位的 commands 才透传该字段，但字段映射必须显式；
- shell URI resolution、read/write/find/search 使用新的 resolve context；
- tools debug IPC 需要一个明确 owner 值；若 debug path 无 session，保持现有失败语义，不伪造成功；
- tracer/correlation fields 仍以 executor 和 parent session 分别记录，命名不能歧义。

## 6. Persist owner seam

Step 6 需要从父 session root 创建 `subruns/`。本 step 应确认/提供不按路径猜 kind 的 API：

- `Agent.findSessionAcrossKinds(sessionId)` 可作为天然不区分 regular/job 的 owner lookup；
- 新代码通过 owner Agent + session ID 取得 `Session`；
- 不在 ToolContext 传绝对 session path，避免权限绕过和持久化布局泄漏。

若需要新增公共 helper，只暴露最小 Session 共同能力，不能把整个 store 泄漏给工具层。

## 7. 旧代码处理

旧 `lib/subAgent/SubAgentSession` 仅做编译所需字段映射：

- 若它继续传父 agentId，则 owner 同为父；
- 不尝试让旧 runtime 获得新 own Knowledge 行为；新正确行为由 Step 8 新 session 实现；
- 不改旧测试、不修旧 bug。

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

用户 review 后才进入 Step 5。若 ownership 字段改成 nested scope 或 discriminated union，Steps 5、6、8、9 必须级联重写。
