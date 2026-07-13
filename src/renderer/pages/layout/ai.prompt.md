<!-- Last verified: 2026-07-13 -->
# 布局

> 渲染进程 SPA 的外壳：采用 AppShell（Sidebar + StatusBar + Titlebar） + AgentLayout（SessionPanel + 主内容区 + 右侧面板）两层架构。

## 关键文件
| 文件 | 职责 | 规模 |
|------|------|------|
| `AppShell.tsx` | App 级 layout：titlebar + Sidebar + content slot + StatusBar | ~145 LOC |
| `Sidebar.tsx` | 常驻 icon bar：agent 头像列表、新建 agent、用户头像、设置入口 | ~174 LOC |
| `StatusBar.tsx` | 全局底部状态栏：DoctorStatusIndicator（运行/终点指示器 + done tooltip 内 View Issue）+ DoctorInquiry（诊断表单弹窗） | ~14 LOC |
| `AgentLayout.tsx` | Agent 页面根组件 — 包装 providers（`PasteToWorkspaceProvider` 等），拥有 KB/技能安装/debug-info toast 副作用 | ~130 LOC |
| `AgentLayoutContent.tsx` | Agent 页面 UI 外壳 — `SessionPanel`（位于 [`components/agent-side/`](../../components/agent-side/ai.prompt.md)）+ ResizableDivider + ContentContainer + RightGlobalSidepane 布局 | ~107 LOC |
| `ContentContainer.tsx` | `<main>` 包装器；仅渲染 `<Outlet>`（React Router） | ~20 LOC |
| `UserMenu.tsx` | 用户菜单下拉框（设置、更新、登出等） | ~145 LOC |
| `RightGlobalSidepane.tsx` | 右侧面板，用于 UserTask | ~59 LOC |
| `WindowsTitleBar.tsx` | 仅 Windows 的自定义标题栏：应用图标、侧边栏切换、缩放指示器、最小化/最大化/关闭控件 | ~155 LOC |
| `WindowZoomHotkeys.tsx` | 缩放放大/缩小/重置的全局键盘快捷键 | ~47 LOC |

## 架构

### 组件层次
```
RouterProvider (data router, entries/main.routes.tsx 的 createBrowserRouter)
  └── RootLayout (根路由 element：全局 dialog/confirmation host/热键/MCP 失败提示 + navigate:to & crash-breadcrumb effect + 非 shell 路由的独立 TitleBar)
      ├── / → redirect /agent
      ├── /login → SignInPage
      └── AppShell (Sidebar + StatusBar + Titlebar，shell 路由共享)
          ├── /agent → AgentPage → AgentLayout
          │   ├── SessionPanel  (components/agent-side/) — sessions ↔ jobs 双模式，URL 是真相
          │   ├── ResizableDivider
          │   ├── ContentContainer → ChatView / AgentEdit / AgentCreation
          │   ├── RightGlobalSidepane
          │   └── 全局 overlays/menus
          │
          └── /settings → SettingsPage (占满 sidebar 右侧)
              ├── SettingsNavigation
              └── settings 子页面
```

### 设计决策
- **AppShell vs AgentLayout 分层**：AppShell 负责全局 chrome（Sidebar、StatusBar、Titlebar），在所有路由间共享。AgentLayout 仅在 `/agent` 路由下渲染，负责 SessionPanel 和内容区域的布局。
- **Sidebar**：使用图标模式展示 agent 列表（头像 + 未读指示），替代旧的 LeftNavigation 全宽侧边栏。Sidebar 宽度固定，不可调整。
- **SessionPanel**：搬迁到 [`components/agent-side/`](../../components/agent-side/ai.prompt.md)。在 sessions 模式渲染会话列表 + 搜索 + 新建按钮；在 jobs 模式渲染 schedule 主从二级视图（jobs CRUD ↔ runs 列表）。模式来自 URL（`/agent/:agentId/job/*`），不存在表示模式的 atom。
- **状态所有权**：侧边栏宽度由 `LeftNavSizeAtom`（宽度、拖拽、持久化）管理，折叠状态由 `LeftNavCollapsedAtom` 管理，位于 `src/renderer/states/left-nav.atom.ts`。右面板使用 `RightPaneCollapsedAtom`（`src/renderer/states/right-pane.atom.ts`）。
- **下拉框/覆盖层**：所有上下文菜单和覆盖层通过 atom 管理，在 `AgentLayout` 层级渲染，无需 props 逐层传递。
- **Agent 编辑命令**：改用普通函数 `lib/chat/editAgent.ts#editAgent(agentId?, tab?)`（不碰 atom，只用 `router` + `agentSessionCacheManager`），菜单/ChatView 直接 import 调用。ChatSession CRUD（删除/fork/重命名/收藏/下载）走 `states/chatSessionCommands.ts` 的 `chatSessionCommands`（`mutate` 无状态命令 dispatcher，组合既有 DeleteConfirm/Rename/toast atom）。**不再有 `agent:editAgent` / `chatSession:*` 自定义 DOM 事件**。
- **全局确认框**：`components/ui/ConfirmationDialog.tsx` 挂在 RootLayout，`requestConfirmation(...)` 可由 React 组件或 atom/action 路径调用。只保留一个待决请求；新请求以 `false` 结算旧请求，Cancel/Esc/外部关闭同样结算 `false`。

## 常见变更
| 场景 | 需要修改的文件 | 备注 |
|------|---------------|------|
| 添加新的全局下拉框/上下文菜单 | `AgentLayout.tsx` | 将菜单组件作为兄弟元素渲染；状态通过 atom 管理 |
| 添加新的全局事件监听器 | `AgentLayout.tsx` | 在逻辑层添加带事件监听器的 `useEffect` |
| 更改 SessionPanel 最小/最大宽度 | `src/renderer/states/left-nav.atom.ts` | 常量 `MIN_WIDTH` / `MAX_WIDTH` 在此定义 |
| 修改 Sidebar 图标/布局 | `Sidebar.tsx` | 包含 `SidebarAgentItem`、`SidebarUserAvatar` 子组件 |
| 修改 SessionPanel 头部/搜索/列表 | [`src/renderer/components/agent-side/`](../../components/agent-side/ai.prompt.md) | sessions / jobs 子屏 + alarm 切换 |
| 修改 StatusBar 内容 | `StatusBar.tsx` | 含 DoctorStatusIndicator / DoctorInquiry |
| 调整 Windows 标题栏控件 | `WindowsTitleBar.tsx` | 仅在 `win32` 上渲染 |

## 联动变更映射
| 当你修改 | 同时检查/更新 |
|----------|-------------|
| 侧边栏持久化键/atom | `src/renderer/states/left-nav.atom.ts` |
| 右面板 atom | `src/renderer/states/right-pane.atom.ts` |
| `ContentContainer` 中的路由路径 | `src/renderer/routes/` 中的 React Router 配置 |
| `AgentLayoutContent` 的 props | `AgentLayout.tsx` 必须传递匹配的 props |
| 全局覆盖层新增 | 在 `AgentLayout.tsx` 中导入并渲染 |
| `AppShell` 布局 | `Sidebar.tsx`、`StatusBar.tsx` 可能需要同步调整 |

## 反模式
- 打开 Agent 编辑页用 `lib/chat/editAgent.ts#editAgent(...)`，不要再造 `agent:editAgent` 之类的自定义 DOM 事件；跨组件命令：需读写 atom 状态用 `states/` 下 action atom / `mutate`，纯模块单例操作用普通函数（别为「统一」硬套空 state 的 atom）。
- 不要绕过 `LeftNavSizeAtom` / `LeftNavCollapsedAtom` 而在叶子组件中直接从 storage 读取侧边栏状态；使用 atom 的 `.use()` 或 `.useData()`。
- 不要在 `AgentLayoutContent` 中添加全局事件监听器或 provider 包装 — 这些属于 `AgentLayout`（逻辑层）。

## 验证步骤
1. 切换侧边栏折叠 — 确认 SessionPanel 正确隐藏/显示并在重载后持久化。
2. 拖拽 SessionPanel 分隔线 — 确认宽度实时更新（不持久化），释放后持久化。
3. 在 Windows 上：确认标题栏渲染；在 macOS 上确认返回 `null`。
4. 导航到 `/agent` 根路径 — 确认自动重定向到 `/agent`。
5. 点击 Sidebar 中的 agent 图标 — 确认 SessionPanel 切换到对应 agent 的 session 列表。
6. 切换右面板 — 确认侧面板正确显示/隐藏。
7. 从 Settings 返回 — 确认正确恢复之前的 agent 和 session。

## 注意事项
- `WindowsTitleBar` 在 macOS 上渲染 `null`。任何添加到其中的侧边栏切换逻辑在非 Windows 平台上会静默缺失。
- `SettingsNavigation.tsx` 复用了 `LeftNavigation.css` 中的 `.left-navigation` 样式类，修改该 CSS 时需注意不要影响 Settings 页面。
- macOS 标题栏缩放补偿使用直接设置在 `documentElement` 上的 CSS 自定义属性（`--mac-zoom-factor`），以避免 React 渲染延迟引起的抖动。
- **数据路由（data router）**：路由在 `entries/main.routes.tsx` 用 config-first 对象数组 `const routes: RouteObject[]` 定义、`createBrowserRouter(routes)` 构建，`main.tsx` 用 `<RouterProvider router={router}/>` 挂载。`RouterProvider` 不接受 children，故所有依赖路由 context 的全局节点（`McpConnectionFailureToastListener`、`WindowZoomHotkeys`、MCP dialog）与全局 effect（`navigate:to` 事件、crash 面包屑）都迁进了根路由 `RootLayout`。不再有 `AppRoutes` / `AppRoutesWithTitleBar` 组件。
- **`Component:` vs `element:` 选择**：无 props 的路由用 `Component: X`（传组件类型，react-router 内部 `createElement`，官方推荐、省一层）；**需要给组件传 props 的路由必须用 `element: <X prop=.../>`**（`Component` 与 `element` 互斥且 `Component` 无法传 props）。当前需 `element:` 的三类：`<ChatView kind="job-run"/>`、重定向 `<Navigate to=.../>`、feature-gate `<FeatureGate flag=.../>`。
- **静态路由 + feature flag**：data router 的路由表是静态对象，无法像旧 `<Routes>` 那样用 `useFeatureFlag` 条件注册。sub-agent 路由始终注册，`element` 外包 `FeatureGate`，flag 关闭时 `<Navigate to="/" replace/>` 复现旧的 fall-through 行为。新增受 flag 门控的路由沿用此模式。
- **TitleBar 历史导航（`HistoryNav`）**：`canGoBack/canGoForward` 直接读 react-router 写入 `window.history.state.idx` 的真实历史光标 + `useNavigationType()` 的 `PUSH/POP/REPLACE` 信号，`goBack/goForward` 用 `navigate(-1)/navigate(1)`。**不再维护手搓镜像栈**——旧实现的镜像栈无法区分 push/replace，与真实历史漂移，是“后退无反应”的根因。切勿回退到镜像栈方案。
- **Settings 导航用 URL 承载意图，不用事件/定时器/sessionStorage**：从 agent editor 的 tab 进 Settings 管理页时，“预选某项”的意图放进 URL query（`/settings/skills?selected=<name>`、`/settings/sub-agents?selected=<name>`），目标视图（`SkillsView`/`SubAgentsView`）用 `useSearchParams()` 读取、命中后 `setSearchParams(..., { replace: true })` 清掉 query。**注意**：数据首帧可能仍在加载，读取 effect 必须在列表非空后才选中并清 query，否则意图丢失。Settings 页 Back（`SettingsPage.handleBack`）依据 `window.history.state.idx`：`idx>0` → `navigate(-1)` 回真实来源，`idx===0`（深链/刷新首屏）→ `resolveSettingsBackFallbackPath()` 兜底到 agent 路由。历史包袱：旧实现曾用 `agent:closeEditor` 死事件 + `setTimeout(100)` + `skills:selectSkill` CustomEvent + `settingsCameFromApp` sessionStorage 哨兵，已全部移除——**切勿回退**。

## 相关模块
- 依赖于：[userData providers](../userData/)、`agentSessionCacheManager`（`src/renderer/lib/chat/`）、`LeftNavSizeAtom` / `LeftNavCollapsedAtom`（`src/renderer/states/left-nav.atom.ts`）、`RightPaneCollapsedAtom`（`src/renderer/states/right-pane.atom.ts`）、`ResizableDivider` / `NavItem` UI 基础组件
- 被依赖于：几乎所有渲染进程视图 — `ChatView`、`AgentEditingView`、所有 `menu/` 下拉框；[Chat](../chat/ai.prompt.md) 渲染在 `ContentContainer` 的 `<Outlet>` 内
