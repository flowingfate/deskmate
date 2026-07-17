<!-- Last verified: 2026-07-17 (Step 13：顶层 subagent 是唯一委派入口) -->
# pi/tools — 本地工具子系统(pi-native)

> 主进程"本地工具"独立 registry。**不是 MCP server** —— 每个工具直接是
> `LocalTool` 对象,handler 接收显式 `ToolContext` 参数。

## 关键文件

| 文件 | 职责 | 规模 |
|------|------|------|
| `types.ts` | `LocalTool` / `ToolContext` / `ToolResult` / `LazyHandlerLoader` 契约 | 小 |
| `registry.ts` | `ToolsRegistry` 类 + 模块级单例 `tools` 的注册/查询；`executeLocalTool(tool,args,ctx)` 是 catalog local route 共用的取消/异常收敛边界；`ensureToolsRegistered()` 触发首次注册 | 小 |
| `index.ts` | 启动期把所有工具 register 进 `tools`;按“批”分组。`subagent` 与 app/web 同为顶层 facade；handler 按当前 `Profile` 取得其 cached command facade，首次创建时绑定 manager，同一 LocalTool 对象加入 delegated catalog 黑名单以禁止嵌套 | 小 |
| `lazy.ts` | `lazy(spec, loader)` 工厂:spec 立刻可见(LLM 列表/IPC `getAll` 不阻塞),handler 首调时 `await loader()` 动态 import 真实实现。并发首调共享同一 inflight promise | 小 |
| `schema.ts` | `jsonSchema(literal)`:把 plain JSON Schema 字面量装成 pi-ai `TSchema`(pi-ai provider 全部按裸 JSON Schema 读 `tool.parameters`)。spec 模块加载期同步构造,无法 dynamic-import typebox | 小 |
| `impl/` | 重模块的实现仓库 —— 目前仅剩 `readOfficeFile.ts`(被 `read/backends/office.ts` 通过 `await import('../../impl/readOfficeFile')` 推迟到首调,与旧 `lazy(...)` wrapper 同语义、同性能、同 chunk-split 行为)| ~660 LOC |
| `app.ts` | 显式定义 `app` LocalTool：schema/description/handler 与 `appCommands` router 并列可读；handler 复用 `executeCommandFacade(appCommand, ...)` | 极小 |
| `web.ts` | 显式定义 `web` LocalTool：schema/description/handler 与 `webCommands` router 并列可读；handler 复用 `executeCommandFacade(webCommand, ...)`。不进 `appCommands`,`app web ...` 已废弃 | 极小 |
| `subagent.ts` | 根据显式 ToolContext profile 取 active `Profile`，以 `WeakMap<Profile, AppCommand>` 缓存并复用 command facade；其绑定 `SubAgentManager.forProfile(profile)`，不持有全局 manager | 小 |
| `*.ts`(具体工具) | 每个工具一个文件:`spec` literal + `handler(args, ctx)`。所有工具都是 native inline 形态(无 wrapper / 无桥接) | 各 ~10–600 LOC |

## 架构

### LocalTool 契约

```ts
interface LocalTool<TParams extends TSchema = TSchema> {
  readonly spec: PiTool<TParams>;       // name / description / parameters
  handler(args: Static<TParams>, ctx: ToolContext): Promise<ToolResult>;
}
```

- `spec` 直接喂给 `pi.streamSimple({ tools })`,不再经 `toPiTools` 翻译。
- `args` 在 handler 入口由 caller 一次性 cast 成具体 args interface;
  pi-ai `validateToolCall` 已在外层校验,handler 只负责执行。
- `ToolResult` = `{ ok: true; content: string; images?: ToolResultImage[] } | { ok: false; error: string }`;
  失败直接 `throw`,registry `execute` 在外层捕获并落成 `{ ok: false }`。
  `images`(可选)让工具把图片回灌给模型:`read` 一个图片文件时填充,经
  `executeToolCall → session.ts → Domain ToolResult.images → messageBridge` 拼成 pi
  `ToolResultMessage` 的 ImageContent。base64 随 `tool_res` 行落盘(仅被读取时)。

### ToolContext —— 显式上下文

```ts
type ToolContext =
  | { mode: 'agent'; agentId: string; sessionId: string; /* common fields */ }
  | { mode: 'delegate'; agentId: string; sessionId: string; delegateId: string; /* common fields */ };
```

- 正常 execution 没有 delegate context，继续用 ToolContext 的 parent identity。
- 只有 delegated run 外层的 `DelegateExecutionContext` 影响 capability；Local 始终用 context parent identity，Knowledge/Skill 使用 `delegateId ?? ctx.agentId`。
- RegularSession/JobRun、executeToolCall 与 InternalUrlRouter 不建立或补充 scope；Step 8 是唯一 scope root。
- `getParentContextSummary` 是新 `subagent run --with-parent-summary` 的正式 seam；旧配置读取不进入 ToolContext。

### per-turn ToolCatalog(`pi/tool.ts` 的 catalog 段)

```ts
class ToolCatalog {
  readonly specs: PiTool[];
  getRoute(llmName): ToolRoute | undefined;
  resolveIdentity(llmName): { name; mcp };
  withSubmitResult(tool): ToolCatalog; // delegated-only, 未注册
  static empty(): ToolCatalog;
}
type ToolRoute =
  | { kind: 'local'; tool: LocalTool }
  | { kind: 'mcp'; serverName: string; toolName: string };
```

- catalog local route 直接持有已选中的 `LocalTool` snapshot；`executeToolCall` 通过 registry 共用的执行 helper 调用它，避免“catalog 列举一份、registry 再按名称查一份”的第二个事实源。
- delegate context 下 `buildToolCatalogForAgent` 在现有 Agent selection 基础上排除交互式 `ask` 与已注册的 `subagent` LocalTool 对象；其它 LocalTool 保持普通语义。
- `submit_result` 由 Step 7 的 `SubmitResultController` 创建，`ToolCatalog.withSubmitResult()` 仅克隆一个 delegated run 的 snapshot 并追加普通 local route；普通构建路径和全局 `ToolsRegistry` 均不会看到它。禁止把该特例泛化回 replacement/guard API。
- `web research` 与已知 shell device-auth 在各自执行边界拒绝；MCP OAuth 保持普通全局交互流。`executeToolCall` 只对 local/MCP route 分发；MCP Auth 不读取 delegate context。

### lazy / 重模块推迟加载

两种范式:

**(1) 旧 `lazy(spec, loader)` 工厂** —— spec 模块加载期就有,handler 首调时
`await loader()` 动态 import 真实实现。适合一个工具一个 impl 文件、且工具本
身就是 LLM-visible 入口的场景:

```ts
tools.register(lazy(
  { name: 'some_heavy_tool', description: '...', parameters: PARAMS },
  () => import('./impl/<name>').then((m) => m.handler),
));
```

**(2) backend 内部 `await import()`** —— 适合 multi-backend 工具的子分支
(如 `read` 的 office backend),不暴露独立 LocalTool。形态:

```ts
// pi/tools/read/backends/office.ts
let cachedImpl, inflight;
async function loadImpl() {
  if (cachedImpl) return cachedImpl;
  if (!inflight) {
    inflight = import('../../impl/readOfficeFile').then(m => (cachedImpl = m.ReadOfficeFileTool));
  }
  return inflight;
}
```

两者共同纪律:
- 启动期只 import spec 字面量,不触发重模块顶层 import
- 首调时 `await import(...)` + 并发去重(`inflight` promise 共享)
- 失败被 registry 收敛成 `{ ok: false }`,LLM 看到的形态与本地工具一致
- bundle 行为:`impl/<name>` 仍是独立 lazy chunk 输出

## 注册顺序与 feature flag

`index.ts::registerAllTools()`:

```
批 A:纯本地轻量(`read` / `write` / `find` / `search` / `ask`)。`read` 是统一读入口 —— 取代了 `read_file` / `read_office_file`,内部按"scheme/extension"两级分发到 `read/backends/{filesystem,internal-url,office,image,html}.ts`(office backend 自带 lazy import,首调时才解析 mammoth/jszip/pdfreader;html backend `read/backends/html.ts` + `htmlReader.ts` 接管 `.html`/`.htm`,走 `?mode=...` query 轴,结构化阅读不 dump 原始 HTML)。`present_deliverables` 已下线 —— LLM 在最终消息文字里直接提到产出 URI,renderer 端通过 `extractFilePathsFromText` 抽取路径渲染卡片。
批 G:router facade。生产注册 `app`、`web` 与 `subagent` 三个顶层 router facade；`subagent` 的 registry/commands 位于 `pi/subagent/commands`，handler 每次按显式 profile 解析 profile-bound manager。
批 B:依赖 main 子系统 —— 仅 `executeCommand`(LLM 看到名为 `shell`)。`manageProcess` 已下线
批 C:已下线(mcp / agent / skill → `app` shell facade,详见 `appcmd/builtins/app/`)
批 D:已下线(schedule → `app` shell facade；命令始终在 `appcmd/builtins/app/index.ts` 注册)
批 E:无 app 域委派命令；生产委派只走顶层 `subagent list|describe|run|continue`。
批 F:已下线为子命令(`download` 顶层工具 → `web download`,见批 G)。下载内核搬到 `appcmd/builtins/web/kernel/download.ts`,CLI 在 `appcmd/builtins/web/download.ts`;`web` 域**已升为顶层一等工具 `web`**(`pi/tools/web.ts`)。`read_office_file` 一并下线 —— office 现在是 `read` 工具的内部 backend,通过 `read/backends/office.ts::loadImpl()` 推迟加载 `impl/readOfficeFile.ts`(独立 lazy chunk 输出,bundle 体积不变)

注册顺序对 LLM 看到的工具列表顺序没有语义,但保持稳定有助于 prompt cache 命中率;
新加工具往对应组里塞,**不要散落**。

## Common Changes

| 场景 | 修改 | 注意 |
|---|---|---|
| 新增纯本地工具(无 ctx 依赖) | 新建 `pi/tools/<name>.ts`(spec + handler);`index.ts` 加 register | spec 用 `jsonSchema({ ... })`;args interface 在文件内声明 + handler 入口 cast |
| 新增需要 ctx 的工具 | 同上;handler 直接读 `ctx.chunkStream / ctx.callId / ctx.eventSender / ctx.tracer / ctx.signal` | `ctx.chunkStream` null 走早返;**不要**回到任何静态字段 |
| 新增重依赖工具 | 用 `lazy(spec, () => import('./impl/<name>').then((m) => m.handler))`;impl 文件放 `pi/tools/impl/` | spec 必须模块加载期就有,**不能**进 loader 内 |
| 新增 Agent 委派入口 | 新路径使用 `pi/subagent/commands/` + `tools/subagent.ts`；handler 按 `ToolContext.profileId` 取得 Profile，并复用其 command facade（首次才用 `SubAgentManager.forProfile(profile)` 创建） | 不扩写 app command；同一 `LocalTool` 对象必须加入 delegated catalog 黑名单 |
| 改 tool spec / description | 直接改 `pi/tools/<name>.ts`,无需碰别处 | LLM cache 会被打穿,刻意 stable |

## 注意事项

- **handler 的 delegated capability 来自 delegate context。** normal execution 没有 scope；Local 继续使用 ctx parent identity。
- **schema literal 的 typing 约束**:`jsonSchema({...})` 走 discriminated
  union by `type`。`type: 'object'` 节点必须写 `properties`(可空 `{}`),
  `required` 元素被 `keyof properties` 校验,拼错字段名直接编译报错。
  dict 形态(`additionalProperties: { type: 'string' }`)显式写
  `properties: {}` —— JSON Schema 标准里与缺省等价,但显式声明让 typing
  推断稳定。
- **`ask` 自成闭环。**(原 LLM-name `request_interactive_input`。)handler 校验
  JSON schema 后**自身**用 `humanLoopRequest` 把 `choice` / `form` 卡片推到
  renderer、阻塞等提交/跳过、返回结果 JSON(`dispatchInteractiveCard`)——
  与 `shell` 的 device-auth 同范式。`eventSender` 为空(JobRun / 测试)时退化为
  "用户跳过"。`pi/tool.ts` 不再按 name 特判回调。
- **`tool_result` 并非总是终态。** `shell` 在命令退出前会通过 `ctx.chunkStream`
  推 `isPartial: true` chunk;下游消费者不能把每个 tool-result 块都当成完成态。
- **取消信号一路传递。** 网络 I/O / spawn 子进程 / Playwright page 必须把
  `ctx.signal` 透传到底层 `fetch` / `spawn` / `page.*`。漏传会让取消挂起整个
  上游超时(30–60s),阻塞用户发送新消息。
- **`shell` 的裸 skill cwd 特例**：`skill://<name>` 在 `read` / command / args 仍指向 `SKILL.md`，仅在 `cwd` 位置映射为 skill 根目录；带子路径的 URI 保持精确解析，文件路径不得静默降级到父目录。
- `find` 的 `workspaceRoot` 不可为文件系统根目录。其 10 秒超时会 abort 同一个传给 workspace search 的 signal，后者必须终止 `rg`；不得以 `Promise.race` 单独返回而让扫描继续在后台运行。
- **IPC `tools` 通道是 dev/debug 入口**,chat 主链路**不走 IPC** —— `pi/tool.ts`
  从 catalog local route 直接取得 `LocalTool`，经 `executeLocalTool(tool, args, ctx)` 执行；IPC 只服务 UI 列表
  (`getAll` / `has`)与偶尔的 debug `execute`。

## 相关模块

- 被依赖:[Chat 引擎(pi)](../ai.prompt.md) —— `pi/tool.ts` / `pi/session/`
  per-turn 构建 catalog 后透传 ctx 到 `executeToolCall`。
- 被依赖:[新 Agent 委派运行时](../subagent/ai.prompt.md) —— `commands/` 复用 facade/router/flags，`tools/index.ts` 注入 manager 后注册顶层 `subagent`。
- 依赖:[MCP Runtime](../../lib/mcpRuntime/ai.prompt.md) —— external MCP 工具的
  连接生命周期与执行入口 `executeToolOnServer(serverName, ...)`。本子系统
  **不**依赖 MCPClientManager 的任何"内置"分支。
- 依赖:[Terminal Manager](../../lib/terminal/) —— `shell` 工具用。
- 依赖:[Playwright Manager](../../lib/playwright/) —— `appcmd/builtins/web/kernel/`
  的 `BingImageSearchTool`(`web image`)通过 `PlaywrightManager.getInstance()`
  拉 headless Chromium 跑图片搜索。`web search` 已改走 Tavily REST API
  (`kernel/tavilySearch.ts`,纯 `fetch`,不碰浏览器);`fetchWebContent.ts` /
  `readHtml.ts` 同样走 node-only 路径。
- 依赖:[Scheduler](../../lib/scheduler/) —— `appcmd/builtins/app/schedule/kernel/` 的
  `createJobInternal` / `listJobsInternal` / `updateJobInternal` / `deleteJobInternal`
  / `runJobNowInternal` 业务内核调 `schedulerManager` 底层 helper。
- 依赖:[Skills](../../lib/skill/) —— `appcmd/builtins/app/skill/kernel/` 的
  `installSkill` / `uninstallSkill` / `bindSkill` / `unbindSkill` /
  `listSkills` / `getSkillStatus` / `searchLibrary` 业务内核调底层 helper
  (`installAndActivateSkill` / `deleteInstalledSkill` / `applySkillToAgents`
  / `removeSkillsFromAgents`)。远程 marketplace 搜索(ClawHub/GitHub)已于
  2026-07-11 整体移除,`searchLibrary` 现在只查本地 `profile.skills`。
