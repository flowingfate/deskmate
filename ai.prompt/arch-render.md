<!-- Last verified: 2026-07-17 (Step 12：subagent run transcript Dialog 已接入) -->
# DESKMATE AI Studio — 渲染进程架构

关注 `src/renderer/` 和共享 IPC 框架 `src/shared/ipc/`。主进程架构见 [arch-main.md](arch-main.md)。

---

## 1. 三个窗口，四个入口

渲染进程支撑**三个生产 Electron `BrowserWindow`**，每个都有自己的 Vite 入口、HTML 文件和 React 树。它们共享 `src/renderer/` 作为代码池，但挂载完全独立的组件树。另有 dev-only Log Viewer 入口。

| # | 窗口 | 入口 / HTML | 专属代码 | 说明 |
|---|------|-------------|----------|------|
| 1 | **主窗口** | `index.tsx` / `index.html` | `src/renderer/` 的大部分 | 主要 UI。挂载 `<App />` → provider 栈 → `HashRouter`。几乎所有功能都在这里。 |
| 2 | **截图** | `screenshot.tsx` / `screenshot.html` | `src/renderer/screenshot/`（`constant.ts`、`core/`、`index.tsx`） | 裁剪 + 标注 UI。自包含；不导入主窗口组件树。 |
| 3 | **研究窗口** | `research.tsx` / `research.html` | `src/renderer/research.tsx` | `web research` 的 tab strip 和来源侧栏；外部网页由主进程多个 `WebContentsView` 覆盖在浏览区，搜索与导航使用网页自身 UI。 |

截图和研究入口都通过 `createRoot` 渲染单个根节点，完全绕过 `<App />` 和主窗口路由。

**dev-only 第 4 个窗口：Log Viewer**。`log-viewer.tsx` / `log-viewer.html`（菜单 `Develop → Open Log Viewer`，`Cmd/Ctrl+Alt+L`）。独立 preload `src/preload/log-viewer.ts` 只暴露 `logViewer` 命名空间（**不**暴露 `log.write`，防止 viewer 自打日志成环）。代码在 `src/renderer/log-viewer/`。生产打包不注册 IPC handler、不显示菜单项。

---

## 2. 顶层布局

```
src/renderer/
├── index.tsx, index.html              # 主窗口
├── screenshot.tsx, screenshot.html, screenshot/   # 截图窗口
├── App.tsx                            # 主窗口 provider 栈 + 就绪门控
├── entries/                           # main.routes.tsx（路由表）+ App.tsx 等入口
├── components/                        # 按功能分组的 UI（chat/, layout/, settings/, ...）
├── atom/                              # 自定义 atom 状态库
├── states/                            # 顶层跨组件 atom
├── lib/                               # 渲染器端服务（audio, mcp, streaming, userData ...）
├── ipc/                               # 每个功能的渲染器 IPC 客户端
├── types/                             # 共享 TS 类型 + global.d.ts
├── config/, assets/, styles/
└── __tests__/
```

---

## 3. 进程边界与 IPC

渲染器是沙箱化的（`web` target，无 Node 集成）。任何特权操作 — 文件 I/O、子进程、原生模块、OS API — 都通过预加载 + 类型化 IPC 通道进行。

| 接口 | 方向 | 定义位置 |
|------|------|----------|
| `window.electronAPI.*` | renderer → main（请求/响应 + 订阅） | `src/preload/main.ts`，契约在 `src/shared/ipc/*.ts` |
| `connectRenderToMain` / `connectMainToRender` | 类型化通道工厂 | `src/shared/ipc/base.ts`（见 [ai.prompt.md](../src/shared/ipc/ai.prompt.md)） |
| `src/renderer/ipc/*.ts` | 功能特定的客户端封装 | 每个子系统一个文件（scheduler、screenshot、teams 等） |
| `window` DOM 事件（`navigate:to`、`debugWindowReady` 等） | main → renderer 广播 | preload 将主进程事件桥接到 `window.dispatchEvent`。**老的 `tokenMonitor:*` / `auth:monitor` 事件**：main 端仍可能 dispatch（属老 GHC 子系统残留），但 renderer 已无 listener。 |

---

## 4. 主窗口引导（`App.tsx`）

1. **就绪门控** — 在 `electronAPI.isReady()` / `onAppReady` 之前阻塞 provider 栈。ProfileDataProvider 在主进程服务（profile 缓存、MCP 运行时）完成启动前不能触发 IPC，否则首次调用会与 bootstrap 竞争并产生虚假错误。
2. **Provider 栈**（外 → 内）：
   `ToastProvider → UpdateProvider → ProfileDataProvider → AppContent`
   - 老的 `AuthProvider` / `ReauthProvider` / `ReauthDialog` 已随 renderer 侧 GHC 登录子系统整体下架。后续重做登录时再恢复。
3. **AppContent** 挂载 `HashRouter`、`WindowsTitleBar`、`WindowZoomHotkeys`、`McpAuthConsentDialog`、`RequestOAuthClientIdDialog`、`<AppRoutes />`。

MCP 连接失败 toast 在 `App` 层订阅，确保下方崩溃的面板无法丢弃它。

---

## 5. 路由（`entries/main.routes.tsx`）

`HashRouter`（Electron 通过 `file://` 加载，必须使用此路由器），配合 feature flag 门控路由。启动期无强制登录漏斗：根路径直接进入 `/agent`（基于当前 active profile，guest 也能正常工作）。运行时若 chat 调用所需 provider 凭证缺失，由 `pi/model.ts` 抛运行时错误并由 UI 引导至 `Settings → Provider`。`/login` 暂为占位 UI（登录子系统待重做）。

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | — | `Navigate to="/agent"`（不再跳 `/login`） |
| `/login` | `SignInPage` | **占位 UI**（renderer 侧老 GHC 登录已下架，仅引导用户回到 `/agent` 或去 `Settings → Provider`）|
| `/agent[/:agentId[/:sessionId]]` | `ChatView` | 主聊天界面 |
| `/agent/:agentId/settings/*` | `AgentEditingView` | Agent 编辑器（基础 / 系统提示 / mcp / skills / …） |
| `/agent/creation/*` | agent-area | 自定义 agent 创建 + 库 |
| `/settings/*` | `SettingsPage` | mcp / runtime / skills / memory / sync / about / archived / remote-channel (FF) |

`AppRoutes` 还将主进程的 `navigate:to` 事件桥接到 React Router，并通过 `electronAPI.recordCrashBreadcrumb` 将每次 `route-change` 记录为崩溃面包屑。

---

## 6. 渲染器模块（有专属文档）

| 模块 | 路径 | 简介 | 文档 |
|------|------|------|------|
| Atom 状态库 | `src/renderer/atom/` | `atom()`（Value/Action/Computed）+ `<WithStore>` + `mutate`；基于 useSyncExternalStore，支持 `immer` | [ai.prompt.md](../src/renderer/atom/ai.prompt.md) |
| 聊天 UI | `src/renderer/components/chat/` | ChatView/ChatViewContent/ChatContainer/ChatRenderItem + message 子目录（MarkdownView/AssistantMessage/UserMessage/AttachmentList/CopyButton 等）+ ComposeInput/EditInlineInput + agent-editor（8 个 tab）+ toolCallViews + chat-input 子组件 + workspace | [ai.prompt.md](../src/renderer/components/chat/ai.prompt.md) |
| 布局 | `src/renderer/components/layout/` | AppShell（Sidebar + StatusBar + Titlebar）+ AgentLayoutContent（UI 外壳）+ ContentContainer、UserMenu、WindowsTitleBar、WindowZoomHotkeys | [ai.prompt.md](../src/renderer/components/layout/ai.prompt.md) |
| IPC 框架 | `src/shared/ipc/` | `connectRenderToMain` / `connectMainToRender` 类型化通道工厂，跨主进程 + 预加载 + 渲染器共享 | [ai.prompt.md](../src/shared/ipc/ai.prompt.md) |

## 7. 其他渲染器文件夹

| 文件夹 | 说明 |
|--------|------|
| `components/autoUpdate/` | `UpdateProvider` + 更新 toast |
| `components/common/` | 跨功能共享的可复用 widget |
| `components/agent-side/` | 中间列（左 nav 与 ChatView 之间）：`SessionPanel` orchestrator + sessions / jobs 双模式视图（含 jobs CRUD + runs 列表 + alarm 切换）。**URL 是模式与选中状态的唯一真相源**；详见 [ai.prompt.md](../src/renderer/components/agent-side/ai.prompt.md)。 |
| `components/fre/` | 首次运行体验流程 |
| `components/mcp/` | 服务器列表 / 添加 / 从其它 MCP 客户端（mcp.json / settings.json）导入 / 库 / 认证授权对话框 |
| `components/menu/` | 上下文菜单和菜单栏 |
| `components/pages/` | 顶层路由页面：Startup / SignIn（占位）/ DataLoading / Agent / Settings |
| `components/settings/` | 所有 `/settings/*` 面板（每个类别一个） |
| `components/skills/` | Skills 列表 + 库安装 |
| `components/ui/` | 设计系统基础组件（`ToastProvider` 在这里） |
| `shadcn/` | shadcn/ui 基础组件（Button / Dialog / Select 等 20 个，基于 Radix + CVA + Tailwind v4 `sc-*` 令牌，`cn` 来自 `lib/utilities/utils`）。供 app 与 stories 共用。 |
| `story/` | **Ladle** stories（`*.stories.tsx`，集中管理）：shadcn 基础组件与 `story/tools/` 的 chat tool 独立预览共用。tools stories 覆盖 AnimatedHeight、ToolChip、ToolDetailView、ToolCallsSection 和 app/shell/web/write/subagent renderer；Subagent stories逐项覆盖 custom chip 状态、pending/running、五种 formal terminal result、rejected、list/describe read-only、unknown fallback，以及可点击加载真实 mock user/assistant/tool transcript 的 Transcript Dialog。`story/tools/mockElectron.ts` 仅在 Story 内 mock Electron bridge，生产组件不感知。`npm run ladle`（dev server）/ `npm run ladle:build`（静态产物 → `out/ladle/`）。Ladle 配置在仓库根 `.ladle/`（`config.mjs` + 别名 `vite.config.ts` + `components.tsx` 注入全局样式并同步 `.dark` + `ladle.css` 复用 `globals.css` 主题）。为避开 Ladle 5.1.1 内置 TSX 声明与 TypeScript 7 的不兼容，renderer 类型检查将 `@ladle/react` 映射至 `story/ladle.d.ts` 的最小 `Story` 契约；stories 仅供开发预览，不被 app 入口导入、不进生产打包。
| `components/userData/` | `ProfileDataProvider` — 数据加载树的顶层 |
| `lib/chat/` | 聊天视图编排辅助函数（选择器、派生状态） |
| `lib/featureFlags/` | 通过主进程 flag 管理器的 `useFeatureFlag` hook |
| `lib/mcp/` | `useMcpConnectionFailureToast` + MCP 客户端辅助函数 |
| `lib/memory/` | 记忆查询 hooks |
| `lib/models/` | 模型列表 / 模型选择器辅助函数 |
| `lib/perf/` | `memoryOptimizer` |
| `lib/runtime/` | 运行时状态的渲染器视图（bun/uv 安装状态） |
| `lib/scheduler/` | 渲染器 scheduler 客户端 |
| `lib/screenshot/` | 渲染器端截图触发 |
| `lib/skills/` | Skill 列表 / 安装 hooks |
| `lib/startup/` | 启动验证客户端 |
| `lib/userData/` | `appDataManager`、`profileDataManager`、`useAppZoomLevel` |
| `lib/utilities/` | 杂项辅助函数（DOM / 字符串 / 颜色等） |
| `log/` | Renderer logger 入口（`log.info(...)`），按 level 早过滤后通过 `log:write` IPC 单向 send 到主进程落 sqlite；含 `installGlobalHandlers` 捕获全局异常。详见 [log-analysis.md](../ai.prompt/log-analysis.md) |
| `log-viewer/` | dev-only Log Viewer 窗口的 React 树（独立入口 `log-viewer.tsx` / `log-viewer.html`）：SideNav + Logs/Traces/占位 view + 详情抽屉；通过 `logViewer` IPC 命名空间向 main 拉数据 / 订阅 `appended` 实时增量 |
| `lib/workspace/` | 渲染器文件树客户端 |
| `ipc/` | 每个子系统一个文件：`scheduler`、`screenshot-main`、`screenshot-overlay`、`runtime`、`skill`、`subagentRun` 等 |
| `states/` | 应用级 atom（如 `left-nav.atom.ts`）。其他状态应放在消费组件旁边，命名为 `*.atom.ts`。见 §8。 |
| `types/` | `mcpTypes`、`profileTypes`、`startupValidationTypes`、`global.d.ts`（声明 `window.electronAPI`） |

---

## 8. 状态管理 ⚠️ 修改渲染器代码前必读

状态管理是渲染器可维护性的基础。严格遵守以下规则。

### 8.1 硬性限制：组件文件不得超过 500 行

**单个组件文件不得超过 500 行。** 过大的组件不可避免地积累大量局部 `useState`，而"分散的局部状态"正是长期维护痛点的根源：状态到处蔓延，依赖纠缠，跨组件复用变得不可能。

- 接近限制时，**必须**拆分为子组件、提取 hook，或将状态提升到 atom。
- 不要通过"再加一个 `useState`"来维持文件存活 — 那是在积累技术债务。

### 8.2 跨组件通信：先思考再选工具

选择能解决问题的最简方案。**只在真正需要时升级：**

1. **父子组件 → 使用 props。** 最简单、类型最好、最易调试。不要为了"一致性"而用 atom。
2. **跨组件/跨层共享 → 使用 atom。** 见 [atom 库指南](../src/renderer/atom/ai.prompt.md)。
3. **真正"环境"语义（Auth、Profile、Toast、Update）→ React Context。** 使用现有的 Provider；不要新增。

### 8.3 Atom 命名和放置

- **命名约定：** 每个 atom 文件以 `*.atom.ts` 结尾，方便在代码库中 grep。
- **应用级状态：** 放在 `src/renderer/states/`，如 `src/renderer/states/left-nav.atom.ts`。
- **局部共享状态：** 放在使用它的组件旁边 — **就近原则**。示例：仅在 chat-input 内部共享的菜单状态放在 `src/renderer/components/chat/chat-input/context-menu.atom.ts`。
- **嵌套对象更新：** 使用 `immer`（已是依赖，无需添加）。

### 8.4 反模式

- ❌ 单一全局 `store/` 目录存放所有 atom。
- ❌ 在父子组件之间强用 atom 而不是 props。
- ❌ Atom 文件不命名为 `*.atom.ts` — 藏在 `utils.ts` / `state.ts` / `context.ts` 中。
- ❌ 组件文件已超过 500 行还继续添加 `useState`。

### 8.5 Agent：hot record / cold detail 两层 atom（2026-06-06）

`agents.atom`（`AgentRecord`）与 `agentDetail.atom`（`AgentDetail`）是按"启动成本 vs 字段使用频率"刻意拆开的：

- **`agents.atom`** —— hydrate 时一次性拉满（`getSnapshot` 返回 `AgentRecord[]`，main 端**不**读 AGENT.md）。包含 `id / name / description / version / model / emoji / avatar / createdAt / updatedAt`。description 供 delegation picker 批量展示，不能为此 fan-out 读 detail。
- **`agentDetail.atom`** —— 按 agentId 懒读（`persistApi.getAgentDetail(id)` 触发 main 端单文件 read AGENT.md）。包含 `systemPrompt / thinkingLevel / tools / mcpServers / skills / delegates / zero`。agent editor 与单 Agent 配置读取使用。
- `agent:updated` IPC 事件 payload 含 `{ record, detail }`：main 端写完 `AGENT.md` 后同时下推两层，省 renderer 一次回查；agentDetail.atom 只对已订阅过的 entry 更新（没人订阅就不预热）。

**写代码时选 atom 的判据**：

1. 只渲染 name / emoji / model / description 等 hot 字段 → `useAgentById(id)` / `useAgents()`（拿 record）。
2. 渲染 systemPrompt / mcp / skills / delegates 等 cold 字段 → `useAgentDetail(id)`；detail 还没到位时 hook 返 `null`，组件用骨架/默认值兜底。
3. 非 React 路径（event handler、module-level helper）→ `await persistApi.getAgentDetail(id)` 直接走 IPC；或先 `ensureAgentDetail(id)` 预热，再用 `getAgentDetailSync(id)` 读缓存。

**反模式**：
- ❌ 把 cold 字段放进 `AgentRecord`（哪怕"只为 sidebar 多展示一个 badge"）—— 每加一个 cold 字段都让启动期 N 个 AGENT.md 读复活。
- ❌ 在 useAgentDetail 还在 loading 时强行 hold 整个 UI（导致路由白屏 100ms+）—— 用骨架/默认值。
- ❌ 在 React loop / map 里调 `useAgentDetail` —— hook 规则不允许；批量场景走 `await Promise.all(ids.map(persistApi.getAgentDetail))` + `useState`。

设计动机详见 [`REFACTOR-LAZY-AGENT.md`](../REFACTOR-LAZY-AGENT.md)；契约见 [`ai.prompt/persist.md §7`](persist.md)（Hot / Cold 两层视图） + [`src/main/persist/ai.prompt.md` 同步契约节](../src/main/persist/ai.prompt.md#agentrecord--agentmd-同步契约2026-06-06)。

---

## 9. 功能 → 模块映射（渲染器）

| 任务关键词 | 模块 | 路径 |
|---|---|---|
| 聊天 UI、消息渲染、流式文本 | 聊天 UI | `src/renderer/components/chat/`（MarkdownView 唯一 markdown 渲染器；流式靠 ChatContainer 内容驱动 effect 跟随，已无独立 streaming lib） |
| agent 编辑器（description、delegation、系统提示、MCP、skills） | 聊天 UI → agent-editor | `src/renderer/components/chat/agent-editor/` + `agent-area/` |
| 侧边栏、导航、标题栏、窗口缩放 | 布局 | `src/renderer/components/layout/` |
| 设置面板（任意 `/settings/*`） | 设置 | `src/renderer/components/settings/` |
| GitHub Copilot 登录（占位 UI；登录子系统待重做）| SignInPage | `src/renderer/pages/SignInPage.tsx`（renderer 侧老 GHC 登录与 ReauthDialog 已下架） |
| profile 加载、应用数据加载 | Userdata | `src/renderer/components/userData/`，`lib/userData/` |
| MCP UI（服务器列表、添加、库） | MCP UI | `src/renderer/components/mcp/`，`lib/mcp/` |
| skills UI | Skills UI | `src/renderer/components/skills/`，`lib/skills/` |
| UI 中的 feature flag 检查 | featureFlags hook | `src/renderer/lib/featureFlags/` |
| 路由 / 导航 | 路由 | `src/renderer/routes/AppRoutes.tsx` |
| 状态管理、atom | Atom | `src/renderer/atom/` |
| 截图窗口（裁剪、标注 UI） | 截图入口 + 文件夹 | `src/renderer/screenshot.tsx`，`src/renderer/screenshot/` |
| IPC 通道类型 / 契约 | IPC 框架 | `src/shared/ipc/` |
| 特定功能的渲染器 IPC 客户端 | renderer/ipc | `src/renderer/ipc/<feature>.ts` |

---

## 10. 渲染器特有依赖

[arch-main.md](arch-main.md) 未涵盖的版本和库。

| 类别 | 库 |
|---|---|
| 核心 | React 18.x，`react-dom` |
| 路由 | `react-router-dom` 6.x — `HashRouter`（Electron 通过 `file://` 加载） |
| UI 基础 | TailwindCSS 4.x，Radix UI，`lucide-react` |
| Markdown / 图表 | `react-markdown`，Mermaid（异步 chunk），Monaco Editor（异步 chunk） |
| 虚拟化 | `react-window` |
| 状态辅助 | `immer` |

---

## 11. 渲染器特有构建说明

- 4 个 Vite 入口 → 4 个 HTML 页面 → 3 个生产 `BrowserWindow` + 1 个 dev-only Log Viewer（见 §1）。
- target `web`；为打包的库注入 Node.js polyfill（path、os、crypto、stream、buffer）— 渲染器本身从不接触 Node API。
- Mermaid + Monaco 拆分为异步 chunk。
- 开发服务器端口 **39017**。
- 渲染器代码完全打包进 `app.asar`，因此 [arch-main.md](arch-main.md) 中的 `dependencies` vs `devDependencies` 打包陷阱在这里不适用。
