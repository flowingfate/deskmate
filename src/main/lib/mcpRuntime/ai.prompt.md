<!-- Last verified: 2026-07-18 (Profile-bound OAuth prompt, cancellation, and credential lifecycle) -->
# MCP Runtime

> 仅管理 **外部 MCP server** 的连接生命周期、OAuth、工具元数据缓存与
> 执行入口。本地工具是独立子系统,见 [`src/main/pi/tools/`](../../pi/tools/ai.prompt.md);
> 本子系统**不参与本地工具暴露**,只透传外部 server 的能力。

## Key Files

| 文件 | 职责 | 大小 |
|------|------|------|
| `index.ts` | `MCPClientManager` 实例，**由 runtime `Profile` 创建和持有**；绑定一个 `ProfileStore` 与一个 `McpAuthService`，独立维护 clients / locks / runtime states / OAuth flow。`cleanup()` 会先关闭 lifecycle gate，再中止已有连接；负责 connect/disconnect/reconnect/add/update/delete 与 executeToolOnServer | ~590 LOC |
| `manager/types.ts` | 共享类型:`Tool` / `McpTool` / `MCPServerStatus` / `MCPServerRuntimeState`;以及 `transformTools()` 与 `normalizeInputSchema()` | ~90 LOC |
| `manager/runtimeStateStore.ts` | 单 Profile 运行时状态 store + 50ms debounce IPC 广播；按 owner window 发送状态数组 | ~140 LOC |
| `manager/operationLock.ts` | 每 manager 的 per-server 操作互斥；同名 server 只在所属 Profile 内互斥。`disconnect` 先中止并等待连接收尾，再取得 disconnect 锁 | ~55 LOC |
| `mcpClient.ts` | Adapter；构造时接收 server config 与 Profile-bound auth service，并把后者注入 HTTP OAuth transport | ~230 LOC |
| `../delegateExecutionScope.ts` | delegated run 的 delegateId context；MCP Auth 不读取它，每个 runtime Profile 的 manager 持有自己的 OAuth flow | 极小 |
| `sdkTransport/DeskmateStdioSdkTransport.ts` | SDK `Transport` 适配器,包住自研 `wire/StdioTransport`。JSON-RPC 对象 ↔ `\n` 分帧字符串的边界翻译 + EventEmitter → SDK `onmessage/onclose/onerror` 回调的桥接。暴露 `getStderrPreview()` 让 `mcpClient` 在连接失败时补根因。 | — |
| `sdkTransport/DeskmateHttpSdkTransport.ts` | 同上,包 `wire/HttpTransport`。保留 Deskmate 的 OAuth 编排/SSE fallback/redirect 处理不动,只做 SDK 边界翻译。 | — |
| `sdkTransport/wire/StdioTransport.ts` | Deskmate stdio 运行时基建的薄协议层 —— `terminalManager.createTransport()` 的门面,承载 PATH 注入(node-shims / runtime-bin / pyenv)、shim 命令映射、首次 spawn 的 runtime lazy-install(JS→bun / Python→uv)、envFile 加载、Windows-ARM 内置 shim bypass。stderr 环形缓冲(50 行)。 | ~385 LOC |
| `sdkTransport/wire/HttpTransport.ts` | Streamable HTTP / legacy SSE 传输 + 桌面 OAuth 编排入口；构造时注入所属 Profile 的 auth service | ~770 LOC |
| `auth/index.ts` | `McpAuthService(profileId)`：由所属 `MCPClientManager` 构造；独立维护 OAuth dedup、共享的 profile-bound token cache、prompt registry 与 interaction listener。callback port 仍是应用级路由基础设施。 |
| `auth/DeskmateOAuthProvider.ts` | SDK OAuth provider；使用所属 `McpAuthService` 注入的 profile-bound `DeskmateTokenCache` | ~280 LOC |
| `auth/CallbackServer.ts` | OAuth 2.0 重定向本地 server。**按端口单例**(默认 33420)—— 不同 MCP server 可通过 `oauth.callbackPort` 绑定不同端口,内部 `Map<port, CallbackServer>` 每端口一实例。`state` 路由支持同端口并发流。 | ~280 LOC |
| `auth/performOAuthFlow.ts` | 驱动 SDK 两步 `auth()`:discover + DCR + 浏览器重定向 → code → tokens。需要用户提供 clientId 时抛 `MCP_DCR_REQUIRES_USER_CLIENT_ID`。 | — |
| `auth/serverKey.ts` | `name + sha256(transport+url+headers+oauth.clientId+callbackPort).slice(0,16)` —— 在 `DeskmateTokenCache.mcpOAuth` 中给 OAuth 凭据槽生成 key。 | — |
| `auth/dcrFallbackInstructions.ts` | DCR fallback 对话框 provider 帮助目录。优先级:插件作者覆盖(`cfg.oauth.setupUrl/setupInstructions`) → 内置目录 → 通用指引。 | — |
| `auth/errors.ts` | 共享 MCP 认证错误标记(cancelled / oauth-flow-failed / dcr-requires-clientId),提供构造 + 判定 helper。 | — |
## 架构

```text
Pi ToolContext.profile
  → Profile.mcpManager
  → McpClient(server config, auth service)
  → stdio / SSE / HTTP transport
```

**Profile ownership**：每个 runtime `Profile` 有自己的 MCPClientManager；同名 server 在不同 profile 的 client、lock、runtime state 和 OAuth flow 完全独立。`executeToolOnServer` 仍以 serverName + toolName 精确路由，但只能在已绑定的 manager 内查找。

**在线认证(HTTP / SSE)**：每个 `MCPClientManager` 创建一个绑定自身 Profile ID 的 `McpAuthService`，并将其注入该 Profile 的 HTTP transports。dedup key 在该 service 内仅需 `serverKey`；跨 Profile 的 flow 自然隔离。每个 service 复用一个 token cache，因而同 Profile 多个 server 并发写入不会丢槽位。prompt registry 也是 service 实例；renderer response 先按 sender 找到 owner manager，再消费该 manager 的 request。callback server port 可以共享，但 consent/client-id prompt 只发送至该 runtime Profile 的 owner main window；owner window 销毁时立即取消本 Profile 的 pending prompt，绝不 fallback 到其它窗口。

Renderer 把同 Profile 的 consent 与 client-id prompt 分别按到达顺序串行展示，不能让后来的 server 覆盖当前 request。HTTP transport 将自己的 abort signal 传到 OAuth flow；`disconnect` 先中止并等待 in-flight connect，随后 reset/delete 才清凭据或配置；Profile stop 先关闭 manager 的 lifecycle gate，再取消已启动连接、prompt 与 callback，禁止关闭期间重建 client。

Renderer 侧 prompt(`requestConsent` / `requestClientIdFromUser`)受
`MCP_AUTH_PROMPT_TIMEOUT_MS`(5min,与 `CallbackServer.waitForCode` 匹配)限制,
且遵循调用方 `AbortSignal`。超时 / 中止解析为 `cancel`/`{ cancelled: true }`
并走标准 `MCP_AUTH_CANCELLED` 路径传播。

当 authorization server 不支持 DCR 且用户未在 `.mcp.json` 配 `oauth.clientId`
时,`performOAuthFlow` 抛 `MCP_DCR_REQUIRES_USER_CLIENT_ID`。Auth service 捕获
后给 renderer 发 `mcpAuth:requestClientId`,弹 `RequestOAuthClientIdDialog`,
带 provider 帮助文案。用户提供的 `clientId`(+可选 secret)通过 provider 的
`saveClientInformation` 持久化,流程重试一次。

**OAuth 凭据存储**：`DeskmateTokenCache` 是 `McpAuthService` 的 profile-bound 共享实例，文件固定写至 `{profile}/credentials/mcp.auth.json`。server key 只表达 server config identity；Profile identity 由独立 service、token cache 与 prompt registry instance 共同提供，避免同名、同配置 server 跨 profile 复用 token 或 DCR client。server 的 auth-relevant config 变更或删除时，manager 会清除该 Profile 内该 serverName 的所有历史 slot，避免旧 refresh token / DCR client 变为不可达孤儿记录。

**运行时状态**：每个 manager 的 RuntimeStateStore 仅保存所属 profile 的 states。main 已按 owning window 精确发送状态数组，renderer cache 不做第二次 Profile filter。

## Common Changes

| 场景 | 修改文件 | 注意 |
|------|----------|------|
| 添加新的 MCP 传输类型 | `sdkTransport/wire/` + 新 `Deskmate*SdkTransport` adapter | 所有 wire 实现 `McpTransport` 事件形态;adapter 实现 SDK `Transport`。**协议层不改** —— SDK `Client` 自动接管 initialize / request / timeout。 |
| 扩展在线 MCP 认证 | `auth/` + `sdkTransport/wire/HttpTransport.ts` + renderer 认证对话框 | 标准 OAuth 2.0 / PKCE + DCR challenge |
| 调整执行入口 | `Profile.mcpManager.executeToolOnServer` + `pi/tool.ts` | 必须直接使用 `ToolContext.profile` 的 manager；仍按 server-scoped route 执行 |
| 向 UI 暴露 server 状态 | `runtimeStateStore.ts` + `shared/ipc/mcp.ts` + renderer MCP cache | pull request 由 sender 路由；push event 按 owner window 发送，payload 不重复 profileId |
| 从其它 MCP 客户端导入配置 | owning `Profile.mcpManager` | 导入配置和连接只作用于明确的 Profile runtime |
| 添加新的本地(deskmate-native)工具 | **见 [`src/main/pi/tools/ai.prompt.md`](../../pi/tools/ai.prompt.md)**;本子系统不再涉及 | — |

## 注意事项

- **协议大脑走 SDK,transport 自研适配 —— 有意折中,不是懒。** 本目录不再维护
  自研 JSON-RPC / Protocol / Client(2026-07 已删,约 -2180 LOC)。`mcpClient.ts`
  用 `@modelcontextprotocol/sdk` 1.29 的 `Client`,handshake / request 关联 /
  timeout / cancel / notification 分发全部由 SDK `Protocol` 承担。**但两个
  Deskmate SDK-facing transport(`sdkTransport/DeskmateStdioSdkTransport`,
  `sdkTransport/DeskmateHttpSdkTransport`)仍然自研**,因为 SDK 内置 transport
  塞不下我们的桌面基建:
    1. **stdio 深度耦合 terminal 基建。** `sdkTransport/wire/StdioTransport.ts`
       是 `terminalManager.createTransport()` 的薄协议层,承载 runtime PATH
       注入(node-shims / runtime-bin / pyenv)、shim 命令映射、首次 spawn 的
       runtime lazy-install(JS→bun / Python→uv)、envFile 加载与进程池生命
       周期。SDK 的 `StdioClientTransport` 是裸 `child_process.spawn`,会丢
       掉这整套 —— 用户配的 `npx`/`uvx` server 将找不到可执行文件。
    2. **HTTP OAuth 需要主动 consent 门控,SDK provider 是被动模型。**
       `sdkTransport/wire/HttpTransport.ts` 的 401/403 手动重试循环,是为把
       `McpAuthService` 的桌面专属编排插进请求:打开浏览器前的 renderer
       consent 弹窗(`needs-user-interaction` 状态)、已知不支持 DCR 的
       provider 的 clientId 提示对话框、proactive refresh 窗口(`runRefreshOnly`
       用 Proxy 阻止 SDK 静默 redirect)、并发 dedup(防两个 transport 弹两个
       consent)。SDK 的 `authProvider` 只有"存取凭据 + redirect"的被动接口,
       塞不进"先 consent 再 redirect"的门控。
  重启 SDK client 前必须先解决这两点,否则会退化 stdio 运行时基建或桌面
  OAuth UX。SDK request timeout 也有坑:`Protocol.request` 里 `options?.timeout
  ?? 60000ms`,**`timeout: 0` 不是"无超时"** —— 会秒超时。initialize /
  listTools / callTool 全部显式传 `3_600_000ms` 覆盖(见 `mcpClient.ts`
  `REQUEST_TIMEOUT_MS`)。真正的取消由调用方 `AbortSignal` 走。
- **executeToolOnServer 必须同时 profile-scoped 和 server-scoped。** caller 直接使用 ToolContext.profile 的 manager，再由 catalog route 提供 `{ serverName, toolName }`；不要新增全局 manager 或裸 toolName 查找。
- **OAuth callback port 是应用级，OAuth state 不是。** 每个 Profile 的 `McpAuthService`、token cache、dedup key、prompt registry 与 interaction listener 独立；renderer response 先按 sender window 路由到该 Profile 的 manager，不能消费其它 Profile 的一次性请求。
- **运行时状态仅在内存。** 但每个 Profile 独立持有一份；main 只向 owner window 发送对应状态，renderer 不再依赖 payload filter。
- **OAuth 凭据明文写盘**，但只落入 owning profile 的 credentials 目录。
- **`tool_result` 并非总是终态。** 本地工具 `shell` 在
  命令退出前可推 `isPartial: true` chunk(详见
  [`pi/tools/ai.prompt.md`](../../pi/tools/ai.prompt.md))。MCP runtime 本身不发
  partial,仅透传上游响应。
- **外部浏览器成功页是主路径。** MCP 登录始终走外部浏览器环回,不依赖原生
  broker UX。

## 相关模块

- 依赖:[Terminal Manager](../terminal/) —— stdio MCP server 作为受管终端进程生成。
- 被依赖:[`src/main/pi/`](../../pi/ai.prompt.md) —— `pi/tool.ts` 直接调用 Profile-bound manager 的 `getAllTools()` 列举 external MCP server 工具，并通过 `ToolContext.profile.mcpManager.executeToolOnServer()` 执行。
- 被依赖:[`src/main/pi/tools/`](../../pi/tools/ai.prompt.md) —— 本地工具子系统
  独立,仅在文档层引用本模块。
- 被依赖:[Renderer MCP UI](../../../renderer/components/mcp/) —— 通过 `mcp:*` IPC
  显示 server 列表 / 工具元数据 / 连接状态;`/settings/mcp` 与
  `/settings/tools` 平级,后者读 `tools:getAll`。
