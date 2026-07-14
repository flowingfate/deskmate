<!-- Last verified: 2026-07-14 (MCP 配置 schema 统一由 shared/persist/types 导出) -->
# MCP Runtime

> 仅管理 **外部 MCP server** 的连接生命周期、OAuth、工具元数据缓存与
> 执行入口。本地工具是独立子系统,见 [`src/main/pi/tools/`](../../pi/tools/ai.prompt.md);
> 本子系统**不参与本地工具暴露**,只透传外部 server 的能力。

## Key Files

| 文件 | 职责 | 大小 |
|------|------|------|
| `mcpClientManager.ts` | 单例。**编排层** —— 组合 `manager/*` 下的 store / lock / config / reaper,负责 client 实例的生命周期、`connect/disconnect/reconnect/add/update/delete` 与 `executeToolOnServer` 的对外入口。runtime 状态由 `RuntimeStateStore` 承担;不再直接持 `runtimeStates` map。 | ~530 LOC |
| `manager/types.ts` | 共享类型:`Tool` / `McpTool` / `MCPServerStatus` / `MCPServerRuntimeState`;以及 `transformTools()` 与 `normalizeInputSchema()` —— 把 SDK 侧 `unknown` inputSchema 收窄到 store 的 `Record<string, unknown>`。 | ~90 LOC |
| `manager/runtimeStateStore.ts` | 运行时状态 store + 50ms debounce IPC 广播(`mcpMainToRender.serverStatesUpdated`)。暴露 `setStatus / setTools / setError`(细粒度)与 `markConnecting / markConnected / markError / markDisconnected`(复合三元)。Error 到 string 的序列化在这里做。 | ~140 LOC |
| `manager/operationLock.ts` | Per-server 操作互斥。同 server 上的 connect/disconnect/reconnect 三种操作**不可并发**;第二个调用抛 `"is currently ${kind}ing"` —— 保持字符串以让后台自动连接的 catch 路径静默去重。`forceRelease` 让 disconnect 撬掉正在跑的 connect。 | ~65 LOC |
| `manager/configStore.ts` | 薄门面:`activeMcp()` 拿 `Profiles.get().active().mcp`;`patchServerConfig()` merge-update。**不承担运行时状态**。 | ~30 LOC |
| `mcpClient.ts` | Adapter,面向 manager 的稳定 seam。**内部实现走 `@modelcontextprotocol/sdk` 的 `Client`(1.29)** —— 协议大脑(initialize / request 关联 / pending map / timeout / AbortSignal / 通知分发)全部由 SDK `Protocol` 承担。构造时按 `server.transport` 选择 `DeskmateStdioSdkTransport` / `DeskmateHttpSdkTransport`,并把 `callTool` 结构化结果折叠回上层期望的字符串。 | ~230 LOC |
| `sdkTransport/DeskmateStdioSdkTransport.ts` | SDK `Transport` 适配器,包住自研 `wire/StdioTransport`。JSON-RPC 对象 ↔ `\n` 分帧字符串的边界翻译 + EventEmitter → SDK `onmessage/onclose/onerror` 回调的桥接。暴露 `getStderrPreview()` 让 `mcpClient` 在连接失败时补根因。 | — |
| `sdkTransport/DeskmateHttpSdkTransport.ts` | 同上,包 `wire/HttpTransport`。保留 Deskmate 的 OAuth 编排/SSE fallback/redirect 处理不动,只做 SDK 边界翻译。 | — |
| `sdkTransport/wire/StdioTransport.ts` | Deskmate stdio 运行时基建的薄协议层 —— `terminalManager.createTransport()` 的门面,承载 PATH 注入(node-shims / runtime-bin / pyenv)、shim 命令映射、首次 spawn 的 runtime lazy-install(JS→bun / Python→uv)、envFile 加载、Windows-ARM 内置 shim bypass。stderr 环形缓冲(50 行)。 | ~385 LOC |
| `sdkTransport/wire/HttpTransport.ts` | Streamable HTTP / legacy SSE 传输 + 桌面 OAuth 编排入口。401/403 → `WWW-Authenticate` 解析 → `McpAuthService.getTokenForServer` → 重试;forced-refresh retry;GET backchannel 与 SSE 独立 AbortController 防泄漏。 | ~770 LOC |
| `auth/index.ts` | MCP 在线认证门面(`McpAuthService`)。所有 issuer 走 SDK 通用 OAuth(`DeskmateOAuthProvider` + `performOAuthFlow`)。 | — |
| `auth/McpAuthMetadataService.ts` | 解析 `WWW-Authenticate` + 发现 OAuth resource/server metadata。识别 7 个常见 provider(GitHub / GitLab / Slack / Google / Atlassian / Notion / Discord)。 | — |
| `auth/DeskmateOAuthProvider.ts` | 实现 MCP SDK `OAuthClientProvider` 接口,对接 Deskmate 安全 token 缓存。用于 MCP OAuth 流程。 | ~280 LOC |
| `auth/CallbackServer.ts` | OAuth 2.0 重定向本地 server。**按端口单例**(默认 33420)—— 不同 MCP server 可通过 `oauth.callbackPort` 绑定不同端口,内部 `Map<port, CallbackServer>` 每端口一实例。`state` 路由支持同端口并发流。 | ~280 LOC |
| `auth/performOAuthFlow.ts` | 驱动 SDK 两步 `auth()`:discover + DCR + 浏览器重定向 → code → tokens。需要用户提供 clientId 时抛 `MCP_DCR_REQUIRES_USER_CLIENT_ID`。 | — |
| `auth/serverKey.ts` | `name + sha256(transport+url+headers+oauth.clientId+callbackPort).slice(0,16)` —— 在 `DeskmateTokenCache.mcpOAuth` 中给 OAuth 凭据槽生成 key。 | — |
| `auth/dcrFallbackInstructions.ts` | DCR fallback 对话框 provider 帮助目录。优先级:插件作者覆盖(`cfg.oauth.setupUrl/setupInstructions`) → 内置目录 → 通用指引。 | — |
| `auth/errors.ts` | 共享 MCP 认证错误标记(cancelled / oauth-flow-failed / dcr-requires-clientId),提供构造 + 判定 helper。 | — |
## 架构

```
pi/session.ts (RegularSession / JobRun)
        │
        ▼
pi/tool.ts::executeToolCall(call, catalog, ctx)
        │
        ├─── route.kind === 'local'  ─→  pi/tools/registry.ts::tools.execute(name, args, ctx)
        │
        └─── route.kind === 'mcp'    ─→  mcpClientManager.executeToolOnServer({ serverName, toolName, ... })
                                                  │
                                                  ▼
                                            McpClient(serverName)
                                                  │
                                        ┌─────────┼─────────┐
                                      stdio      SSE       HTTP
                                   (子进程)    (远程)    (可流式)
```

**没有 builtin/伪 server**。MCPClientManager 维护的 `clients: Map<serverName, McpClient>`
只装外部 server;`connect / disconnect / reconnect / add / update / delete` 全部
按用户配置的 server name 走,**无"是否 builtin"分支**。

**Server-scoped 执行**:`executeToolOnServer({ serverName, toolName, toolArgs, signal })`
直接按 server name 查 client 然后 `client.executeTool(...)`;不再有"按裸 toolName
查全局 toolToServerMap"的歧义路径 —— 后者已删,task.md §1 描述的"同名工具
后连接者覆盖前者"bug 不再可能复现。

LLM-facing MCP 名称由 `pi/toolCatalog.ts` 组合为 `serverName/toolName`，以便多个
server 同时暴露同名 tool；执行前通过本轮 `ToolCatalog.getRoute(llmName)` **精确查表**恢复
原始 server / tool 名，绝不按 `/` 字符串反解。

**在线认证(HTTP / SSE 传输)**:401/403 时 transport 解析 `WWW-Authenticate`,
通过 `McpAuthMetadataService` 发现 OAuth metadata,在重试前向
`McpAuthService.getTokenForServer` 取 Bearer token。所有 issuer 走统一的
`DeskmateOAuthProvider`(实现 SDK `OAuthClientProvider`,对接
`DeskmateTokenCache.mcpOAuth`):标准 PKCE Authorization-Code,支持 DCR
(RFC 7591),token 加密持久化在 profile 级缓存。`CallbackServer` 在按 server
配置的端口监听(默认 33420)。token 刷新与 5min refresh 窗口在 provider 内
处理。**同 server 并发调用 dedup** —— 通过 `inflightTokenRequests` +
`getMcpOAuthServerKey`,确保两个并发 transport 不会弹两个 consent 或开两个
浏览器 tab。**主动 refresh**:`expires_in <= 300s` 且存在 refresh token 时,
`runOAuthFlow` 内联驱动 `runRefreshOnly`(无 consent 提示,用户
已授权;失败才 fall-through 到交互流)。

Renderer 侧 prompt(`requestConsent` / `requestClientIdFromUser`)受
`MCP_AUTH_PROMPT_TIMEOUT_MS`(5min,与 `CallbackServer.waitForCode` 匹配)限制,
且遵循调用方 `AbortSignal`。超时 / 中止解析为 `cancel`/`{ cancelled: true }`
并走标准 `MCP_AUTH_CANCELLED` 路径传播。

当 authorization server 不支持 DCR 且用户未在 `.mcp.json` 配 `oauth.clientId`
时,`performOAuthFlow` 抛 `MCP_DCR_REQUIRES_USER_CLIENT_ID`。Auth service 捕获
后给 renderer 发 `mcpAuth:requestClientId`,弹 `RequestOAuthClientIdDialog`,
带 provider 帮助文案。用户提供的 `clientId`(+可选 secret)通过 provider 的
`saveClientInformation` 持久化,流程重试一次。

**OAuth 凭据存储**:`DeskmateTokenCache.mcpOAuth` 通过 `getMcpOAuthServerKey(name, cfg)`
生成槽 key —— `name + transport + url + headers + oauth.clientId + callbackPort`
的稳定 hash。重命名 server、改 URL、调整 auth-related headers 都会自动失效旧槽。
Token 条目存 `accessToken / refreshToken / expiresAt / scope` + 可选
`clientId / clientSecret`(让 DCR 颁发的 client 跨会话保持)。缓存文件位于
profile 级 `{profile}/credentials/mcp.auth.json`(明文,与 `auth.json`
主身份凭据落盘形态一致)—— 切 profile 就是
干净缓存。删 MCP server / 卸载插件触发 `MCPClientManager.delete()`,内部调
`McpAuthService.clearOAuthForServer(name, cfg, 'all')` 清整槽(token + DCR client
info),保证后续重新添加同名 server 走干净 OAuth。

**运行时状态**(`MCPServerRuntimeState`: status / tools / lastError)由
MCPClientManager 内存管理,每次变更通过 IPC 推 renderer。永不持久化。在
MCP consent 分发期间 server 临时进 `needs-user-interaction` 状态。用户关闭
consent 弹窗的取消映射为 `error`,防止 server 卡在 pending login。

## Common Changes

| 场景 | 修改文件 | 注意 |
|------|----------|------|
| 添加新的 MCP 传输类型 | `sdkTransport/wire/` + 新 `Deskmate*SdkTransport` adapter | 所有 wire 实现 `McpTransport` 事件形态;adapter 实现 SDK `Transport`。**协议层不改** —— SDK `Client` 自动接管 initialize / request / timeout。 |
| 扩展在线 MCP 认证 | `auth/` + `sdkTransport/wire/HttpTransport.ts` + renderer 认证对话框 | 标准 OAuth 2.0 / PKCE + DCR challenge |
| 调整执行入口 | `mcpClientManager.executeToolOnServer` | **不要**回到按裸 toolName 查全局 map 的形态;route 必须由 `ToolCatalog` 显式给出 |
| 向 UI 暴露 server 状态 | `mcpClientManager.ts` IPC notify | runtime state 由 `MCPServerRuntimeState` 定义 |
| 从其它 MCP 客户端导入配置 | `mcpClientManager.ts` MCP 配置导入辅助 | 支持从 VS Code、Cursor、Claude Desktop 等 MCP 客户端的 `mcp.json` / `settings.json` 读取条目;配置转 ProfileCacheManager 持久化 |
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
- **executeToolOnServer 必须 server-scoped。** caller 通过 `ToolCatalog.getRoute(llmName)`
  按 LLM 限定名精确取得 `{ kind: 'mcp', serverName, toolName }` 后调入。**不要**
  新加按裸 toolName 查 global map 的 API —— 否则"多 server 同名工具静默覆盖"bug 会复现。
- **运行时状态仅在内存。** `MCPServerRuntimeState` 永不写盘;应用重启所有 server 一律
  `disconnected`,与上次会话无关。
- **OAuth 凭据明文写盘**(`DeskmateTokenCache` 产出 `.json`,与 `auth.json` 一致),profile 级隔离。
- **`tool_result` 并非总是终态。** 本地工具 `shell` 在
  命令退出前可推 `isPartial: true` chunk(详见
  [`pi/tools/ai.prompt.md`](../../pi/tools/ai.prompt.md))。MCP runtime 本身不发
  partial,仅透传上游响应。
- **外部浏览器成功页是主路径。** MCP 登录始终走外部浏览器环回,不依赖原生
  broker UX。

## 相关模块

- 依赖:[Terminal Manager](../terminal/) —— stdio MCP server 作为受管终端进程生成。
- 被依赖:[`src/main/pi/`](../../pi/ai.prompt.md) —— `pi/mcp.ts::executeMcpToolOnServer`
  调本子系统;`pi/toolCatalog.ts` 用 `getAllTools()` 列举 external MCP server 工具。
- 被依赖:[`src/main/pi/tools/`](../../pi/tools/ai.prompt.md) —— 本地工具子系统
  独立,仅在文档层引用本模块。
- 被依赖:[Renderer MCP UI](../../../renderer/components/mcp/) —— 通过 `mcp:*` IPC
  显示 server 列表 / 工具元数据 / 连接状态;`/settings/mcp` 与
  `/settings/tools` 平级,后者读 `tools:getAll`。
