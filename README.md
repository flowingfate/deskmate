# Deskmate AI Studio

> 本项目最初 fork 自 [Open-Kosmos](https://github.com/microsoft/open-kosmos)，但目前仅有很小一部分代码复用

> ⚠️ **早期开发阶段警告**
>
> 当前应用仍处于**最早期开发阶段**，整体架构与数据结构尚不稳定。短期内会出现**破坏性更新**，包括但不限于：**不兼容历史数据格式**、需要**清理本地数据**或**重置配置**才能继续使用。请勿在生产环境依赖本应用，亦不要在其中保存重要且无备份的数据。

Deskmate AI Studio 是一款基于 Electron 的桌面 AI 助手。它让用户创建、配置并与可定制的 AI Agent 对话，Agent 可通过 Model Context Protocol（MCP）调用外部工具，使用本地工具与 `app` 伪 shell 操作文件系统、终端、浏览器，按 cron / 一次性计划运行任务，并能 spawn 子 Agent 执行有界并行工作。

> **代码权威文档在 [`ai.prompt/`](ai.prompt/) 与各模块目录下的 `ai.prompt.md`。** 本 README 只面向"快速上手 + 概览"，深入信息以 `ai.prompt/` 为准。

---

## 目录

- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [常用命令](#常用命令)
- [架构概览](#架构概览)
- [构建与发布](#构建与发布)
- [Self-hosting / Forking](#self-hosting--forking)
- [Eval Mode（无头）](#eval-mode无头)
- [Feature Flags](#feature-flags)
- [数据存储位置](#数据存储位置)
- [故障排除](#故障排除)
- [开发协作](#开发协作)
- [许可与联系方式](#许可与联系方式)

---

## 技术栈

| 类别 | 选型 |
|------|------|
| 桌面运行时 | Electron 41（ABI 145） |
| 主进程语言 | TypeScript 6.x，Node ≥ 22 |
| 渲染层 | React 18，React Router，TailwindCSS 4，Radix UI，lucide-react |
| 构建工具 | electron-vite 6（Vite 8 + esbuild + rollup），electron-builder 配套打包 |
| Chat 引擎 | `@earendil-works/pi-ai`（多 provider orchestrator） |
| 工具协议 | `@modelcontextprotocol/sdk` ≥ 1.26（external MCP），`pi/tools/` 本地工具，`pi/appcmd/` 伪 shell |
| 持久化 | 本地文件 + JSON / JSONL / `AGENT.md` 前置内容；`better-sqlite3` 12.x 做派生索引与日志 |
| 日志 | pino + worker_thread sqlite transport，跨 main / renderer / worker 同库 |
| 原生 / 功能 | `sharp`、`@vscode/ripgrep`、`playwright-core`、`node-screenshots` |
| 安全/校验 | `zod`，`SecurityValidator`（路径遍历防护、工作区限制、CommandParser） |
| 测试 | `vitest`（在 Electron Node 内运行），`playwright`（E2E） |

完整依赖清单见 [`package.json`](package.json)。

---

## 快速开始

### 前置依赖

- **Node.js** ≥ 22
- **npm**
- **平台编译工具**（用于构建原生模块；首次安装时 `postinstall` 会调 `node scripts/rebuild-native.js`）：
  - macOS：`xcode-select --install`
  - Windows：Visual Studio Build Tools + "Desktop development with C++"
  - Linux：`build-essential`
- **可选 — Python 3.10+**：仅当你打算连接基于 Python 的 MCP 服务器时需要

### 安装与启动

```bash
git clone https://github.com/flowingfate/deskmate.git
cd deskmate
npm install   # postinstall 会自动 rebuild 原生模块、安装 ai 文档

# 开发模式（推荐，HMR + main/preload watch）
npm run dev

# 或：构建一次后直接跑（无 HMR）
npm run start
```

> 默认不需要 `.env` 文件 —— 所有构建期常量已经硬编码在 `src/shared/constants/` 和 `brands/deskmate/config.json`。
> 仅当你需要注入运行时密钥（如 Eval Mode 的 `EVAL_AUTH_TOKEN`）时，才从 `.env.example` 复制出 `.env.local`。

---

## 项目结构

```
deskmate/
├── ai.prompt/                       架构文档（AI 协作必读）
├── brands/deskmate/                 品牌配置（appId、产品名、userData 路径）
├── electron.vite.config.ts          electron-vite 三段构建配置
├── electron-builder.config.js       electron-builder 基础配置
├── scripts/                         构建、打包、原生模块、日志分析脚本
│   └── vite/                        electron-vite 自定义插件 + pack.ts 打包编排
├── src/
│   ├── main/                        主进程（Node.js）
│   │   ├── bootstrap.ts             先于任何 import 设置品牌 userData 路径
│   │   ├── main.ts                  懒 getter 的服务注册入口
│   │   ├── pi/                      Chat 引擎（pi-ai 封装）+ 本地工具 + appcmd
│   │   ├── persist/                 ~/.deskmate/ 持久化层 + 12 条 IPC 通道
│   │   ├── startup/                 启动流水 + IPC handlers
│   │   ├── log/                     pino + sqlite worker
│   │   └── lib/                     mcpRuntime、scheduler、subAgent、autoUpdate、
│   │                                evalHarness、screenshot、token、
│   │                                workspace、microsoftGraph、remoteChannel ...
│   ├── preload/                     主窗口 / screenshot / log-viewer 各自独立 preload
│   ├── renderer/                    React SPA（2 个 BrowserWindow 共享代码池）
│   │   ├── components/              chat / layout / settings / mcp / subAgents / skills ...
│   │   ├── states/, atom/           应用级 atom 状态库
│   │   ├── lib/                     audio / mcp / userData / featureFlags / scheduler ...
│   │   ├── ipc/                     每个子系统的渲染器 IPC 客户端
│   │   └── log/, log-viewer/        渲染器日志入口 + dev-only Log Viewer 窗口
│   └── shared/                      跨进程类型 + IPC 契约（src/shared/ipc/）
└── tests/e2e/                       Playwright E2E 套件
```

详细模块表见 [`ai.prompt/arch-main.md`](ai.prompt/arch-main.md) 与 [`ai.prompt/arch-render.md`](ai.prompt/arch-render.md)。

---

## 常用命令

完整脚本以 [`package.json`](package.json) 为准；下表只列日常用到的。

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式（main + preload + renderer watch + electron） |
| `npm run build` | electron-vite 构建到 `out/` |
| `npm run start` | 构建后启动（无 HMR） |
| `npm run electron` | 直接启动现有 `out/` 产物（需先构建过） |
| `npm run pack` | 本地试包（`--dir`，不签名，跳过 vite build） |
| `npm run dist` | 当前平台正式打包 |
| `npm run dist:mac:arm64` | 打 macOS arm64（DMG + ZIP） |
| `npm run dist:win:x64` | 打 Windows x64（NSIS + ZIP） |
| `npm run dist:publish` | 构建并发布到 GitHub Releases |
| `npm test` | vitest 单测（在 Electron Node 中运行，匹配 `better-sqlite3` ABI） |
| `npm run test:e2e` | Playwright E2E（自动先 `npm run build`） |
| `npm run typecheck` | tsc 全量类型检查 + mixed-import 守卫 |
| `npm run check:impact -- <file...>` | 列出协变模块、提示需要同步阅读的 `ai.prompt.md` |
| `npm run rebuild` | 手动 rebuild 原生模块 |

> **vitest 必须通过 Electron 的 Node 运行**（`ELECTRON_RUN_AS_NODE=1`），以匹配 `better-sqlite3` 的 NODE_MODULE_VERSION。
> 切勿把脚本改回直接 `vitest run`，否则全部用例会因 ABI 不一致失败。

---

## 架构概览

主进程 + 预加载 + 渲染器三层，IPC 全部走 `src/shared/ipc/` 中的类型化契约：

- **主进程（`src/main/`）** — 系统操作、认证、Chat orchestrator（`pi/`）、MCP 运行时、持久化、调度器、子 Agent。
- **预加载（`src/preload/`）** — 每个窗口一份脚本，通过 `contextBridge` 暴露白名单 IPC，编译期由 `connectRenderToMain` / `connectMainToRender` 工厂校验。
- **渲染器（`src/renderer/`）** — 两个独立 `BrowserWindow`：主窗口、截图；dev 还有 Log Viewer。React 18 + atom 状态库。

关键链路文档：

| 主题 | 文档 |
|------|------|
| 主进程总览 | [`ai.prompt/arch-main.md`](ai.prompt/arch-main.md) |
| 渲染进程总览 | [`ai.prompt/arch-render.md`](ai.prompt/arch-render.md) |
| Chat / Agent loop | [`ai.prompt/agent-loop.md`](ai.prompt/agent-loop.md) |
| 工具系统（local / MCP / appcmd 伪 shell） | [`ai.prompt/tool-system.md`](ai.prompt/tool-system.md) |
| 持久化布局 + IPC 通道 | [`ai.prompt/persist.md`](ai.prompt/persist.md) |
| 数据流（IPC、聊天、流式渲染、子 Agent） | [`ai.prompt/data-flow.md`](ai.prompt/data-flow.md) |
| 构建系统 | [`ai.prompt/compile-system.md`](ai.prompt/compile-system.md) |
| 测试 / 发布 / 依赖管理 | [`ai.prompt/workflows.md`](ai.prompt/workflows.md) |
| 日志分析 | [`ai.prompt/log-analysis.md`](ai.prompt/log-analysis.md) |

---

## 构建与发布

构建走 **two-package.json 模式**（详见 [`compile-system.md`](ai.prompt/compile-system.md)）：

1. `electron-vite build` → 输出到 `out/`
2. `scripts/vite/pack.ts` 创建 staging 目录 `vite-pack/`、复制 `out/` + `resources/`
3. 生成只含 `dependencies` 的 `vite-pack/package.json`，跑 `npm install --omit=dev`
4. 调 `electron-builder` 出包（自动加载 `electron-builder.config.js`，其中 `directories.app = 'vite-pack'`）

> **依赖分类很重要**：electron-builder **只**打包 `dependencies` 和 `optionalDependencies`，`devDependencies` 会被静默排除。
> 主进程运行时用到的库（如 `playwright-core`、`sharp`、`better-sqlite3`）必须放 `dependencies`。
> 调整后用 `npx asar list <app.asar> | grep <module>` 验证。

发布平台目标：

| 平台 | 目标格式 | 说明 |
|------|----------|------|
| macOS | DMG + ZIP | hardened runtime + notarization（`scripts/notarize.js`） |
| Windows | NSIS + ZIP | x64 / arm64 |

`scripts/vite/pack.ts` 把 `--mac` / `--win` / `--arm64` / `--x64` / `--publish=<mode>` 等 electron-builder 标志原样透传，所以 package.json 里只列了高频组合，其它用直接调用即可：

```bash
bun scripts/vite/pack.ts --mac --x64
bun scripts/vite/pack.ts --win --arm64
bun scripts/vite/pack.ts --linux
```

## Self-hosting / Forking

本项目当前打包/发布配置面向**官方 Deskmate 渠道**。如果你 fork 后想自己分发或独立运行，下面这些位置写死了"deskmate.top / flowingfate" 个人化标识，需要按需替换。**只读、只跑、只改非分发场景的 fork 用户可以全部忽略**——即使不动这些 URL，应用本体仍能正常工作（auto-update / relay 会静默退出，不会报错）。

| 文件 | 写死的内容 | 替换建议 |
|---|---|---|
| [`src/shared/constants/endpoints.ts`](src/shared/constants/endpoints.ts) | `cdn.deskmate.top` / `relay.deskmate.top` 域名 | 自建 CDN 与 relay 后端 → 改成自己的域名；不需要这两个能力则保持原值，调用失败会被忽略 |
| [`electron-builder.config.js`](electron-builder.config.js) `publish.{owner,repo}` | `flowingfate` / `deskmate` GitHub 仓库 | 改成你的 fork 仓库 owner/repo（否则 `npm run dist:publish` 会推到上游仓库失败） |
| [`brands/deskmate/config.json`](brands/deskmate/config.json) | `appId`、`productName`、`homepage`、`updateChannel` 等品牌字段 | 创建自己的 `brands/<your-brand>/` 后修改打包脚本指向；或就地改这几个字段 |
| [`README.md`](README.md) `git clone` 链接 | `https://github.com/flowingfate/deskmate.git` | 改成你的 fork URL |

### Auto-update / Release 流程

- **不打算自己发版**：什么都不需要做。`npm run dev` / `npm run build` 不依赖 `publish` 配置。
- **想推到自己的 GitHub Releases**：在 `electron-builder.config.js` 的 `publish` 段改 `owner` / `repo`，配好 `GH_TOKEN` 环境变量，再跑 `npm run dist:publish`。
- **想完全替换 CDN/relay 后端**：修改 `endpoints.ts` 里的 URL；relay 协议契约见 [`src/main/lib/remoteChannel/`](src/main/lib/remoteChannel)。

### Python Runtime

v0.1.0 起仓库不再随源码携带 cpython tarball（之前 ~50 MB 二进制塞在 `resources/python/`）。第一次有 MCP 服务器需要 Python 时，[`LocalPythonMirror`](src/main/lib/runtime/LocalPythonMirror.ts) 会把 uv 的下载请求 302 重定向到 [`astral-sh/python-build-standalone`](https://github.com/astral-sh/python-build-standalone/releases) 的 GitHub Releases，**首次安装需要联网**。如需离线/批量分发，可在 `resources/python/<TAG>/<filename>` 里手动放置同名 tarball，mirror 会优先 stream 本地文件。

---

## Feature Flags

Feature flag 系统位于 `src/main/lib/featureFlags/`，控制实验性 / 渐进式上线的功能。

### 关键属性

| 属性 | 用途 |
|------|------|
| `devOnly` | `true` 时仅开发模式可启用；生产环境恒为 `false`，与其它配置无关 |
| `defaultValue` | 业务默认值，可以是布尔字面量，也可以是 `(ctx) => boolean` 函数 |

`ctx` 提供：`isDev` / `brandName` / `platform`（`'win32' | 'darwin' | 'linux'`）/ `arch`（`'x64' | 'arm64'`）。

### 新增 flag

1. 在 `src/shared/types/featureFlagTypes.ts` 的 `FeatureFlagName` 联合中添加名字（约定 `deskmateFeature` 前缀 + PascalCase）。
2. 在 `src/main/lib/featureFlags/featureFlagDefinitions.ts` 注册定义。
3. 主进程通过 `featureFlagManager.isEnabled('...')` 读；渲染器通过 `useFeatureFlag('...')` hook 读。

dev 模式下可用 CLI 临时打开：`--enable-features=deskmateFeatureXxx,deskmateFeatureYyy` 或 `--disable-features=...`。

---

## 数据存储位置

所有用户态数据放在 `~/.deskmate/`（被 `bootstrap.ts` 强制覆盖，不再使用 Electron 默认 userData）：

```
~/.deskmate/
├── app.json, device-id, state/, cache/
├── profiles/
│   ├── profiles.json                       索引 + activeProfileId
│   └── p_{ulid}/                           profile 用 ULID 主键，alias 仅展示
│       ├── settings.json                   
│       ├── auth.json, auth.pi.json         未登录态不存在
│       ├── index.db                        SQLite 派生索引
│       └── agents/
│           └── a_{ulid}/
│               ├── AGENT.md                front-matter + body 即 system prompt
│               ├── knowledge/              agent 级共享资料
│               ├── sessions/{YYYYMM}/{s_ulid}/
│               │   ├── data.json           源真值（含 contextState 压缩栈）
│               │   ├── messages.jsonl      append-only
│               │   └── files/              session 私有 sandbox
│               └── schedules/              cron / 一次性任务
├── bin/                                    内嵌 bun + uv shim
└── logs/{dev,app}.db                       pino + sqlite 日志
```

完整 schema、迁移路径、12 条细粒度 `persist:*` IPC 通道见 [`ai.prompt/persist.md`](ai.prompt/persist.md)。

---

## 故障排除

### `better-sqlite3` 在 vitest 失败

测试必须用 `npm test` 跑（脚本里有 `ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs`），直接 `vitest run` 会因 NODE_MODULE_VERSION 不匹配全部失败。

### 日志分析

排查问题时优先用项目日志框架，而不是临时 `console.log`：

```bash
bun scripts/log.ts schema             # 看 schema
bun scripts/log.ts query --since 10m --level warn+
bun scripts/log.ts top-errors --since 1h
bun scripts/log.ts trace <traceId>
```

dev 模式下也可以从应用菜单 `Develop → Open Log Viewer` 打开（`Cmd/Ctrl+Alt+L`）。详见 [`ai.prompt/log-analysis.md`](ai.prompt/log-analysis.md)。

### 路径相关 bug

应用 userData 不在 Electron 默认目录，而是 `~/.deskmate/`。手工干预 profile / agent / session 时务必动这里。

---

## 开发协作

### Git 约定

- **分支**：`user/<alias>/<feature-name>`（如 `user/alice/add-tool-execution-logs`）
- **提交**：conventional commits（`feat`/`fix`/`docs`/`style`/`refactor`/`test`/`chore`）；`type(scope)` 部分英文，描述可用中文
- **PR 标题**：中文，≤ 70 字符；细节放正文

### AI 协作约定

- 项目用 `ai.prompt.md` 作为 AI 协作的"局部记忆"，每个关键模块下都有一份。修改代码后请同步更新对应文档与 `<!-- Last verified: YYYY-MM-DD -->`。
- 修改前先跑 `npm run check:impact -- <files>` 看协变映射。
- 详细 AI 协作守则在 [`CLAUDE.md`](CLAUDE.md)。

### 验证清单（提交前）

1. `npm run typecheck`
2. `npm test`（仅在改动了带 `__tests__/` 的模块时必需，但任务接近尾声跑一次更稳）
3. `npm run build`

> 这些命令对机器有压力，**不要频繁跑**；通常只在任务收尾时跑一次。

---

## 许可与联系方式

- **License**：本项目以 [Apache License 2.0](LICENSE) 开源，第三方组件归属见 [NOTICE](NOTICE)。
- **贡献**：欢迎 PR。提交前请阅读并签署 [CLA](CLA.md) —— 这是为了让项目未来可以平滑改 license / 双授权而保留的法律基础。
- **作者**：flowingfate
- **主页**：https://deskmate.top

> **免责声明**：本项目与 GitHub、VS Code 无任何官方关联。使用 GitHub Copilot 后端须遵守 [GitHub Copilot 服务条款](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot)。
