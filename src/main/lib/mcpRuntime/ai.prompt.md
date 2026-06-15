<!-- Last verified: 2026-06-15 -->
# MCP Runtime

> 仅管理 **外部 MCP server** 的连接生命周期、OAuth、工具元数据缓存与
> 执行入口。本地工具是独立子系统,见 [`src/main/pi/tools/`](../../pi/tools/ai.prompt.md);
> 本子系统**不参与本地工具暴露**,只透传外部 server 的能力。

## Key Files

| 文件 | 职责 | 大小 |
|------|------|------|
| `mcpClientManager.ts` | 单例。管理外部 MCP client 实例、连接生命周期、运行时状态、OAuth 桥接。**执行入口仅 `executeToolOnServer({ serverName, toolName, ... })`** —— server 必须由 `ToolCatalog` route 显式给出。 | ~1.4K LOC |
| `mcpClient.ts` | 轻量适配器,委托给 `client/Client.ts`。转发原始 `McpServerConfig`(含 `oauth.*` 提示)给 HTTP 传输,供 OAuth 层构建 `DeskmateOAuthProvider`。 | — |
| `client/Client.ts` | 自实现 MCP client(stdio / SSE / HTTP);拥有 initialize 握手、工具/资源枚举、JSON-RPC 收发与关闭。 | ~590 LOC |
| `auth/McpAuthService.ts` | MCP 在线认证门面。**双路由**:Microsoft authority 走 MSAL(broker / 静默 SSO);其它 issuer 走 SDK 通用 OAuth(`DeskmateOAuthProvider` + `performOAuthFlow`)。 | — |
| `auth/McpAuthMetadataService.ts` | 解析 `WWW-Authenticate` + 发现 OAuth resource/server metadata。识别 8 个常见 provider(GitHub / GitLab / Slack / Google / Atlassian / Notion / Discord / Microsoft)。 | — |
| `auth/DeskmateOAuthProvider.ts` | 实现 MCP SDK `OAuthClientProvider` 接口,对接 Deskmate 安全 token 缓存。用于非 Microsoft OAuth 流程。 | ~280 LOC |
| `auth/CallbackServer.ts` | OAuth 2.0 重定向本地 server。**按端口单例**(默认 33420)—— 不同 MCP server 可通过 `oauth.callbackPort` 绑定不同端口,内部 `Map<port, CallbackServer>` 每端口一实例。`state` 路由支持同端口并发流。 | ~280 LOC |
| `auth/performOAuthFlow.ts` | 驱动 SDK 两步 `auth()`:discover + DCR + 浏览器重定向 → code → tokens。需要用户提供 clientId 时抛 `MCP_DCR_REQUIRES_USER_CLIENT_ID`。 | — |
| `auth/serverKey.ts` | `name + sha256(transport+url+headers+oauth.clientId+callbackPort).slice(0,16)` —— 在 `DeskmateTokenCache.mcpOAuth` 中给 OAuth 凭据槽生成 key。 | — |
| `auth/dcrFallbackInstructions.ts` | DCR fallback 对话框 provider 帮助目录。优先级:插件作者覆盖(`cfg.oauth.setupUrl/setupInstructions`) → 内置目录 → 通用指引。 | — |
| `auth/errors.ts` | 共享 MCP 认证错误标记,区分可恢复 user-interaction 与通用连接失败。 | — |

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

**没有 builtin/伪 server**。MCPClientManager 维护的 `mcpClients: Map<serverName, IUnifiedMcpClient>`
只装外部 server;`connect / disconnect / reconnect / add / update / delete` 全部
按用户配置的 server name 走,**无"是否 builtin"分支**。

**Server-scoped 执行**:`executeToolOnServer({ serverName, toolName, toolArgs, signal })`
直接按 server name 查 client 然后 `client.executeTool(...)`;不再有"按裸 toolName
查全局 toolToServerMap"的歧义路径 —— 后者已删,task.md §1 描述的"同名工具
后连接者覆盖前者"bug 不再可能复现。

**在线认证(HTTP / SSE 传输)**:401/403 时 transport 解析 `WWW-Authenticate`,
通过 `McpAuthMetadataService` 发现 OAuth metadata,在重试前向
`McpAuthService.getTokenForServer` 取 Bearer token。Auth service 按 issuer 路由:

- **Microsoft authority**(`login.microsoftonline.com` 等):优先 MSAL 路径,使用
  `VSCODE_CLIENT_ID:` scope 提示;回退到内置 Microsoft public client。交互式
  登录走外部浏览器环回。短期内存 token 缓存 + 按 `(clientId, authority, scopes)`
  并发 dedup,避免重复 consent 弹窗。

- **其它 issuer**(GitHub / Atlassian / Slack / Google 等):走 `DeskmateOAuthProvider`,
  实现 SDK `OAuthClientProvider`,对接 `DeskmateTokenCache.mcpOAuth`。标准 PKCE
  Authorization-Code,支持 DCR(RFC 7591),token 加密持久化在 profile 级缓存。
  `CallbackServer` 在按 server 配置的端口监听(默认 33420)。token 刷新与
  5min refresh 窗口在 provider 内处理。**同 server 并发调用 dedup** —— 通过
  `genericTokenRequests` + `getMcpOAuthServerKey`,确保两个并发 transport 不会
  弹两个 consent 或开两个浏览器 tab。**主动 refresh**:`expires_in <= 300s` 且
  存在 refresh token 时,`getTokenForGenericOAuth` 内联驱动 `performOAuthFlow`
  (无 consent 提示,用户已授权)。

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
profile 级 `{profile}/credentials/browserAuthTokenCache(.enc)` —— 切 profile 就是
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
| 添加新的 MCP 传输类型 | `client/transport/` + `client/Client.ts` | 所有传输必须实现 `IUnifiedMcpClient` |
| 扩展在线 MCP 认证 | `auth/` + `client/transport/HttpTransport.ts` + renderer 认证对话框 | 当前阶段优先 Microsoft 支持的 OAuth challenge |
| 调整执行入口 | `mcpClientManager.executeToolOnServer` | **不要**回到按裸 toolName 查全局 map 的形态;route 必须由 `ToolCatalog` 显式给出 |
| 向 UI 暴露 server 状态 | `mcpClientManager.ts` IPC notify | runtime state 由 `MCPServerRuntimeState` 定义 |
| 从其它 MCP 客户端导入配置 | `mcpClientManager.ts` MCP 配置导入辅助 | 支持从 VS Code、Cursor、Claude Desktop 等 MCP 客户端的 `mcp.json` / `settings.json` 读取条目;配置转 ProfileCacheManager 持久化 |
| 添加新的本地(deskmate-native)工具 | **见 [`src/main/pi/tools/ai.prompt.md`](../../pi/tools/ai.prompt.md)**;本子系统不再涉及 | — |

## 注意事项

- **SDK 客户端已永久禁用。** 不要在不了解禁用原因的情况下重启基于
  `@modelcontextprotocol/sdk` 的 MCP client —— 该实现的 HTTP 传输内存泄漏,
  本目录的自实现 MCP client 是唯一可用通路。
- **executeToolOnServer 必须 server-scoped。** caller 通过 `ToolCatalog.routes`
  拿到 `{ kind: 'mcp', serverName }` 后调入。**不要**新加按裸 toolName 查
  global map 的 API —— 否则"多 server 同名工具静默覆盖"bug 会复现。
- **运行时状态仅在内存。** `MCPServerRuntimeState` 永不写盘;应用重启所有 server 一律
  `disconnected`,与上次会话无关。
- **OAuth 凭据写盘前加密**(`DeskmateTokenCache` 提供 .enc 形态),profile 级隔离。
- **`tool_result` 并非总是终态。** 本地工具 `shell` 在
  命令退出前可推 `isPartial: true` chunk(详见
  [`pi/tools/ai.prompt.md`](../../pi/tools/ai.prompt.md))。MCP runtime 本身不发
  partial,仅透传上游响应。
- **MCP 不复用其它 Microsoft 子系统的 client id。** 受保护 MCP server 走
  `VSCODE_CLIENT_ID:` scope 提示或回退到内置 Microsoft public client;**永不**
  复用 Graph / 其它 resource 的 admin-consent 过的 client id —— 跨 resource
  consent 不匹配会让 MCP 流程拿到错误受众的 token。
- **外部浏览器成功页是主路径。** MCP 登录始终走外部浏览器环回,不依赖原生
  broker UX。

## 相关模块

- 依赖:[Terminal Manager](../terminalManager/) —— stdio MCP server 作为受管终端进程生成。
- 被依赖:[`src/main/pi/`](../../pi/ai.prompt.md) —— `pi/mcp.ts::executeMcpToolOnServer`
  调本子系统;`pi/toolCatalog.ts` 用 `getAllTools()` 列举 external MCP server 工具。
- 被依赖:[`src/main/pi/tools/`](../../pi/tools/ai.prompt.md) —— 本地工具子系统
  独立,仅在文档层引用本模块。
- 被依赖:[Renderer MCP UI](../../../renderer/components/mcp/) —— 通过 `mcp:*` IPC
  显示 server 列表 / 工具元数据 / 连接状态;`/settings/mcp` 与
  `/settings/tools` 平级,后者读 `tools:getAll`。
