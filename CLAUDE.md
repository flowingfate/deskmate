# CLAUDE.md

## 项目简介

DESKMATE AI Studio — 一款桌面 AI 助手，让用户能够创建、配置并与 AI Agent 对话。Agent 可通过 Model Context Protocol (MCP) 执行工具（网页搜索、文件操作、Shell 命令、浏览器自动化），维护长期记忆，并生成子 Agent 并行处理任务。

**技术栈：** Electron 41 + React 18 + TypeScript 5，Webpack 5，TailwindCSS 3，Radix UI，Vercel AI SDK 5.x（流式），`@modelcontextprotocol/sdk`，better-sqlite3（日志存储），Monaco Editor，Playwright（浏览器自动化）。

**架构：** Electron 多进程模型 — 主进程（Node.js：认证、聊天引擎、MCP 运行时、数据持久化、语音）+ 渲染进程（React SPA：聊天 UI、Agent 编辑器、设置）+ 预加载脚本（类型安全的 IPC 桥接）。

## 命令

以下是常用的 package.json 脚本：

#### 开发阶段，修改代码后可用以下命令验证（按需执行）

- `npm run build` 完整项目构建（Vite）
- `npm run typecheck` 运行 TypeScript 类型检查
- `npm run test` 运行 vitest 单元测试。**通过 Electron 的 Node 运行**（`ELECTRON_RUN_AS_NODE=1`），以匹配 `better-sqlite3` 等原生模块的 ABI（Electron 41 = ABI 145）；切勿改回直接 `vitest run`，否则在本机 Node 上会因 `NODE_MODULE_VERSION` 不一致而全部失败。

**注意**：这几个命令不要运行的太频繁，不然我的机器吃不消，大部分时候，只在任务接近尾声的时候调用一次就可以了


## 上下文加载指南

开始任务前，根据任务类型阅读对应文档：

| 任务类型 | 阅读文件 |
|----------|----------|
| 了解主进程架构 | [arch-main.md](ai.prompt/arch-main.md) |
| 了解渲染进程架构 | [arch-render.md](ai.prompt/arch-render.md) |
| 修改 chat orchestrator / LLM provider / OAuth | [src/main/pi/ai.prompt.md](src/main/pi/ai.prompt.md) |
| 修改本地工具系统 / 新增 AppCommand（`app` 伪 shell） | [ai.prompt/tool-system.md](ai.prompt/tool-system.md)（总体设计 + 落地路径） + [src/main/pi/tools/ai.prompt.md](src/main/pi/tools/ai.prompt.md)（LocalTool 细节） |
| 修改持久化层（profile / agent / session / schedule 写盘 + IPC 通道） | [ai.prompt/persist.md](ai.prompt/persist.md)（架构总览） + [src/main/persist/ai.prompt.md](src/main/persist/ai.prompt.md)（模块细节） |
| 修改 renderer 状态层 / persist 域 atom | [ai.prompt/persist.md §6.3](ai.prompt/persist.md)（atom 一览 + 订阅通道） + [ai.prompt/arch-render.md](ai.prompt/arch-render.md) |
| 了解数据流 / IPC / 流式传输 | [data-flow.md](ai.prompt/data-flow.md) |
| Git / 测试 / 发布工作流 | [workflows.md](ai.prompt/workflows.md) |
| 修改特定模块 | 该模块目录下的 `ai.prompt.md`（如存在） |
| 通过运行时日志分析/调试 | [log-analysis.md](ai.prompt/log-analysis.md) |

进入模块目录后，检查是否存在 `ai.prompt.md`，若存在请优先阅读。

## 任务前检查清单

开始任何代码修改前：
1. 确定目标模块，阅读每个模块的 `ai.prompt.md`（如存在）。
2. 若变更跨多个模块，根据涉及的进程先阅读 [arch-main.md](ai.prompt/arch-main.md) 和/或 [arch-render.md](ai.prompt/arch-render.md)。
3. 运行 `npm run check:impact -- <你计划修改的文件>` 查看受影响模块，阅读其 `ai.prompt.md`。
4. 检查每个涉及模块 `ai.prompt.md` 中的 **协变映射（Co-Change Map）** — 它列出了必须同步修改的文件。
5. 若涉及 IPC 通道，阅读 [data-flow.md](ai.prompt/data-flow.md) 和 IPC 模块的 [ai.prompt.md](src/shared/ipc/ai.prompt.md)。

## 日志分析

开发调试或排查问题时，使用脚本查看日志辅助分析。
完整用法见 [log-analysis.md](ai.prompt/log-analysis.md)。

## 开发日志采集

Deskmate 用 pino + sqlite 把主进程 / 渲染进程 / worker 的结构化日志写入本地 sqlite db，方便 AI 编码助手在开发调试时检查运行时行为。排查问题时优先使用此框架，而不是临时插入 `console.log`。

- 开发模式启动：`npm run dev`。
- 日志数据库位置：`{userData}/logs/dev.db`（dev，写入 level `debug`）/ `{userData}/logs/app.db`（prod，写入 level `info`）。两者都跨启动累积，由 worker 内 200k 行滚动控量。`{userData}` 在本仓库被 bootstrap 覆盖为 `~/.deskmate/`。
- 应用仍在运行时，分析前先 flush worker buffer：Doctor agent 的 `read_app_logs` / `trace_timeline` 工具入口已内置 `await flushLogs()`，无需额外操作；外部 CLI（`bun scripts/log.ts`）没有跨进程 flush 入口，若刚发生的事件不在结果里，先在应用窗口里触发一次任意操作（让 worker 自动 flush），或重启应用后再查。
- CLI：`bun scripts/log.ts <subcommand>`。常用子命令：`schema`、`stats`、`query --since 10m --level warn+`、`top-errors --since 1h`、`tail --component "chat.*"`、`trace <traceId>`、`sql "<SELECT>"`。`--level` 默认是精确集合（`warn,error` = IN）；要 "warn 及以上" 用 `warn+`。`--grep` 是 SQLite FTS5 MATCH 语法（`:` `-` 是操作符，原始词请包双引号）。
- GUI：dev 模式下应用菜单 `Develop → Open Log Viewer`（`Cmd/Ctrl+Alt+L`）。
- 得出结论前**始终检查响应顶部的 `[Scope]` 与 `[DB]` 行**：`[DB] last entry at <iso> (Xs ago)` 告诉你 db 内最新事件距 now 多久——若与 now 相差很大（>分钟级），日志反映的是上一次运行，应当重启应用生成新数据再查。
- 对于渲染器行为，依赖通过 `log:write` IPC 转发并落进同一 sqlite db 的结构化渲染器日志（`process_type='renderer'`），而不是临时添加仅限渲染器的调试输出。

## 禁止模式

- **绝不违反**: 不能进行 git 操作，除非我主动要求
- **禁止用 `...(x !== undefined ? { x } : {})` 这种条件展开来「省略 undefined 字段」。** 本项目没开 `exactOptionalPropertyTypes`,可选字段直接 `x: input.x` 赋值即可(`JSON.stringify` 自动丢弃 `undefined` 键,落盘形态不变)。直接赋值,别套三元 spread。
- **代码标识符使用英文，文档和注释推荐使用中文。** 变量名、函数名、类名、IPC 通道名、JSON 字段名等代码中的标识符必须使用英文。文档（`ai.prompt.md`、注释、提交描述）推荐使用中文，便于团队协作。提交格式中的 type(scope) 部分保持英文，描述可以用中文。代码中的日志消息、错误字符串建议英文，以保持与国际社区的兼容性。
- **新增 npm 依赖前必须检查。** 新增依赖前先在现有 `package.json` 中搜索类似功能。优先使用已安装的包。
- **依赖分类规则：被 main 进程代码使用的包放 `dependencies`，其余放 `devDependencies`。** `dependencies` 放所有 main 进程运行时依赖（原生模块、纯 JS 库均包含在内）；renderer 组件库、构建工具、类型定义等放 `devDependencies`。可用 `bun scripts/check-deps.ts` 验证分类是否正确。
- **禁止破坏性修改 JSON 持久化 schema。** `{userData}/profiles/` 下的文件使用 JSON。新增字段是安全的；重命名或删除字段需要在代码中提供迁移路径。
- **`messages.jsonl` 行格式 = `PersistedJsonLine`(三种)。** `shared/persist/types.ts` 定义 `PersistedUserMessage` / `PersistedAssistantMessage` / `PersistedToolResponse`(后者 `role: 'tool_res'`,与 `assistant.tool_calls[i].id` 对齐);Domain `Message` 由 `main/persist/messageWire.ts` 的 `rehydrate` / `dehydrate` 与之互转。Message shape 唯一来源是 `shared/types/message.ts` —— `shared/types/chatTypes.ts` 不再承载 Message 形态。
- **渲染器组件文件不得超过 500 行。** 过大的组件不可避免地会积累大量分散的 `useState`，导致长期维护困难。应拆分组件、提取 Hook，或将状态提升到 atom。参见 [arch-render.md §8 状态管理](ai.prompt/arch-render.md#8-state-management--must-read-before-changing-renderer-code) — **修改渲染器状态/组件前的必读内容**（涵盖 atom 命名 `*.atom.ts`、放置规则以及 props vs atom vs context 的决策）。
- **登录关键路径上禁止阻塞 `await` 非认证工作。** `auth:setCurrentSession` IPC handler 是登录门控 — 渲染器显示"正在登录..."直到它返回。此 handler 中的任何 `await` 都会直接增加感知登录时间。后台服务（scheduler、sync 等）必须 fire-and-forget（`.then().catch()`，而非 `await`）。参见 [复盘：v2.7.10 登录挂起](#postmortem-v2710-signing-hang)。
- **禁止对网络/LLM 调用使用无界顺序 `await` 循环。** 对 N 个各自访问网络的条目使用 `for...of { await }` 的时间复杂度为 O(N × 延迟)，没有上界。应使用带有每项超时的 `Promise.allSettled`，或 fire-and-forget。这尤其适用于冷启动追赶、批量同步和批量操作。
- **`fs.copyFile(src, dst)` 必须带 `fs.constants.COPYFILE_FICLONE` flag。** macOS APFS / Linux btrfs|xfs 走 `clonefile` / `FICLONE` ioctl(瞬时 + 0 额外空间);其它 fs 由 libuv 自动降级到普通 copy。**禁止**用 `fs.link()`(hardlink)做"复制" —— 会让两个文件后续编辑联动,破坏 chat 历史 / sandbox 物证完整性。新增 copy 路径时按既有 7 处用法对齐(`attachment` / `write` / `runtime/download` / `workspace ipc` / `skillDeviceImporter` / `persist agent + profile` / `CrashCaptureManager`)。背景见 [src/main/lib/attachment/ai.prompt.md](../src/main/lib/attachment/ai.prompt.md)。

## IPC Handler 纪律

门控 UI 转换的 IPC handler（认证、导航、窗口生命周期）是**关键路径代码**。在任何 IPC handler 中添加 `await` 前：
1. 问自己："渲染器会阻塞等待这个 handler 的响应吗？"如果是，`await` 会直接降低用户体验。
2. 问自己："这个工作会失败或花费无界时间吗？"如果是，不能在关键路径上 `await` 它。
3. 问自己："用户需要在 UI 继续前看到结果吗？"如果不需要，使用 fire-and-forget。

经验法则：返回 `{ success: true }` 来解除 UI 转换阻塞的 IPC handler 应在 < 100ms 内完成。其他一切放到后台。

## 变更后验证

每次代码修改后，完成工作前：
1. 运行 `npm run check:impact -- <已修改文件>` — 阅读所有标记的 `ai.prompt.md` 检查是否遗漏协变。
2. 如果修改的模块有 `__tests__/` 目录，运行 `npm test`。
3. 运行 `npm run build` 验证 TypeScript 编译和 Vite 打包通过。

##  类型约定

- 使用精确类型定义，不能使用 any, unknown, 不能强行使用 as XXX 类型，如果实在是绕不开，需要获得我的同意
- 使用 discriminated union 而不是以 optional field 的方式将多个类的数据强行混合到一个 interface 中

## 文档维护 ⚠️ 重要

所有 `ai.prompt.md` 文件遵循统一模板（参见任意现有文件）。

### 何时更新

修改代码后，**必须**检查：
1. 修改的模块是否有 `ai.prompt.md`？如有，内容是否仍然准确？如不准确，**在同一次提交中更新它**。
2. 变更是否影响全局架构（新增/删除模块、更改数据流）？如是，更新 `ai.prompt/` 下的对应文档。
3. 更新修改的任何 `ai.prompt.md` 顶部的 `<!-- Last verified: YYYY-MM-DD -->` 注释。

创建新的 `ai.prompt.md` 后，或当现有模块文档应从全局索引引用时，更新 [arch-main.md](ai.prompt/arch-main.md) 或 [arch-render.md](ai.prompt/arch-render.md)（取决于模块所属进程）中的模块表，添加或修正文档链接。

### 包含内容

每个 `ai.prompt.md` 必须包含：**关键文件**（文件、职责、大小的表格）、**架构**（设计决策、状态流、交互协议 — 仅包含代码中不明显的内容）、**常见变更**（常见修改场景的分步说明）、**注意事项**（陷阱、坑点、历史 bug）、**相关文件**（依赖关系及指向其他 `ai.prompt.md` 的 Markdown 链接）。

没有文档更新的代码变更是不完整的。这些文档是团队 AI 协作的基础。

