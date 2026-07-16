# Step 5 — 建立委派能力 Policy 与 Reduced ToolCatalog

> 状态：待执行
> 前置：Step 1 `SubAgentRunRequest`/`SubAgentRuntimeState`、Step 2 graph resolver、Step 3 顶层工具名称、Step 4 ownership context
> 下游：Steps 7、8、9、14
> 本步只构建新路径专用 policy/catalog seam，尚无新 SubAgentSession，也不改变旧 runtime 行为。

## 1. 为什么在 session 前做

能力削减是安全边界，不应由 session prompt 临时决定。先完成 catalog、参数和 router policy，Step 8 的新 session 才能从第一天只拿到合法能力，而不是先 unrestricted 再补 denylist。

## 2. 开始前 review

1. 枚举实际顶层 LocalTools；预计为 read/write/find/search/ask/shell/app/web，Step 9 后再加 subagent；
2. 枚举 app/web 当前所有 commands 和 subcommands；
3. 阅读 ToolCatalog route、executeToolCall、appcmd router/dispatcher、MCP execute path、人机交互入口；
4. 搜索未来新增 command 的注册模式，确认“未分类默认 deny”能落在集中位置；
5. 运行 impact 并读 tool-system、pi/tools、MCP 文档；
6. 不打开或修改旧 Sub-Agent 源码/测试；能力契约只来自本计划、普通 Agent 配置和当前通用工具实现。

Step 2 已具备输入：`Profile.resolveDelegates(parentId): Promise<ResolvedAgentDelegates | null>`；null 表示 parent record/AGENT.md 缺失，调用方必须显式处理。非 null 时 available 按配置顺序，self/dangling/archived 位于 unavailable。Policy/授权不得直接读 `agent.config.delegates`、按 name fallback，或把 null 当空授权列表。

Step 4 已具备输入（2026-07-16）：四类 context 使用 `mode:'agent' | 'delegate'` discriminated union；`agentId + sessionId` 永远定位父 session，delegate 分支必填 `delegateId`。local 按 `agentId`，knowledge/skill 按 execution Agent。旧 runtime 仍有一个临时 delegate-mode bridge，因此本 step 禁止仅凭 `ctx.mode` 在全局 dispatcher 中自动启用新 policy；新 policy 必须由新 catalog/executor 显式注入。

## 3. Policy 模型

在 `src/main/pi/subagent/policy.ts` 定义只由新生产路径消费的 policy，避免把判断散落到普通 command 或旧 runtime：

- 顶层 LocalTool capability；
- app/web command/subcommand capability；
- internal URI/path constraints；
- MCP interaction constraints。

Policy 应尽量是纯数据 + 纯判定函数：

```text
allow | deny(reason, recoveryHint)
```

新 command 未声明时默认 deny。错误必须告诉模型允许替代方案，不能 silent no-op。

## 4. Reduced catalog

`src/main/pi/subagent/catalog.ts` 根据 executor Agent 自身配置构建：

- local tools 从其 `tools` selection 获取；
- MCP 从其 `mcpServers` selection 获取；
- 强制移除 `ask`、`shell`、`subagent`；
- Step 7 再追加 delegated-only submit_result；
- 不继承 parent tools/MCP；
- Agent 配置无法突破系统 deny；
- catalog build 失败返回明确 run failure，不用空 catalog 静默继续。

不要读取或扩写旧 `buildToolCatalogForSubAgent(cfg, disallowTools)`；新入口只接普通 Agent runtime config，并使用独立命名/API。

## 5. Local tool 参数边界

集中 policy 在执行前检查，并依赖 Step 4 owner context：

### read

允许：

- `local://...`（parent session）；
- `knowledge://...`（executor）；
- executor 已绑定的 `skill://...`。

拒绝绝对路径、相对 OS 路径、其它未授权 scheme。

### write

只允许 `local://...`。拒绝 knowledge/skill/absolute/path traversal。

### find/search

root 只允许 local/knowledge；若 search 的实现必须接受绝对 resolved path，policy 应在 resolve 前校验原始 URI并携带授权 scope，不能让模型直接传任意绝对路径。

## 6. `app` router policy

顶层 `app` 保留，但子命令分级：

- allow：time；Agent/MCP/Skill/Schedule 明确只读 list/status/search；
- deny：agent add/update/remove/set-primary/delegation edits；mcp add/update/remove/connect/disconnect/reconnect；skill install/uninstall/bind/unbind；schedule create/update/remove/run；
- 新 reduced app router/policy table 将旧 `app subagent` 视为不存在；即使 Step 9 前旧全局 registry 仍注册，也不修改旧 command 来配合；
- help 只描述 delegated run 可用子命令，避免引导模型反复撞禁止路径。

分类表归 `pi/subagent`，未知 command 默认 deny。不要给旧 command 添加 metadata，也不要在旧 kernel 内增加 delegate-mode 分支。

## 7. `web` policy

- allow search/fetch/download；
- deny research，因为它依赖 human confirmation/window；
- download destination 必须是 parent local；
- 未知新 web command default deny。

## 8. MCP policy

- executor 自身已选 MCP tool可执行；
- 调用若触发 OAuth setup、device auth、elicitation、human approval，委派模式立即失败；
- 不允许 MCP config/connection 管理命令；
- policy scope 随 ToolContext 传入，不靠 eventSender=null 推断。

## 9. 现有路径必须保持

RegularSession/JobRun 与旧 Sub-Agent runtime 的 catalog、dispatcher 和 app/web 行为均不因本 step 改变。新 policy 只有新 reduced catalog/executor 显式持有时才生效，不能把 `mode === 'delegate'` 当全局开关。

## 10. 不做

- 不实现 submit_result；
- 不写 subrun store/session/manager；
- 不注册顶层 subagent；
- 不改 UI；
- 不新增/运行新单测；
- 不修改或运行旧 Sub-Agent 源码/测试；
- 不做实际安全攻击或 E2E 测试。

## 11. 静态验证与交接

- typecheck/build/impact；
- 静态枚举确认所有当前 app/web commands 已分类；
- 搜索确认新 policy 不 import 旧 `lib/subAgent`；
- 修改文件清单搜索确认不包含旧 `lib/subAgent`、旧 `appcmd/.../subagent`、旧 persist/UI 路径；
- 更新 `unit-test.md` 的 P0 matrix；
- 在 progress 记录 policy API、metadata shape、catalog builder signature。

Step 7 依赖 catalog 的“可追加 runtime-only tool”能力；Step 8 依赖完整 reduced catalog；Step 9 依赖 subagent 顶层工具在 nested catalog 中必被移除。任一 API 变化必须更新这些 steps。

## 12. Review 门禁

停止等待用户 review。若用户决定开放 shell 或更多 app writes，必须先重新讨论硬边界并改 context，不能仅改一行 allowlist。
