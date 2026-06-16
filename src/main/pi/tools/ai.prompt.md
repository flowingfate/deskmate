<!-- Last verified: 2026-06-16 -->
# pi/tools — 本地工具子系统(pi-native)

> 主进程"本地工具"独立 registry。**不是 MCP server** —— 每个工具直接是
> `LocalTool` 对象,handler 接收显式 `ToolContext` 参数。

## 关键文件

| 文件 | 职责 | 规模 |
|------|------|------|
| `types.ts` | `LocalTool` / `ToolContext` / `ToolResult` / `LazyHandlerLoader` 契约 | 小 |
| `registry.ts` | `ToolsRegistry` 类 + 模块级单例 `tools`;`register / has / get / list / listSpecs / listNames / execute`;`ensureToolsRegistered()` 触发首次注册 | 小 |
| `index.ts` | 启动期把所有工具 register 进 `tools`;无侧效仅副作用;按"批"分组(轻量 / main 子系统 / heavy lazy)。**mcp / agent / skill / schedule / web / subagent 域已全部下线为 `app <domain> ...` AppCommand**,业务内核与 CLI 分别同住 `appcmd/builtins/<domain>/`。**已下线** `manage_process` / `move_file` / `coding_agent` / `get_current_datetime` 四个工具:前两者 LLM 直接走 `shell` 原生能力,`coding_agent` 整体移除,`get_current_datetime` 改成 system prompt 注入。**已下线** `read_file` / `read_office_file`,合并进新 `read` 工具(单一 `path` string 入口,通过 `:<sel>` selector 承载行号/页码/raw,通过 `scheme://` 前缀承载 internal URI 如 `skill://`)| 小 |
| `lazy.ts` | `lazy(spec, loader)` 工厂:spec 立刻可见(LLM 列表/IPC `getAll` 不阻塞),handler 首调时 `await loader()` 动态 import 真实实现。并发首调共享同一 inflight promise | 小 |
| `schema.ts` | `jsonSchema(literal)`:把 plain JSON Schema 字面量装成 pi-ai `TSchema`(pi-ai provider 全部按裸 JSON Schema 读 `tool.parameters`)。spec 模块加载期同步构造,无法 dynamic-import typebox | 小 |
| `impl/` | 重模块的实现仓库 —— 目前仅剩 `readOfficeFile.ts`(被 `read/backends/office.ts` 通过 `await import('../../impl/readOfficeFile')` 推迟到首调,与旧 `lazy(...)` wrapper 同语义、同性能、同 chunk-split 行为)| ~660 LOC |
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
- `ToolResult` = `{ ok: true; content: string } | { ok: false; error: string }`;
  失败直接 `throw`,registry `execute` 在外层捕获并落成 `{ ok: false }`。

### ToolContext —— 显式上下文

```ts
interface ToolContext {
  profileId: string;
  agentId: string;
  sessionId: string;
  signal: AbortSignal;
  eventSender: WebContents | null;
  tracer: Tracer;
  isSubAgent: boolean;
  callId: string;
  chunkStream: ChunkStream | null;
  catalog?: ToolCatalog;
  getParentContextSummary?: () => Promise<string>;
  getSubAgentConfig?: (name: string) => Promise<SubAgentConfig | undefined>;
}
```

- 所有依赖**显式**作为 handler 参数传入。
- 主链路 (`RegularSession.handleToolCalls`) 注入完整 ctx;JobRun(scheduler)注入
  `eventSender = null` / `chunkStream = null` —— 工具内部用 `if (!ctx.chunkStream) return`
  早返保护。
- `getParentContextSummary` / `getSubAgentConfig` **仅 spawn 类工具消费**;
  缺席时 spawn 工具显式抛错(不允许静默 no-op)。
- IPC handler(`startup/ipc/tools.ts`)的 dev/debug 入口给空字符串 + Tracer.noop +
  null chunkStream;chat-bound 工具(executeCommand / spawn 等)在此路径会因
  ctx 不全在 handler 内抛错(预期行为)。

### per-turn ToolCatalog(`pi/toolCatalog.ts`)

```ts
interface ToolCatalog {
  specs: PiTool[];                  // 喂 pi.streamSimple({ tools })
  routes: ReadonlyMap<string, ToolRoute>;
}
type ToolRoute = { kind: 'local' } | { kind: 'mcp'; serverName: string };
```

- `buildToolCatalogForAgent(cfg)` / `buildToolCatalogForSubAgent(cfg, mcpSelections)`:
  agent 顶层 `tools?: string[]` 与 `mcp_servers` 独立合并。
- 同名工具(local ∩ mcp,或两个 mcp server)在构 catalog 时立即抛 ——
  **不做静默优先级、不做 namespace**。
- `pi/tool.ts::executeToolCall(call, catalog, ctx)` 按 `route.kind` 分发:
  - `'local'` → `tools.execute(name, args, ctx)`(本地 registry)。
  - `'mcp'` → `executeMcpToolOnServer(serverName, name, args, ctx.signal)`
    (server-scoped 执行,不再按裸 toolName 查全局 `toolToServerMap`)。

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
批 A:纯本地轻量(`read` / `write` / `find` / `search` / `ask`)。`read` 是统一读入口 —— 取代了 `read_file` / `read_office_file`,内部按"scheme/extension"两级分发到 `read/backends/{filesystem,internal-url,office}.ts`(office backend 自带 lazy import,首调时才解析 mammoth/jszip/pdfreader)。`present_deliverables` 已下线 —— LLM 在最终消息文字里直接提到产出 URI,renderer 端通过 `extractFilePathsFromText` 抽取路径渲染卡片。
批 G:`app` shell facade(LocalTool 总入口;`appcmd/index.ts` 已先 side-effect import 完所有 AppCommand)
批 B:依赖 main 子系统 —— 仅 `executeCommand`(LLM 看到名为 `shell`)。`manageProcess` 已下线
批 C:已下线(mcp / agent / skill → `app` shell facade,详见 `appcmd/builtins/`)
批 D:已下线(schedule → `app` shell facade;feature flag 守卫挪到 `appcmd/index.ts`)
批 E:已下线(spawn / spawn-many → `app subagent` shell facade;feature flag 守卫挪到 `appcmd/index.ts`)
批 F:heavy / lazy(`downloadFile.ts`,LLM-visible 名为 `download`)。web 域已下线到 `app web ...`,业务内核在 `appcmd/builtins/web/kernel/`;`read_office_file` 一并下线 —— office 现在是 `read` 工具的内部 backend,通过 `read/backends/office.ts::loadImpl()` 推迟加载 `impl/readOfficeFile.ts`(独立 lazy chunk 输出,bundle 体积不变)

注册顺序对 LLM 看到的工具列表顺序没有语义,但保持稳定有助于 prompt cache 命中率;
新加工具往对应组里塞,**不要散落**。

## Common Changes

| 场景 | 修改 | 注意 |
|---|---|---|
| 新增纯本地工具(无 ctx 依赖) | 新建 `pi/tools/<name>.ts`(spec + handler);`index.ts` 加 register | spec 用 `jsonSchema({ ... })`;args interface 在文件内声明 + handler 入口 cast |
| 新增需要 ctx 的工具 | 同上;handler 直接读 `ctx.chunkStream / ctx.callId / ctx.eventSender / ctx.tracer / ctx.signal` | `ctx.chunkStream` null 走早返;**不要**回到任何静态字段 |
| 新增重依赖工具 | 用 `lazy(spec, () => import('./impl/<name>').then((m) => m.handler))`;impl 文件放 `pi/tools/impl/` | spec 必须模块加载期就有,**不能**进 loader 内 |
| 新增 spawn 类(派生子 agent)能力 | **不要**写 LocalTool;走 `appcmd/builtins/subagent/` AppCommand,新 subcommand 落 `subagent <verb>` namespace,kernel 放 `appcmd/builtins/subagent/kernel/` | `_shared.ensureSpawnPrerequisites(ctx)` 同时拦截 `ctx.isSubAgent` / 校验 spawn 字段;调 `SubAgentManager` 时必透 `ctx.signal` |
| 改 tool spec / description | 直接改 `pi/tools/<name>.ts`,无需碰别处 | LLM cache 会被打穿,刻意 stable |

## 注意事项

- **handler 不允许回读任何全局 / 静态字段获取"当前执行上下文"。** 一律走
  `ctx` 参数;新代码出现这种回读 = bug。
- **registry 重名 throw,不静默覆盖。** 模块加载期 register 时若名字冲突,
  立即抛 —— 与 catalog 构建时的"local∩mcp 同名冲突"一致,杜绝隐式覆盖。
- **spawn 命令缺失 ctx 必抛。** `getParentContextSummary` / `getSubAgentConfig`
  任一缺失,`appcmd/builtins/subagent/_shared.ensureSpawnPrerequisites` 必须显式拒绝
  —— 不允许静默 no-op 让 LLM 以为"成功调用了空 spawn"。`ctx.catalog` 不是 spawn
  的依赖(sub-agent 在 SubAgentChat 内自己 `buildToolCatalogForSubAgent`)。
  注意 spawn 入口已经从 LocalTool(`spawn_subagent` / `spawn_subagents`)迁到
  AppCommand(`app subagent spawn` / `spawn-many`)—— LocalTool 一侧不再有这类工具。
- **schema literal 的 typing 约束**:`jsonSchema({...})` 走 discriminated
  union by `type`。`type: 'object'` 节点必须写 `properties`(可空 `{}`),
  `required` 元素被 `keyof properties` 校验,拼错字段名直接编译报错。
  dict 形态(`additionalProperties: { type: 'string' }`)显式写
  `properties: {}` —— JSON Schema 标准里与缺省等价,但显式声明让 typing
  推断稳定。
- **`ask` 不渲染任意 UI。**(原 LLM-name `request_interactive_input`。)
  验证 JSON schema 并把规范化的 `choice` / `form` 转回主进程,由 `pi/tool.ts::executeToolCall`
  用 `humanLoopRequest` 推卡片。
- **`tool_result` 并非总是终态。** `shell` 在命令退出前会通过 `ctx.chunkStream`
  推 `isPartial: true` chunk;下游消费者不能把每个 tool-result 块都当成完成态。
- **取消信号一路传递。** 网络 I/O / spawn 子进程 / Playwright page 必须把
  `ctx.signal` 透传到底层 `fetch` / `spawn` / `page.*`。漏传会让取消挂起整个
  上游超时(30–60s),阻塞用户发送新消息。
- **IPC `tools` 通道是 dev/debug 入口**,chat 主链路**不走 IPC** —— `pi/tool.ts`
  直接在主进程内调 `tools.execute(name, args, ctx)`,IPC 只服务 UI 列表
  (`getAll` / `has`)与偶尔的 debug `execute`。

## 相关模块

- 被依赖:[Chat 引擎(pi)](../ai.prompt.md) —— `pi/tool.ts` / `pi/session.ts`
  per-turn 构建 catalog 后透传 ctx 到 `executeToolCall`。
- 被依赖:[Sub-Agent](../../lib/subAgent/) —— `subAgentChat.buildToolCatalog` +
  `subAgentSession.runTurn(catalog)` 给 sub-agent 也走 catalog + ctx。
- 依赖:[MCP Runtime](../../lib/mcpRuntime/ai.prompt.md) —— external MCP 工具的
  连接生命周期与执行入口 `executeToolOnServer(serverName, ...)`。本子系统
  **不**依赖 MCPClientManager 的任何"内置"分支。
- 依赖:[Terminal Manager](../../lib/terminalManager/) —— `shell` 工具用。
- 依赖:[Playwright Manager](../../lib/playwright/) —— `appcmd/builtins/web/kernel/`
  的 `BingWebSearchTool` / `BingImageSearchTool` 通过 `PlaywrightManager.getInstance()`
  拉 headless Chromium 跑搜索;`appcmd/builtins/web/kernel/fetchWebContent.ts` /
  `readHtml.ts` 走 node-only 路径,不碰浏览器。
- 依赖:[Scheduler](../../lib/scheduler/) —— `appcmd/builtins/schedule/kernel/` 的
  `createJobInternal` / `listJobsInternal` / `updateJobInternal` / `deleteJobInternal`
  / `runJobNowInternal` 业务内核调 `schedulerManager` 底层 helper。
- 依赖:[Skills](../../lib/skill/) —— `appcmd/builtins/skill/kernel/` 的
  `installSkill` / `uninstallSkill` / `bindSkill` / `unbindSkill` /
  `listSkills` / `getSkillStatus` / `searchLibrary` 业务内核调底层 helper
  (`installAndActivateSkill` / `deleteInstalledSkill` / `applySkillToAgents`
  / `removeSkillsFromAgents` / `searchClawHubSkills` / `searchGitHubSkills`)。
