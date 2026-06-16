# Tool System —— 用 shell 范式重塑应用内工具调用

<!-- Last verified: 2026-06-14 -->
## 1. 范围

本文档覆盖 DESKMATE **本地工具系统**的总体设计 —— 包括今天已有的 `LocalTool` registry,以及新引入的 **`app` 伪 shell** 机制。

代码位置:
- `src/main/pi/tools/` —— `LocalTool` registry / 全部本地工具实现 / 启动注册 / lazy 重依赖
- `src/main/pi/appcmd/` —— `app` 工具的执行基础设施(parseCmdline / flags / dispatcher / registry / vendored argsTokenizer)
- `src/main/pi/appcmd/builtins/` —— 应用内能力的 AppCommand 实现

模块级深度文档(LocalTool 契约细节、工具实现规范):[src/main/pi/tools/ai.prompt.md](../src/main/pi/tools/ai.prompt.md)。

---

## 2. 起源:为什么 PI agent 那么丝滑

PI agent 一共只提供了 **4 个工具** —— `edit` / `write` / `read` / `bash` —— 但即便不装 skill 也无比丝滑。反观 Deskmate **38 个内置工具** + 套上 MCP **可能上百个**,这是一场认知灾难。

PI 之所以好用,根本原因有两条:

| 原因 | 本质 |
|---|---|
| **工具正交** | 一个 `read` 能 cover 文件 / URL / 资源所有 read 场景,LLM 不需要在 `read_xxx` 之间做选择题。 |
| **足够信任 bash** | Shell 是 LLM 的**母语**之一 —— 训练数据里见过亿级例子,而 shell CLI 工具天然**自解释 + 渐进披露**:`<cmd> -h` 看用法,`<cmd> <sub> -h` 看子命令,出错有 stderr + exit code,`--json` 输出结构化,`--dry-run` 预演。这套范式 LLM 不需要学,它一上来就会。 |

`app` 工具的核心 idea 就是把这套 shell 范式**内化到应用能力**:LLM 通过一行 cmdline 字符串调用我们的内部代码,把"工具激增"问题变成"shell 命令丰富"——LLM 天然能处理的方向。

---

## 3. LLM 视角:5 个工具,永远是 5 个

| 工具 | 角色 | 始终暴露 |
|---|---|---|
| `read` | 读取数据(文件 / URL / 资源,按 path scheme 分发)| ✅ |
| `write` | 写入数据 | ✅ |
| `edit` | 结构化修改数据 | ✅ |
| `shell` | 执行**真** shell 命令,跑 `git` / `npm` / `python` / 任意外部 CLI | ✅ |
| `app` | shell 风格调用**应用内**能力 —— 自解释、渐进披露 | ✅ |

> **现状**:Phase 8a 完成后顶层 LLM-visible 工具数收敛到 **8**(`read` / `write` / `find` / `search` / `shell` / `ask` / `download` / `app`)。`edit` 尚未独立;`write` 与 `download` 合并是后续 phase 目标(详见 §9)。`present_deliverables` 已下线 —— LLM 在收尾消息文字里直接提到产出 URI,renderer 端通过 `extractFilePathsFromText` 抽取并渲染卡片。

确立 "read-only 域" 的设计纪律(后续若有同形态命令直接照搬)

典型调用:
```
app("--help")                              ← 列出所有应用能力
app("mcp --help")                          ← 看 mcp 命令的子命令 + flag
app("mcp add brave --env K=xxx --yes")     ← 真执行
app("agent list")                          ← LLM 已经知道形态了

---

## 4. 设计约束

| 约束 | 说明 |
|---|---|
| **参数全字符串,不结构化** | `app(cmd: string)` 而非 `app({argv: string[]})`。LLM 训练数据里 shell 就是单行 string,转义/引号/空格在 string 形态下处理得更准;调试日志可读性满分;出错回 stderr 风格 LLM 完美 react。代价是宿主一次 tokenize。 |
| **synopsis + help 双轨自描述** | 每个 AppCommand 强制声明 `name` / `synopsis`(一行,**始终**进 system prompt)/ `help`(多行,LLM 调 `--help` 才返回)。synopsis 是能力**索引**,help 是渐进披露的**详情**。 |
| **顶层入口"松散"** | 顶层一切迷路状态 —— 空 cmdline / `--help` / `-h` / 未知命令 / cmdline 语法错 —— 一律降级到顶层 help + 温和 tip,**不**附 exit code。**已知命令内部**(如 `hello bogus-sub`)仍严格 `(exit 2)` —— 顶层"教 LLM 怎么用",命令内部"具体反馈"。 |
| **通用 flag 语义统一** | `--help`/`-h` / `--json` / `--dry-run` / `--yes`/`-y` —— 每个 AppCommand 都按相同语义实现,绝不允许 `mcp remove` 用 `--force`、`agent remove` 用 `--confirm` 这种漂移。 |
| **破坏性操作默认拒绝** | `remove` / `uninstall` 等不带 `--yes` 直接 `(exit 1)`。比今天的 "action=remove 即执行" 安全得多。 |
| **AppCmdContext 是 ToolContext 精确子集 + stdio helpers** | 显式收窄,不 spread,任何字段漂移都走类型系统强制声明。 |
| **registry 重名 throw,不静默覆盖** | 与 LocalTool registry 同纪律,模块加载期就把冲突暴露在 stack。 |
| **`app` 工具永远 always-visible** | 不允许任何机制隐藏 `app`,否则 LLM 失去触达全部应用能力的唯一入口。 |

---

## 5. 类骨架

```
src/main/pi/appcmd/
├── types.ts                       AppCommand / AppCmdContext / AppCmdInternalResult 契约
├── parseCmdline.ts                cmdline → argv,thin wrapper over vendored 函数
├── flags.ts                       boolean / string / array flag parser + `--` 终止符
├── registry.ts                    AppCommandRegistry + 单例 appCommands
├── dispatcher.ts                  构造 AppCmdContext + stdio buffer + 错误收敛 +
│                                  formatAppCmdContent + buildTopLevelHelp
├── _commonFlags.ts                跨命令共享 flag spec + isHelp/isJson/isDryRun/isYes
│                                  helper —— UX 一致性的红线就在这一个文件
├── index.ts                       启动期 side-effect 注册全部 AppCommand
├── builtins/                      AppCommand 实现仓库(详见 §6 文件布局范式)
│   ├── hello/                     骨架示范命令(say/list/fail),覆盖每个契约角
│   │   ├── index.ts               AppCommand object + 顶层路由 + HELP_TOP
│   │   ├── say.ts                 subcommand:FLAGS + HELP + runSay 强内聚
│   │   ├── list.ts                同上
│   │   └── fail.ts                同上
│   └── mcp/                       第一个真实命令(MCP server 管理,7 subcommand)
│       ├── index.ts               HELP_TOP + switch 路由 + AppCommand object
│       ├── _shared.ts             parseEnvFlags / validateName / describeStatus
│       ├── add.ts                 自定义 server
│       ├── update.ts              partial patch + auto-bump version
│       ├── remove.ts              破坏性 → 默认拒绝 --yes
│       ├── connection.ts          connect / disconnect / reconnect 三动作共享文件
│       └── status.ts              read-only + --json 支持
├── vendor/
│   ├── argsTokenizer.ts           Vendored from args-tokenizer 0.3.0 + [M1] 改动
│   └── argsTokenizer.LICENSE      上游 MIT 全文,逐字
└── __tests__/                     parseCmdline / flags / dispatcher / mcp/* 单测

src/main/pi/tools/
└── app.ts                         LocalTool 包装层 —— LLM 看到的 spec + 顶层路由
```

### 5.1 AppCommand 契约

```ts
interface AppCommand {
  readonly name: string;       // 命令名(无空格,推荐用 `-`,与 git/npm/docker 对齐)
  readonly synopsis: string;   // 一行 ≤80 字符,进 app 工具描述
  readonly help: string;       // man 风格多行,LLM 按需读
  run(argv: string[], ctx: AppCmdContext): Promise<void>;
}
```

`run` 不返回字符串,通过 `ctx.print` / `ctx.printErr` / `ctx.setExitCode` 写入 —— **像写 Node CLI 一样**。dispatcher 在外层收集成 `AppCmdInternalResult { stdout, stderr, exitCode }`,再合成 LLM 可见的 string。

### 5.2 AppCmdContext

```ts
interface AppCmdContext {
  // 透传自 ToolContext 的精确子集(spawn 专属字段不暴露)
  profileId: string;
  agentId: string;
  sessionId: string;
  signal: AbortSignal;
  tracer: Tracer;
  eventSender: WebContents | null;
  chunkStream: ChunkStream | null;
  callId: string;

  // stdio helpers,dispatcher 提供
  print(text: string): void;       // 累积到 stdout buffer
  printErr(text: string): void;    // 累积到 stderr buffer
  setExitCode(code: number): void; // 默认 0,非 0 显示 "(exit N)"
}
```

### 5.3 dispatcher 输出合成规则

```
<stdout>                  always
<stderr if non-empty>     单换行隔开
(exit <code>)             仅 exitCode !== 0 时附加,与 shell 一致
```

退出码语义:
- **0** —— 成功(不显示)
- **1** —— 命令执行业务失败(包括 run throw 被 dispatcher 收敛)
- **2** —— usage error(子命令拼错 / 缺位置参数 / flag 解析失败)
- **42** 等 —— 业务自选
- **127** —— 顶层未知命令(已转为顶层 help,不附此码)

> Run throw → 收敛为 `stderr + exit 1`。**不**重新抛 —— 语义是"命令崩溃",与"工具调用失败"两回事;真"工具调用失败"由 LocalTool registry 在更外层处理。

### 5.4 LocalTool 层包装

`tools/app.ts` 把 `app` 实现成一个**普通 LocalTool**,handler 内部:
1. `parseCmdline(args.cmd)` —— 语法错降级顶层 help + tip
2. 空 / `--help` / `-h` → 顶层 help
3. `appCommands.get(name)` 拿命令;未知命令降级顶层 help + tip
4. `dispatchAppCommand(cmd, rest, ctx)` 执行 + `formatAppCmdContent` 拼最终 content

`app.spec.description` 用 getter 实时拼接所有命令 synopsis —— 命令注册期完成后第一次 `pi.streamSimple` 时定型,dev hot-reload 也自然刷新。

---

## 6. AppCommand 文件布局范式

一个 AppCommand 不是一个 subcommand,是一个**域** —— `mcp` 内部有 `add` /
`update` / `remove` / `connect` / `disconnect` / `reconnect` / `status` 等
subcommand。直接
写一个单文件,会膨胀到 400-500 行;`flags / help / 实现` 三件事在文件里来回找,
读起来吃力。

这套设计**按 subcommand 拆分**,不按"parse vs run"拆分。下文给出门槛、目录
范式与文件职责。

### 6.1 决策门槛 —— 何时单文件 / 何时目录

| 命令规模 | 范式 | 说明 |
|---|---|---|
| 1-3 个 subcommand,整体 ≤ 200 行 | **单文件** `<name>.ts` | 例如:一开始的 demo / 极简命令。文件内分四段:`HELP` const → `FLAGS` const → `runXxx` 函数 → `AppCommand` object。 |
| 4+ subcommand,或 ≥ 300 行 | **目录** `<name>/` | 强制走目录形态。一个 subcommand 一个文件,顶层 `index.ts` 只管路由 + `HELP_TOP`。 |

**hello 已经按目录形态实现**(作为活模板),即便它只有 3 个 subcommand —— 让
第一个真实命令(`mcp`)落地时直接照搬。

### 6.2 目录范式 —— `hello/` 是参考实现

```
src/main/pi/appcmd/builtins/
└── hello/
    ├── index.ts        AppCommand object + 顶层 switch 路由 + HELP_TOP
    ├── say.ts          subcommand 1:HELP + FLAGS + runSay(强内聚同文件)
    ├── list.ts         subcommand 2:同上
    ├── fail.ts         subcommand 3:无 flag 的极简形态
    └── _shared.ts      (可选) 多个 subcommand 共享的小 helper,带 `_` 前缀
```

- `index.ts` —— **只**做三件事:declare `AppCommand` object、顶层 switch 路由、
  `HELP_TOP` 汇总文案。**不**写具体业务逻辑。≤ 100 行。
- `<subcommand>.ts` —— 一个 subcommand 的**全部三件事**(HELP / FLAGS / run)
  在同一文件。它们是强内聚的 —— 一起读、一起改、一起测,没有把它们拆开的
  动机。
- `_shared.ts`(可选)—— 跨 subcommand 复用的小 helper(纯函数 / 转换器)
  放这里。带 `_` 前缀表"内部用,**不**对应一个 subcommand"。
- 子文件**不**默认导出 `AppCommand` 形态,只导出 `runXxx`(具体函数),由
  `index.ts` 拼装。这避免了"哪个文件才是入口"的歧义。

### 6.3 为什么不按 "parse vs run" 拆

脑海里可能想到 Express handler / Next.js page 那种"validation 一个文件、
handler 一个文件"的范式。但那两者真的能分开是因为它们**复用 + 异步分布在
不同请求生命周期**(middleware vs handler)。AppCommand 的 subcommand 不是
这样:

- `parseFlags(argv, FLAGS)` 一行,紧跟着读 `parsed.flags.foo` 立即用
- 没有任何 reuse(每个 subcommand 的 flags 都独特)
- 完全同步

把这两件事拆到两个文件,意味着 `run.ts` 要再 `import { FLAGS } from './parse'`
—— 一个本来 20 行的函数变成了"翻文件去看 flags 长啥样 + 翻回来看用法"。
**没有任何信息隐藏,只增加了文件数与跳转成本。** 这是过度切分。

### 6.4 单文件简形态(供小命令参考)

如果命令真的只有 1-2 个 subcommand 且整体 ≤ 200 行,允许单文件。同一文件内
按四段排列:

```typescript
// builtins/tiny.ts
import { parseFlags, type FlagSpec } from '../flags';
import type { AppCommand } from '../types';

// 1. HELP 文本(模板字符串 const,模块加载期定型)
const HELP_TOP = `USAGE\n  tiny <subcommand>\n...`;
const HELP_DO = `USAGE\n  tiny do <arg>\n...`;

// 2. FLAGS specs
const DO_FLAGS: FlagSpec[] = [/* ... */];

// 3. 子命令实现
function runDo(argv: string[], ctx: AppCmdContext): void { /* ... */ }

// 4. AppCommand 入口
export const tinyCommand: AppCommand = {
  name: 'tiny',
  synopsis: '...',
  help: HELP_TOP,
  async run(argv, ctx) { /* switch */ },
};
```

一旦该文件超过 200 行或 subcommand 数到 4,**立即重构成目录形态** —— 这是
迁移性增量重构,不算违规。新文件结构跟 `hello/` 一致。

### 6.5 测试粒度

- **目录形态**:每个 subcommand 可以有独立测试文件
  `__tests__/<command>/<subcommand>.test.ts`,直接 import `runXxx` 测纯函数
  行为。AppCommand object 的端到端集成测试统一通过 `tools/__tests__/app.test.ts`
  覆盖。
- **单文件形态**:就放一个 `__tests__/<command>.test.ts`,所有 subcommand
  共用 fixture。

---

## 7. cmdline 词法 —— vendored tokenizer

### 7.1 边界:只做 quoting,不做 expansion

`parseCmdline` **只**处理 shell quoting / escape;**绝不**支持 `$VAR` / `$(...)` / `~` / glob / `|` / `>` / `&&`。LLM 在 `app(...)` 里写 `|` `>` `$(pwd)` 时,token 一律按字面字符出来,由 AppCommand 自己拒绝。这是设计意图,不是缺失。

### 7.2 实现:vendored `args-tokenizer` 0.3.0 + 一处 POSIX 修正

**为什么 vendor 而非 npm 装**:上游 17 个月无新版、4 open issue、30 stars —— 事实上 abandoned but works。装 npm 依赖的最大卖点("自动收 patch")对这个包不成立。50 行源码 + 零依赖,vendor 是干净选择。

**模块布局**:
```
appcmd/vendor/
├── argsTokenizer.ts       上游源码 + 完整 header 注明 vendor 出处 + 修改清单
└── argsTokenizer.LICENSE  上游 MIT 全文
```

**[M1] 改动**:上游在所有引号语境下都把 `\` 当转义引入符,所以 `'a\b'` 出来是 `ab`(吃掉 `\`)。POSIX 单引号规则是"内部一切字面",bash 里 `'a\b'` 就是 `a\b`。我们改:

```ts
// upstream:
if (char === "\\") { escaped = true; continue; }
// [M1]:
if (char === "\\" && openningQuote !== "'") { escaped = true; continue; }
```

理由:LLM 是按 POSIX 训练的,如果 tokenizer 偷偷吞 `\`,LLM 后续基于"我刚传的值有 `\`"的推理会与现实漂移。**这是 vendor 范式真正发光的地方** —— 想改就改,无需 fork、无需发 PR、无需维护下游包。

其它一处差异(孤立尾 `\` 静默吞)**故意保留与上游一致**,降低未来 diff 比对负担。

### 7.3 wrapper 契约

`parseCmdline.ts` 是 thin wrapper:
- 把 vendored 函数的 throw 收敛成 `{ ok: false, error }` envelope
- caller 不需要包 try/catch
- 错误消息直接透传上游("Closing quote is missing.")

测试 `parseCmdline.test.ts` 同时是 vendored 文件的**契约文档** —— 任何上游 diff 想拉,必须先过测试;[M1] 想撤,必须先改测试。

---

## 8. 顶层 help 的"松散"设计

```
LLM 输入                              行为
─────────────────────────────────    ─────────────────────────────────────
""                                  → 顶层 help
"--help" / "-h"                     → 顶层 help
"随便什么" / "bogus" / 中文/emoji   → 顶层 help + tip: no command named "..."
'hello "unterminated' (语法错)      → 顶层 help + tip: cmdline parse error: ...
"mcp add brave"      (已知命令)     → 真执行
"hello bogus-sub"    (子命令拼错)   → (exit 2) + 提示去看 hello --help
```

设计意图:**顶层 = 教 LLM 怎么用,不是严格守门**。LLM 找不到正确形态时,把 help 端到它面前比惩罚有效得多。顶层降级路径**不**附 exit code,LLM 看到的就是"我得到了帮助",零负面信号,降低重试摩擦。

一旦 LLM 走进具体命令域(`hello <something>`),反馈就该精确 —— 那是 `(exit 2)` + 命令级 hint 的工作,**松散不向命令内部渗透**。

---

## 9. 工具数对比 + 替代方案为什么不行

### 9.1 三条路对比

```
传统 (今天)                    "藏起来" 方案              本方案 (app shell)
────────────────              ─────────────              ──────────────────
manage_mcp({                  load_capability(           app("mcp add
  action: "add",                "mcp_management")          brave-search
  name: "brave",              ↓ 等一轮                      --transport stdio
  transport: "stdio",         manage_mcp({...})            --command npx
  env: {API_KEY:"xxx"}                                     --env API_KEY=xxx")
})                                                       ↑ 一次调用、shell 范式、
                                                           内部直调 mcpClientManager
                                                           零外部依赖
38 个工具                      6 个常驻 + 按需注入          5 个常驻,永远是 5 个
JSON schema 学习成本           JSON schema 学习成本         shell 范式(LLM 已掌握)
```

### 9.2 为什么 "渐进披露 typed tools" 方案不行

> 范例:LLM 调 `load_capability("mcp_management")`,系统下一轮把 `manage_mcp` 等 JSON Schema 注入。

这只是**把工具藏起来**,调用范式仍然是 N 个 typed tool。LLM 依然要学每个工具的 JSON schema,依然要走"load → 等一轮 → 调用"。更恐怖的是:**它会修改历史消息前缀,让 prompt cache 失效**,对用户来说是直接的成本提升。

`app` 方案**改了调用范式** —— LLM 不需要学新东西,shell 肌肉记忆直接迁移过来,且 prompt cache 友好(`app` 工具描述始终稳定)。

### 9.3 为什么 PI Skill 范式不能直接套

PI Skill 启动期把每个 skill 的 name + description 进 system prompt,LLM 用 `read` 加载 SKILL.md,用 `bash` 跑外部脚本。对 PI 完美 —— 它是纯 CLI agent,**没有**应用内能力。但对 Deskmate:
1. **能力不可达** —— `manage_mcp` 内部要调 `mcpClientManager.add(...)`,LLM 用 `bash` 调不到 Electron 主进程内存对象。
2. **类型与回滚丢失** —— Skill 走 stdout → string,没有结构化 envelope、不能 throw、不能传 `ctx.signal`。

`app` 是 PI Skill 的**内化版本**:同样的渐进披露哲学、同样的 shell 范式,但披露对象从"外部脚本"换成了"内部 typed 代码"。

### 9.4 量化对比

| 维度 | 今天 | 本方案 |
|---|---|---|
| LLM 看到的 system prompt 工具数 | 22–38(历史峰值) → 14(Phase 7 后) → **10**(Phase 8a 后) | **5**(目标态) |
| 单个工具 schema 字节 | 平均 ~600 字符 | `app` 描述 ~400 字符(含全部 synopsis) |
| LLM 学习成本 | N 个独立 JSON schema(N ∈ [10, 38]) | 1 个 `app` + shell 范式(已掌握) |
| 添加新能力 | 写 LocalTool + 注册 + 改 prompt | 写 AppCommand + 注册 |
| 出错反馈 | JSON envelope | stderr + exit code(LLM 母语) |
| 链式调用结构化输出 | 工具直接返回 JSON object | `--json` flag + LLM 自己解析 |
| 用户审计可读性 | tool call JSON 树 | `app("mcp add brave")` 一行 |

### 9.5 权衡与已知劣势(以及补齐机制)

本方案**不是**全方位升级 —— 用一些维度上的真实退步,换了另一些维度上更
高频、更核心的收益。下面把这笔交易摊开,**避免未来维护者(包括未来的我)
再质疑"为什么不直接用 typed tool"时只看到单方面的辩护**。

#### 真实劣势(承认 + 补齐手段)

| 维度 | 老(typed tool) | 新(`app` shell) | 补齐机制 |
|---|---|---|---|
| 嵌套结构参数准确度 | JSON Schema 强约束,LLM 漏字段概率低 | cmdline 在 3+ 层嵌套上更脆 | **方案 A**:保留 flag `--config-json '<jsonStr>'`(`curl -d` 范式,LLM 母语) |
| multi-line / 大段长文本参数 | JSON 字符串塞 `\n` 是日常 | cmdline 不适合塞多行 | **方案 B**:`--file local://<path>`,先 `write` 落盘再引(`kubectl -f` 范式) |
| 极深嵌套(3+ 层 union) | 仍可,但本来也不舒服 | `--config-json` 也容易漏字段 | **方案 C**:重新设计成 setter 命令(`git config user.name "x"` 范式),多次调用累积,而非一口气 PUT 整对象 |
| 结构化结果回流(链式调用) | 工具默认返回 JSON object | 默认人话字符串 | read-only / 关键 op 必须支持 `--json` flag(已是设计纪律) |
| UI 展示 dispatch | `toolName` 直接当 key 用 | 所有调用 toolName === 'app',丢失分发 | **resolver 层**:`appCmdResolver.ts` 把 cmdline 翻译成虚拟 key `app:<cmd>.<sub>`,`toolCallDisplayConfig` / `toolCallViews` 入口加一行 `key = resolveAppDisplayKey(...)`,后续 switch 完全复用现有形态 |
| 主进程内类型一致性 | `args: T` 一路 typed,IDE 跳转一遍改完 | cmdline string 是黑盒,改 flag 名靠 grep,改 flag 语义编译器不报错 | **无完美补齐** —— 但每个 subcommand 文件封闭(~80 行),在文件内重建类型成本,远低于"维护 N 个工具 schema 永远不漂移";只影响维护期、只影响开发者,不影响用户 / LLM |
| 测试成本 | 直接喂 typed object 测 handler | 要测"cmdline → tokenize → flags → run"整条链 | fixture 范式收敛在 `__tests__/mcp/_fixture.ts`(`vi.hoisted` 形态),后续域照搬;一次性成本不是持续成本 |
| 每次调用字节开销 | 紧凑 JSON | cmdline 略冗余(空格、`--`) | 量级可忽略 —— LLM 输出 token 远不是瓶颈 |

**`--config-json` flag 的纪律**:
- flag 名**统一**`--config-json`,**禁止**漂移到 `--data` / `--payload` / `--body`。
- 仅在 subcommand 真需要嵌套结构时启用;能用 `--key val` / `--env K=V` 搞定的**绝不**给。
- 解析失败 `(exit 2)` + stderr 给出"JSON parse error: <msg> at position N"。
- 与同义 flag 互斥:开了 `--config-json` 就忽略 `--name` / `--transport` 等(或定明 precedence 写进 help)。

**`--file <path>` flag 的纪律**:
- 路径接受 `local://` URI(走 renderer / dev 路径解析),其它路径同 `read` / `write` 工具语义。
- 适用于 system prompt body、文件内容、大对象等**多行长文本**字段,而非短小标量。
- 与 `--config-json` 互斥(同一字段两种来源会把 LLM 绕晕)。

**UI resolver 的纪律**:
- `appCmdResolver.ts` 是**纯函数**、放 renderer 侧、**不**引入 main 进程的 vendored tokenizer —— 渲染器要的不是"正确解析",是"足够好让 UI dispatch"。
- 只切前 2 个非 flag token:`app("mcp install ...")` → `app:mcp.install`,`app("mcp ...")` → `app:mcp`,空 / 解析失败 → `app`(走 default)。
- 每个域(`mcp` / `agent` / `schedule`)写专属 view 组件,复用 `ShellToolCallView` 的 `parseToolArgs → 渲染` 模式;**禁止**让 renderer view 跨进程拉主进程子系统。
- 长跑 subcommand 继续走 `ctx.chunkStream.send(...)` partial 流,UI 监听 partial chunk 渲染进度 —— 与现有流式机制零冲突。

#### 评估结论

用四个维度(LLM 准确度、认知负载、维护成本、用户审计可读性)频率加权后:

- **80% 简单调用场景**(标量 / list / KV map / enum):新方案明显赢 —— shell 在 LLM 训练分布里的密度远高于"自定义 schema 的 JSON 调用"。
- **<20% 复杂参数场景**:老方案略赢,但差距用 `--config-json` / `--file` / setter 重设计三档补齐机制能压到接近持平;且这些场景频率本来就低,边际影响小。
- **认知负载 + prompt cache + 用户审计**:新方案**复利性**优势 —— system prompt 工具数从 N 降到 5,长 session 中 LLM 选错工具的概率超线性下降,prompt cache 命中率提升直接降低 API 成本 + 首 token 延迟,用户加一个 MCP server 不再让 prompt cache 全部失效。
- **维护期 IDE 体验**:新方案略劣,但只影响 deskmate 团队,不影响用户 / LLM,且 subcommand 文件封闭性降低了这条税的烈度。

**净判断:新方案显著赢,且越往后越赢(MCP server / agent / schedule 数量增长时,老方案的"工具激增"会持续恶化,新方案的 `app` 入口永远是一行)。但 Phase 3+ 迁移时,本节列的补齐机制(`--config-json` / `--file` / UI resolver)必须**跟着域一起落**,不能拖到"以后再补"。**

---

## 10. 实现历史

所有 LocalTool → AppCommand 迁移已完成,顶层 LLM-visible 工具收敛到 **8**
(`read` / `write` / `find` / `search` / `shell` / `ask` / `download` / `app`)。

### 10.1 域 ↔ subcommand 映射

| 域 | subcommand |
|---|---|
| `mcp` | add / update / remove / connect / disconnect / reconnect / status |
| `agent` | add / update / remove / list / status / set-primary |
| `skill` | install / uninstall / bind / unbind / list / status / search |
| `schedule` | create / list / update / remove / run(feature-gated)|
| `web` | search / image / fetch / read-html(read-only 域模板)|
| `subagent` | spawn / spawn-many(feature-gated;`AppCmdContext` 扩展了 spawn 专属字段)|

实现仓:`appcmd/builtins/<domain>/`,业务内核 `kernel/*.ts` + CLI 同住。

### 10.2 Phase 编号索引

| Phase | 主题 |
|---|---|
| 1 | `app` 骨架 + `hello` 示范命令 + vendored tokenizer |
| 2–7 | 六大域整体迁移(mcp / agent / skill / schedule / web / subagent),每域一次到位:业务内核搬迁 / 旧 LocalTool 物理删 / renderer 切走 / 测试 / 文档同步 |
| 8a | 顶层瘦身:删 `manage_process` / `move_file` / `coding_agent` / `get_current_datetime`;5 个 spec.name 重命名(`execute_command → shell` 等)|
| 8b | 内部 symbol 与新工具名物理对齐(文件 / type / 函数 / log mod / 测试)|
| 8c | 死 flag 清理(`deskmateFeatureCodingAgent` 整段删)|
| 9a | Internal URL Router 基础设施 + 新 `read` 工具骨架(filesystem / internal-url / office 三 backend);与旧 `read_file` / `read_office_file` 并存 fallback |
| 9b | 删 `read_file` + `read_office_file`,补 `:pN` page selector,office backend lazy import;**0 legacy 兼容**(见 [internal-uri-and-unified-read.md §10](internal-uri-and-unified-read.md)) |
| 9c | URI 三层统一第一阶段(`unifed-uri.md` Phase A):新增 `local://` / `knowledge://` 可写 handler + sandbox 边界检查 + `InternalUrlRouter.write()`;`write` 工具按 scheme 分发到 router(4 种 mode 共用 mode 计算逻辑;overwrite 跳过 read-original 让 read-only scheme 错误正确传出);`ResourceNotFoundError` sentinel 替代字符串匹配 |
| 9d | URI 三层统一 message schema 阶段(`unifed-uri.md` Phase C):`FileContentPart` / `OfficeContentPart` / `OthersContentPart` 的 `filePath` 字段物理改名 `fileUri` + `FileUri` newtype brand;`write` 工具 args/result `filePath → fileUri`(JSON schema 同步);`download` 工具 result 同改;`subAgentChat.trackDeliverables` 读新字段。**零兼容**:旧 jsonl 里的 `filePath` 字段在新代码下不被消费 |
| 10 | `present_deliverables` 工具下线 + `download_file` LLM-visible 名重命名为 `download`:UI 端拆掉 `presentedFiles` 字段、`attachPresentedFilesToFollowingAssistant` 跨消息搬运逻辑,统一走 assistant 文本里的 URI/abs path 抽取;system prompt 加 `FINAL DELIVERABLES — MENTION CREATED FILES IN YOUR FINAL REPLY` 段强约束。SubAgent `trackDeliverables` 仅保留 `write` / `download` 自动跟踪兜底审计,父 agent 收到的 `Deliverables` 段不变。 |

### 10.3 新增域时的纪律(若将来再发生)

- 业务内核必须**与 CLI 同住** `appcmd/builtins/<domain>/kernel/`,**禁止**新建 `pi/tools/<domain>/`。
- 同批次完成:内核搬迁 / 旧 LocalTool 物理删 / renderer + IPC 消费者切换 / 测试 / 文档同步;**禁止** `@deprecated` 兼容壳(项目规则 `ts-no-deprecated-leftovers`)。
- 文件布局照 §6 范式(`hello/` / `mcp/` 是活模板);共享 flag 照 `appcmd/_commonFlags.ts`;fixture 范式见 `__tests__/<域>/_fixture.ts`(`vi.hoisted` + `export { mocks }`)。

---

## 11. 注意事项

- **`read` / `write` / `edit` / `shell` 永远是独立工具,绝不并入 `app`。** 它们是高频原语,独立 schema 让 LLM 调得最准。`app` 只装"低频但多样"的应用能力。
- **AppCommand 的 `help` 文本要被当代码写,不是文档。** 每个字都是 prompt token,要严肃迭代。差的 `help` = 差的 LLM 体验。
- **AppCommand 共享公共 flag 语义必须统一。** `--help` / `--json` / `--dry-run` / `--yes` 在每个命令里**完全相同**,UX 一致性是设计红线。
- **破坏性命令默认拒绝。** `remove` / `uninstall` 不带 `--yes` 直接 `(exit 1)`,比今天的"action=remove 即执行"安全得多。
- **AppCommand registry 重名直接 throw。** 与 `tools.register` 同纪律,杜绝静默覆盖。
- **AppCmdContext 不允许从全局 / 静态字段反向读"当前执行上下文"。** 一律走 `ctx` 参数 —— 与 `ToolContext` 同纪律。
- **`ctx.signal` 必须透传到底层 I/O。** 漏传会让取消挂起整个上游超时(30–60s),阻塞用户发送新消息。
- **`app` 永远 always-visible。** 任何机制隐藏它都是 bug —— LLM 失去触达全部应用能力的唯一入口。
- **dispatcher run throw → stderr + exit 1,不重新抛。** "命令崩溃" ≠ "工具调用失败"。后者由更外层 LocalTool registry 处理。
- **vendored 文件改动必须更新 `vendor/argsTokenizer.ts` 头注的 Modifications 段** —— 让任何上游 diff 比对都直接看得出。

---

## 12. 相关模块

- 上游:[Agent Loop(pi)](agent-loop.md) —— `pi/tool.ts` / `pi/session.ts` per-turn 构建 catalog 后透传 ctx 到 `executeToolCall`,`app` 与其它 LocalTool 走同一路径。
- 同级:[本地工具(pi/tools)](../src/main/pi/tools/ai.prompt.md) —— LocalTool registry 契约 + 全部本地工具实现规范。`app` 是其中的一个 LocalTool。
- 被依赖:[MCP Runtime](../src/main/lib/mcpRuntime/ai.prompt.md) —— MCP server 的 server-scoped 工具执行入口 `executeToolOnServer` 被 `pi/tool.ts::executeToolCall` 在 `route.kind === 'mcp'` 分支调用。
- 设计来源:PI agent (https://pi.dev/) —— 4 工具 + 渐进披露 + 自解释 + bash 母语,本设计的灵感来源。
