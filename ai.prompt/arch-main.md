# DESKMATE AI Studio — 主进程架构

<!-- Last verified: 2026-07-18 (explicit Profile routing and defaultProfileId) -->
## 1. 范围

本文档覆盖**主进程**（`src/main/`）和**预加载脚本**（`src/preload/`）。渲染进程架构见 [arch-render.md](arch-render.md)。

---

## 2. 进程模型（主进程 + 预加载）

| 进程 | 路径 | 关键信息 |
|------|------|----------|
| 主进程 | `src/main/` | Node.js；系统操作、认证、MCP、持久化、分析。入口：`bootstrap.ts` → `main.ts`；`bootstrap.ts` 在任何 import 之前设置品牌 userData 路径。 |
| 预加载 | `src/preload/main.ts` + 2 | 每个窗口独立的 `contextBridge`；通过 `src/shared/ipc/base.ts` 进行编译期 IPC 白名单校验。 |

---

## 3. 主进程模块

| 模块 | 路径 | 简介 | 文档 |
|------|------|------|------|
| Chat 引擎（pi） | `src/main/pi/` | **生产路径**：基于 `@earendil-works/pi-ai` 的多 provider chat orchestrator + auth + 压缩 + tool 适配 | [agent-loop.md](agent-loop.md)（架构总览） + [模块 ai.prompt.md](../src/main/pi/ai.prompt.md) |
| **持久化与 Profile runtime** | `src/main/persist/` + `src/main/profile.ts` + `src/main/profileRegistry.ts` | `ProfileStore` 管单 profile 磁盘数据；app-scoped `ProfileRegistry` 同时管 `profiles.json` index 与所有 runtime Profile 的并发 load、按 ID 查询与关闭，不提供 ambient selected accessor；`defaultProfileId` 仅是只读启动候选。每个 `Profile` 自己拥有 Pi、MCP、scheduler、Doctor 和至多一个 owner 主窗口。Doctor 每 Profile 仅允许一个 task；关闭 owner window 或 Profile 停止会 abort task，绝不把交互请求转发到其他 Profile。Doctor 的 session/schedule store 直接由 owner 注入，日志查询读取应用级 SQLite 日志；Doctor 也可读取应用级 CrashCapture 的 status 与 crash bundle。`startup/wins.ts` 是应用级窗口注册表，以 `Map<ProfileId, BrowserWindow>` 集中管理全部主窗口；主窗口按 Profile 建立、由 `additionalArguments` 注入不可变 identity；sender IPC 与 runtime event 均按 owner 精确路由。 | [persist.md](persist.md)（架构总览） + [模块 ai.prompt.md](../src/main/persist/ai.prompt.md) |
| MCP 运行时（external-only） | `src/main/lib/mcpRuntime/` | external MCP server 连接 / OAuth / 执行入口（`executeToolOnServer`，server-scoped）。**不再有"内置 server"**——本地工具已独立到 `pi/tools/` | [ai.prompt.md](../src/main/lib/mcpRuntime/ai.prompt.md) |
| 本地工具（pi/tools + pi/appcmd） | `src/main/pi/tools/` + `src/main/pi/appcmd/` | `LocalTool` registry + `ToolContext`（chat 主链路直接调）+ 全部本地工具实现 / 启动注册 / lazy 重依赖。**与 MCP 平级,不是 MCP**。`appcmd/` 是新引入的 **`app` 伪 shell** 基础设施(synopsis + help 双轨自描述、shell 范式调用、命令注册表) | [tool-system.md](tool-system.md)（总体设计 + 落地路径） + [模块 ai.prompt.md](../src/main/pi/tools/ai.prompt.md)（LocalTool 细节） |
| Agent 委派运行时（pi/subagent） | `src/main/pi/subagent/` + `src/shared/persist/types/subrun.ts` + `src/main/startup/ipc/subagent-run.ts` | **唯一生产路径**：顶层 `subagent` tool 注入 manager；manager 以 Agent graph 授权、parent-scoped persisted Subrun 实现 limits/cancel/state/stale recovery，SubAgentSession 产出正式结果；`subagentRun` IPC 提供 metadata、lazy transcript、cancel 与 live state | [subagent.md](subagent.md)（架构） + [模块 ai.prompt.md](../src/main/pi/subagent/ai.prompt.md)（实现细节） |
| 工作区 | `src/main/lib/workspace/` | 文件树、ripgrep 搜索、chokidar 监听、模糊文件索引 | — |
| 自动更新 | `src/main/lib/autoUpdate/` | electron-updater 封装，CDN/GitHub 更新检查 | — |
| 功能标志 | `src/main/lib/featureFlags/` | 默认值根据 isDev/brand/platform 控制；CLI `--enable/disable-features` | [ai.prompt.md](../src/main/lib/featureFlags/ai.prompt.md) |
| 截图 | `src/main/lib/screenshot/` | 多显示器覆盖层，`screenshot://` 协议，全局快捷键 | [ai.prompt.md](../src/main/lib/screenshot/ai.prompt.md) |
| Research window | `src/main/lib/research/` + `src/main/startup/ipc/research.ts` | `web research` 的可见研究窗口管理；Electron `BrowserWindow` + 多个 `WebContentsView` tab 展示外部网页，live DOM 抽取用户确认来源 | — |
| 媒体协议 | `src/main/lib/media/` | `media://` 字节直供 protocol,渲染层展示 sandbox/knowledge 图片 | [ai.prompt.md](../src/main/lib/media/ai.prompt.md) |
| Skills | `src/main/lib/skill/` | profile 级安装、agent 级绑定和 `skill://` 按需消费 | [skill-system.md](skill-system.md) |
| 终端管理器 | `src/main/lib/terminal/` | 池化的 `command`（临时）和 `mcp_transport`（持久）终端 | — |
| 后台进程管理器 | `src/main/lib/backgroundProcessManager/` | 异步后台进程执行，环形缓冲区输出 | [ai.prompt.md](../src/main/lib/backgroundProcessManager/ai.prompt.md) |
| 运行时管理器 | `src/main/lib/runtime/` | 内嵌 bun + uv，Python shim，内部/外部模式 | — |
| 上下文压缩 | `src/main/lib/compression/` | 基于 LLM 的压缩，截断兜底 | — |
| 日志系统 | `src/main/log/`、`src/shared/log/` | pino + worker_thread 异步 sqlite 落盘，DB 位于 `{userData}/logs/{dev,app}.db`；renderer 通过 `log:write` IPC 转发，main 端覆写 renderer 的进程类型与 webContents ID。 | — |
| 安全 | `src/main/lib/security/` | 路径遍历防护、工作区限制、CommandParser | — |
| Token 计数 | `src/main/lib/token/` | js-tiktoken，视觉 tiling，LRU 缓存；驱动压缩门控 | — |
| 快速启动缓存 | `src/main/lib/cache/` | CDN agent 卡片图片离线缓存 | — |
| 取消令牌 | `src/main/lib/cancellation/` | 通过聊天 + 工具链的协作式取消 | — |
| 共享类型/工具 | `src/main/lib/types/`，`lib/utilities/`，`lib/utils/` | 跨模块类型、错误类、Sharp 辅助函数、CDN 缓存清除 | — |
| 评估框架 | `src/main/lib/evalHarness/` | AgenticEval HTTP 服务器；`--eval-mode` 无头 Agent 执行 | [ai.prompt.md](../src/main/lib/evalHarness/ai.prompt.md) |
| 崩溃捕获 | `src/main/lib/crash/` | 崩溃包、运行标记、面包屑、最近日志/dump | [crash-bundle.md](../docs/crash-bundle.md) |
| 调度器 | `src/main/lib/scheduler/` | 每个 runtime Profile 一个 `SchedulerManager`；Cron 和一次性任务独立登记，cold-start catch-up 经 `persist/schedulerState.ts` 接通；manager 统一跟踪、取消并等待 in-flight `JobRun` 后再允许 ProfileStore 关闭；完成通知与点击导航只选址 owning Profile 窗口 | [ai.prompt.md](../src/main/lib/scheduler/ai.prompt.md) |
| Research window | `src/main/lib/research/` | `web research` 的 human-in-the-loop 网页研究：lazy-open + 串行单飞的 research `BrowserWindow` + 外部网页 `WebContentsView`（沙箱隔离）+ live DOM 抽取用户确认的来源 | [ai.prompt.md](../src/main/lib/research/ai.prompt.md) |
| 网页内容提取 | `src/main/lib/research/extract/` | 共享「网页 → Markdown」提取链：Readability + turndown 注入产物（独立 IIFE 子构建），`web research` live view 与 `web fetch` headless 渲染共用 | [ai.prompt.md](../src/main/lib/research/extract/ai.prompt.md) |

---

## 4. 功能 → 模块映射（主进程）

仅在关键词不能直接映射到 §3 中模块名称时使用此表。

| 任务关键词 | 模块 | 路径 |
|---|---|---|
| OAuth、登录、token | Chat 引擎（pi） | `src/main/pi/auth.ts` |
| agent 循环、会话 | Chat 引擎（pi） | `src/main/pi/` |
| MCP 协议、外部 server | MCP 运行时 | `src/main/lib/mcpRuntime/` |
| 本地工具、deskmate-native 工具、`app` 伪 shell | 本地工具 | `src/main/pi/tools/` + `src/main/pi/appcmd/` |
| profile、session、数据持久化 | 持久化（persist） | `src/main/persist/` + `src/shared/persist/` |
| 委派、subrun、并行任务 | Agent 委派运行时 | `src/main/pi/subagent/` |
| 模型、provider | Chat 引擎（pi） | `src/main/pi/model.ts` |
| 文件树、ripgrep | 工作区 | `src/main/lib/workspace/` |
| .skill 归档 | Skills | `src/main/lib/skill/` |
| shell、命令执行 | 终端管理器 | `src/main/lib/terminal/` |
| 异步执行 | 后台进程管理器 | `src/main/lib/backgroundProcessManager/` |
| bun、uv、Python | 运行时管理器 | `src/main/lib/runtime/` |
| 上下文窗口 | 上下文压缩 | `src/main/lib/compression/` |
| 日志文件 | 日志系统 | `src/main/log/` |
| 路径遍历 | 安全 | `src/main/lib/security/` |
| token 计数、上下文大小 | Token 计数 | `src/main/lib/token/` |
| 自动更新 | 自动更新 | `src/main/lib/autoUpdate/` |
| cron、定时任务 | 调度器 | `src/main/lib/scheduler/` |
| AgenticEval、无头 | 评估框架 | `src/main/lib/evalHarness/` |
| 交互式网页搜索、research window、web research | Research window | `src/main/lib/research/` |

---

## 5. 关键依赖（主进程）

| 类别 | 库 |
|---|---|
| 核心 | Electron 41.x，TypeScript 5.x |
| AI/LLM | Vercel AI SDK 5.x，`openai`，`@ai-sdk/openai-compatible`，`@google/generative-ai`，`cohere-ai`，`ollama` |
| MCP | `@modelcontextprotocol/sdk` ^1.26.0 |
| 数据库 | `better-sqlite3`，`sqlite-vec`，`neo4j-driver` |
| 原生 | `sharp`，`@vscode/ripgrep`，`playwright-core` |
| Token | `js-tiktoken`（`cl100k_base` / `o200k_base`） |
| 校验 | `zod` |

---

## 6. 数据存储布局

`~/.deskmate/` 顶层地图。`profiles/` 子树的完整 schema（profile / agent / session / schedule 的目录结构、已消失的旧文件/类型）是 persist 层的**权威来源**，见 [persist.md §3 磁盘布局](persist.md)；此处只塌成一行、不重画。`env/` 运行时地盘是本文档的地界（persist 明确不管运行时产物）。

```
~/.deskmate/
├── app.json, device-id, state/, cache/             # 顶层应用数据
├── profiles/                                        # 用户态数据全集 —— 完整 schema 详见 persist.md §3
│   └── p_{ulid}/                                    #   settings/auth/index.db/agents/{sessions,schedules}/skills/mcp/models/archive
├── env/                                             # 运行时地盘（bun/uv/Python 装机产物，删了能整个重装）
│   ├── bin/                                         # 真 bun/uv/uvx + python/uvx/bunx shim
│   │   └── node-shims/                             # node/npm/npx shim（仅 MCP 前插；shell 走系统）
│   ├── python-venv/                                # 共享 venv（VIRTUAL_ENV 指向）
│   ├── uv-cache/  uv-tools/  python/  bun/         # uv/bun 缓存 + 全局包 + uv 装的 Python
│   └── runtime-bin/                                # 全局 CLI 入口（bun add -g / uvx 装的工具）
├── logs/{dev,app}.db                               # pino + sqlite
└── installation-device-id
```

「Chat → Agent 一等公民」重构要点（`p_{ulid}` + `kind: guest|signed_in`、Agent 取代 Chat、`AGENT.md` 配置载体、ULID vs UUIDv7、schedule run 物理隔离、`profile.json` 取消）及所有已消失的旧文件/类型，见 [persist.md §2 核心范式](persist.md) 与 [§3 已消失的文件 / 类型](persist.md) —— 不在此重复。

---

## 7. 构建系统概览

**Webpack — 主进程**（target `electron-main`）：2 个入口（bootstrap/main）+ 3 个 preload bundle（main/screenshot/log-viewer；research window 复用 main preload）；原生模块外部化；保留 `__dirname`。

**品牌配置：** 应用配置（app ID、产品名、userData 文件夹等）由 `brands/deskmate/config.json` 提供，构建脚本和源码均直接 `require`/`import` 该 JSON。

**Electron Builder**：GitHub Releases（`gim-home/Deskmate`）；asar 解包：ripgrep，sqlite-vec，playwright-core。Windows：NSIS+ZIP；macOS：DMG+ZIP（公证）；Linux：AppImage。

**打包陷阱：** electron-builder 只打包 `dependencies` 和 `optionalDependencies` — **不**打包 `devDependencies`。将 `playwright` 移到 devDependencies（commit `7ea925e`）会静默破坏生产环境中的所有浏览器自动化。验证方法：`npx asar list <app.asar> | grep <module>`。

| 类别 | 会被打包？ | 用途 |
|---|---|---|
| `dependencies` | 是 | 主进程运行时库（playwright-core，sharp，better-sqlite3） |
| `devDependencies` | 否 | 构建工具、测试框架、仅供 renderer 打包的模块 |

---

## 8. 关键技术决策（主进程）

**所有权模式**：遗留应用级管理器可使用 `private static instance` + getter；`ProfileRegistry` 使用模块闭包并同时拥有 profile index 与 runtime Profile，Profile-bound 服务由 runtime `Profile` 直接持有。`DoctorManager`、`MCPClientManager`、`SchedulerManager` 均按 Profile 实例化；`SubAgentManager` 由 `Profile.getSubAgentManager()` 直接构造并缓存，不使用静态 WeakMap；新服务应按资源的实际生命周期选择所有权，而非默认单例。

**非致命错误策略**：每个子系统都用 try/catch 包裹并记录日志。一个失败的组件永远不会崩溃整个应用 — 对于 feature flags、原生模块尤其重要。

**启动性能**：`bootstrap.ts` 最先执行（在任何 import 之前）；`main.ts` 使用懒 getter（import 时零初始化）；重量级模块仅作为 `import type`；开发模式下 `dotenv`/`electron-reload` 通过 `setImmediate` 加载；`screenshot://` 在 `app.ready` 之前注册。

**多主窗口纪律**：`main.ts` 对同一 Profile 的主窗口创建实行 single-flight；`startup/wins.ts` 仅在关闭的窗口仍是该 Profile 当前 map entry 时移除注册。来自 UI 的窗口操作（缩放、菜单导航）必须按 IPC sender 或 Electron 菜单提供的 target window 选址，不得复用“最近创建的主窗口”。应用退出仅由 `ElectronApp` 的唯一 `before-quit` handler 编排 Profile 停止、persist/SQLite close 与 logger close。
