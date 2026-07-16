# Step 5 — 建立委派能力 Policy 与 Reduced ToolCatalog

> 状态：待执行
> 前置：Step 1 `SubAgentRunRequest`/`SubAgentRuntimeState`、Step 2 graph resolver、Step 3 顶层工具名称、Step 4 ownership context
> 下游：Steps 7、8、9、14
> 本步将 policy 接到可复用执行边界，但尚无新 SubAgentSession。

## 1. 为什么在 session 前做

能力削减是安全边界，不应由 session prompt 临时决定。先完成 catalog、参数和 router policy，Step 8 的新 session 才能从第一天只拿到合法能力，而不是先 unrestricted 再补 denylist。

## 2. 开始前 review

1. 枚举实际顶层 LocalTools；预计为 read/write/find/search/ask/shell/app/web，Step 9 后再加 subagent；
2. 枚举 app/web 当前所有 commands 和 subcommands；
3. 阅读 ToolCatalog route、executeToolCall、appcmd router/dispatcher、MCP execute path、人机交互入口；
4. 搜索未来新增 command 的注册模式，确认“未分类默认 deny”能落在集中位置；
5. 运行 impact 并读 tool-system、pi/tools、MCP 文档；
6. 不打开旧 SubAgent tests 作为行为标准，只可读旧 recursion guard 的问题背景。

## 3. Policy 模型

在 `src/main/pi/subagent/policy.ts` 定义新生产 policy，避免散落 `if (ctx.isSubAgent)`：

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

不要继续扩写旧 `buildToolCatalogForSubAgent(cfg, disallowTools)` 语义；新入口接普通 Agent runtime config。

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
- 旧 app subagent 整域 deny，即使 Step 9 前还注册；
- help 在 delegated mode 应只描述可用子命令或清楚标注 restricted，避免引导模型反复撞禁止路径。

实现方式优先给 command/subcommand 声明 capability metadata，并由 router/dispatcher 统一判定。不要在每个 kernel 内复制 `isSubAgent` 检查。

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

## 9. 现有普通路径必须保持

RegularSession/JobRun catalog 与 app/web 行为不应因新 metadata 改变。Policy 只在明确 `subagent` execution mode 下启用。

## 10. 不做

- 不实现 submit_result；
- 不写 subrun store/session/manager；
- 不注册顶层 subagent；
- 不改 UI；
- 不新增/运行新单测；
- 不做实际安全攻击或 E2E 测试。

## 11. 静态验证与交接

- typecheck/build/impact；
- 静态枚举确认所有当前 app/web commands 已分类；
- 搜索确认新 policy 不 import 旧 `lib/subAgent`；
- 更新 `unit-test.md` 的 P0 matrix；
- 在 progress 记录 policy API、metadata shape、catalog builder signature。

Step 7 依赖 catalog 的“可追加 runtime-only tool”能力；Step 8 依赖完整 reduced catalog；Step 9 依赖 subagent 顶层工具在 nested catalog 中必被移除。任一 API 变化必须更新这些 steps。

## 12. Review 门禁

停止等待用户 review。若用户决定开放 shell 或更多 app writes，必须先重新讨论硬边界并改 context，不能仅改一行 allowlist。
