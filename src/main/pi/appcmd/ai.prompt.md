<!-- Last verified: 2026-07-19 (AppCmdContext owning Profile routing) -->
# pi/appcmd — `app` shell 风格的应用内能力调度

> 主进程**伪 shell** 子系统:LLM 通过单个 `app` LocalTool 调用一行 cmdline
> 字符串,本子系统把它解析、路由到对应的 `AppCommand` 执行。
>
> 设计原理与决策详见 [`ai.prompt/tool-system.md`](../../../../ai.prompt/tool-system.md)
> —— 包括"为什么是 shell 范式 / 为什么单工具 + 字符串 cmdline / `read`/`write`
> 等高频原语为什么不并入 `app`"等总览性问题。本文档**只讲实现细节**。

## 关键文件

| 文件 | 职责 | 规模 |
|------|------|------|
| `types.ts` | `AppCommand` / `AppCmdContext` / `AppCmdInternalResult` 契约。`AppCommand.toolDescription?()` 由顶层 LocalTool 直接读取生成 `spec.description`；router(`makeRouterCommand` 产物)覆写它内嵌命令索引，成员命令通常不实现 | 小 |
| `registry.ts` | `AppCommandRegistry` 容器**类**(不再持有单例);重名 throw,`list()` 按 name 排序。每个 router 工具拥有自己的实例 —— `appCommands`(`builtins/app/index.ts`)/ `webCommands`(`builtins/web/index.ts`)| 小 |
| `parseCmdline.ts` | thin wrapper over `vendor/argsTokenizer` —— 收敛 throw 成 `{ ok, error }` envelope | 小 |
| `flags.ts` | `parseFlags(argv, specs)`:`--foo bar` / `--foo=bar` / `-y` / 重复 array flag / `--` 终止符。**不**做 schema 校验 | 小 |
| `dispatcher.ts` | `dispatchAppCommand` 构造 `AppCmdContext`(ToolContext 子集 + stdio buffer)+ `formatAppCmdContent` 合成 LLM 可见字符串 | 小 |
| `makeRouterCommand.ts` | 顶层 router 核心。动态 help/description 枚举成员；delegated execution scope 下仅隐藏并拒绝需要当前会话 human-loop 的 `web research`。`app` / `web` 显式持有其结果，`subagent` 有独立 commands registry | 小 |
| `executeCommandFacade.ts` | `executeCommandFacade(command, cmdline, ctx)`：共享 cmdline tokenize → dispatcher → format；顶层工具在各自文件中显式定义 schema、description 与 handler | 小 |
| `_commonFlags.ts` | 通用 flag 的唯一 spec/helper 来源。命令支持全部语义时 spread `COMMON_FLAGS`；只支持子集时从该数组筛选，禁止重写 `--help/-h` 等 spec | 小 |
| `builtins/app/index.ts` | `app` 域注册表 `appCommands` + **模块加载期 eager 注册**全部成员(hello / time / mcp / agent / skill / schedule)。Agent 委派不属于 app 域，`pi/tools/subagent.ts` 作为独立顶层工具注册 | 小 |
| `builtins/app/time.ts` | 无副作用的 `app time` 命令；返回本客户端的本地 ISO 时间、IANA timezone 和 UTC offset，支持 `--json` | 小 |
| `builtins/app/hello/` | 骨架示范命令(`say` / `list` / `fail`),覆盖每个契约角;新命令的**活模板** | 小 |
| `builtins/app/mcp/` | 第一个真实命令:MCP server 管理。9 个 subcommand(install / add / update / remove / connect / disconnect / reconnect / status / search)+ `_shared.ts` 内部 helper + `kernel/` 业务内核子目录(5 个 `*Internal()` 函数 + 类型,只被本目录消费,不外露)| 中 |
| `builtins/app/agent/` | 第二个真实命令:Agent 管理。8 个 subcommand(install / add / update / remove / list / status / set-primary / search)+ `_shared.ts` 内部 helper(`parseMcpServerFlag` / `parseMcpToolFlag` / `buildMcpServersArray`,处理 `--mcp-server git --mcp-tool git:status` 这种多 token 嵌套形态)+ `kernel/` 业务内核子目录(8 个 `*Internal()` 函数 + `findAgent` helper)| 中 |
| `builtins/app/skill/` | 第三个真实命令:Skill 管理。7 个 subcommand(install / uninstall / bind / unbind / list / status / search)+ `_shared.ts` 内部 helper(`validateName` / `normalizeSkillNames` / `resolveDefaultAgentTarget` / `normalizeArrayFlag`)+ `kernel/` 业务内核子目录(7 个 `*Internal()` 函数)。**install / bind 显式分离**:`install` 只下盘,`bind` 只绑 agent,与 `apt install` vs `systemctl enable` 范式一致;bind / unbind 未传 target flag 时默认 → 当前 chat agent(`ctx.agentId`)| 中 |
| `builtins/app/schedule/` | 第四个真实命令:Scheduler job 管理。5 个 subcommand(create / list / update / remove / run)+ `_shared.ts` 内部 helper(`validateJobId` / `parseEnabledFlag` / `parseScheduleTypeFlag` / `formatJobLine`)+ `kernel/` 业务内核子目录(5 个 `*Internal()` 函数 + `JobView` snake_case 投影)。**`remove` 是本批顺手补齐**(老 LocalTool 时代缺 `delete_schedule`,LLM 没法删);**`--enabled true\|false`** 走 string flag 而非 boolean(`parseFlags` boolean 是二态,无法表达"显式 false")。始终在 `builtins/app/index.ts` 注册 | 中 |
| `builtins/web/index.ts` + `builtins/web/` | Web 抓取 / 搜索 / 下载能力域。**与 `builtins/app/` 完全对等的「注册表 + router」结构**:`index.ts` 导出 `webCommands`(一个 `AppCommandRegistry`),eager 装 4 个成员 AppCommand —— `search` / `image` / `fetch`(read-only)+ `download`(各文件导出 `xCommand` = `{ name, synopsis, help, run: runXxx }`)+ `_shared.ts` 内部 helper(`toStringArray` / `parseNumberFlag`)+ `kernel/` 业务内核(`tavilySearch` / `bingImageSearch` / `fetchWebContent` / `download`)。**`search` 走 Tavily REST API**(`kernel/tavilySearch.ts`,纯 `fetch`,API key 取 `settings.json` `webSearch.tavilyApiKey` 或环境变量 `TAVILY_API_KEY`);原 Bing + Playwright 爬虫方案已废弃,Playwright 仅 `image` 仍用。`download` 是**唯一产出型命令**(写文件,经 `ctx.addDeliverable` 登记 → `ToolResult.deliverables` 回流 sub-agent 审计);其余 read-only。无 `--yes` / `--dry-run`;`--json` 是纪律。**positional `<query>`/`<url>` 与 repeatable `--query`/`--url` 并存**(`curl -d k=v` 范式)。**⚠️ 顶层一等工具**:`webCommands` 是与 `appCommands` 对等的独立注册表;`pi/tools/web.ts` = `makeCommandFacade(makeRouterCommand({ name:'web', registry: webCommands }))`,与 `app` 同源同形。**注**:`read-html` 已剥离并入 `read` 工具的 HTML backend(`tools/read/backends/html.ts`,query 轴 `?mode=...`);online HTML 用 `web fetch`。 | 中 |
| `vendor/` | 内嵌的 `args-tokenizer 0.3.0` + `[M1]` POSIX 单引号修正,见文件头注 | 小 |

## 架构

### AppCommand 契约

```ts
interface AppCommand {
  readonly name: string;       // 无空格,推荐用 `-`,与 git/npm/docker 对齐
  readonly synopsis: string;   // 一行 ≤80 字符,进 `app` 工具的 description 索引
  readonly help: string;       // man 风格多行,LLM 按需调 `--help` 才看
  run(argv: string[], ctx: AppCmdContext): Promise<void>;
}
```

- `run` **不返回**字符串 —— 通过 `ctx.print` / `ctx.printErr` / `ctx.setExitCode`
  写入 stdio buffer。dispatcher 在外层合成 `AppCmdInternalResult`。
- `run` 抛错由 dispatcher **收敛**成 `stderr + (exit 1)`,**不**重新抛 ——
  "命令崩溃" ≠ "工具调用失败"。后者由 LocalTool registry 在更外层处理。

### AppCmdContext = ToolContext 精确子集 + stdio helpers

`AppCmdContext.profile` 是命令执行的 runtime owner。Agent / Skill / Web 命令及其 kernel 必须显式接收 `ctx.profile` 或 `ctx.profile.store`，禁止回读 Registry 默认候选。正常 execution 没有 delegate context；delegated run 只让 router 隐藏/拒绝 `web research`。其余 app/web 命令保持原有行为；新命令不得通过 `ctx.mode/delegateId` 推导权限。

### 退出码语义

| 码 | 含义 |
|----|------|
| 0 | 成功(不显示) |
| 1 | 命令执行业务失败(包括 run 抛错被 dispatcher 收敛) |
| 2 | usage error(子命令拼错 / 缺位置参数 / flag 解析失败) |
| 业务自选 | 例如 `hello fail` 用 42 |
| 127 | 顶层未知命令(已转为顶层 help,**不**附此码) |

### 顶层"松散"设计

`app` LocalTool 的顶层 handler 把空 cmdline / `--help` / `-h` / 未知命令 /
cmdline 语法错都降级到**顶层 help + tip,不附 exit code**。设计意图:
顶层 = 教 LLM 怎么用,不是严格守门。命令内部(`hello bogus-sub`)仍严格 `(exit 2)`。

### Delegated router

`makeRouterCommand` 只在 delegate context 存在时从 `web` 顶层 help/description 隐藏 `research` 并在分发前拒绝它；`app` 全部子命令和其它 web 子命令保持普通行为。`runResearch` 自身也在创建交互 UI 前执行同一拒绝，防止绕过 router。

## 文件布局范式(详见 `ai.prompt/tool-system.md` §6)

- **1–3 subcommand 且 ≤ 200 LOC** → 单文件 `<name>.ts`,内部按 `HELP` const →
  `FLAGS` const → `runXxx` 函数 → `AppCommand` object 四段排。
- **4+ subcommand 或 ≥ 300 LOC** → **目录** `<name>/`,一 subcommand 一文件,
  顶层 `index.ts` 只管 `HELP_TOP` + switch 路由 + `AppCommand` object。
- 子文件不 default export `AppCommand`,只 export `runXxx` 函数 —— 避免"哪个
  文件才是入口"的歧义。
- 跨 subcommand 复用的小 helper 放 `_shared.ts`,带 `_` 前缀表"内部用,
  **不**对应一个 subcommand"。

## 常见变更

### 新增 AppCommand

1. 决定单文件还是目录形态(看上面的门槛)。**复制 `builtins/app/hello/` 整个目录
   当模板**,或参考 `builtins/app/mcp/` 真实命令的形态。
2. 子命令文件内保持 HELP / FLAGS / run 强内聚。支持全部通用语义时 spread `COMMON_FLAGS`；只支持子集时从 `COMMON_FLAGS` 筛选，不能另写同名 flag spec。
3. 用 `isHelp(parsed.flags)` / `isJson(...)` / `isDryRun(...)` / `isYes(...)` 判定，不直接读对应 flag。
4. 调今天的 internal helper(`*Internal()` 函数族,详见
   [`pi/tools/ai.prompt.md`](../tools/ai.prompt.md)),**必须**透传 `ctx.signal`
   到底层 I/O。
5. 顶层 `index.ts` switch 加 `case '<sub>'` → `await runXxx(rest, ctx); return;`
6. 在域注册表加一行 `appCommands.register(<cmd>)`(`builtins/app/index.ts`;`web` 域则在 `builtins/web/index.ts`)。
7. 在 `__tests__/app/<name>/` 写 fixture(参考 `__tests__/app/mcp/_fixture.ts`:
   `vi.hoisted` 形态的 mock + dispatcher 驱动 + `runXxx('install foo --json')`
   shorthand)。**注意 import 顺序**:`router.test.ts` 里 `appCommands` 必须从
   `builtins/app`(eager 加载全部 kernel)import 在 `./_fixture` **之后**,否则
   kernel 会在 `vi.mock` 注册前被缓存(参见 fixture 顶部注释)。

### 修改 `--help` 文本

每个字都是 prompt token。差的 `help` = 差的 LLM 体验。改完务必在 dev profile
跑一次 `app("<name> --help")` 观察 LLM 是否被引导到正确路径,再 commit。

### 修改通用 flag 语义

**只**改 `_commonFlags.ts`,所有命令同步。绝不允许 `mcp remove --force` /
`agent remove --confirm` 这种漂移 —— UX 一致性是设计红线。

## 注意事项

- **AppCommand registry 重名直接 throw**:与 `tools.register` 同纪律。
- **`app` 永远 always-visible**:任何机制隐藏它都是 bug —— LLM 失去触达
  全部应用能力的唯一入口。
- **破坏性命令默认拒绝 `--yes`**:`remove` / `uninstall` / `delete` 不带
  `--yes` 直接 `(exit 1)`,比"action=remove 即执行"安全得多。`--dry-run`
  不需要 `--yes`(那只是演练)。
- **`ctx.signal` 必须透传到底层 I/O**:漏传会让取消挂起整个上游超时
  (30–60s),阻塞用户发送新消息。
- **dispatcher run throw → stderr + exit 1,不重新抛**。
- **vendored 文件改动必须更新 `vendor/argsTokenizer.ts` 头注的 Modifications
  段** —— 让任何上游 diff 比对都直接看得出。
- **delegated 权限从 delegate context 读取。** 正常 execution 没有 scope；仅 `web research` 这类当前会话 human-loop 在 AppCommand 边界拒绝，MCP OAuth 保持全局授权流；AppCommand 不得通过 `ctx.mode` 判断新路径权限。
- **`vi.mock` factory 与 hoisted state**:测试 fixture 写 `vi.mock(...)` 时
  factory 引用的对象必须用 `const x = vi.hoisted(...)`(同名 const),且
  **不能** `export const x = vi.hoisted(...)` —— vitest transformer 会报
  "Cannot access 'x' before initialization"。导出走 `export { x }` 间接形态
  (参考 `__tests__/mcp/_fixture.ts`)。

## 相关文件

- 设计稿:[`ai.prompt/tool-system.md`](../../../../ai.prompt/tool-system.md)
- LocalTool 子系统(`app` 是其中一员):[`pi/tools/ai.prompt.md`](../tools/ai.prompt.md)
- 新 Agent 委派命令：[`../subagent/ai.prompt.md`](../subagent/ai.prompt.md)
- agent loop:[`ai.prompt/agent-loop.md`](../../../../ai.prompt/agent-loop.md)
- MCP runtime(被 `builtins/app/mcp/` 调用):[`lib/mcpRuntime/ai.prompt.md`](../../lib/mcpRuntime/ai.prompt.md)
