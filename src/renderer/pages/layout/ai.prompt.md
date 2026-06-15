<!-- Last verified: 2026-06-13 -->
# 布局

> 渲染进程 SPA 的外壳：采用 AppShell（Sidebar + StatusBar + Titlebar） + AgentLayout（SessionPanel + 主内容区 + 右侧面板）两层架构。

## 关键文件
| 文件 | 职责 | 规模 |
|------|------|------|
| `AppShell.tsx` | App 级 layout：titlebar + Sidebar + content slot + StatusBar | ~145 LOC |
| `Sidebar.tsx` | 常驻 icon bar：agent 头像列表、新建 agent、用户头像、设置入口 | ~174 LOC |
| `StatusBar.tsx` | 全局底部状态栏：DoctorStatusIndicator | ~14 LOC |
| `AgentLayout.tsx` | Agent 页面根组件 — 包装 providers（`PasteToWorkspaceProvider`、`SharePointSearchProvider` 等），拥有全局事件监听器 | ~312 LOC |
| `AgentLayoutContent.tsx` | Agent 页面 UI 外壳 — `SessionPanel`（位于 [`components/agent-side/`](../../components/agent-side/ai.prompt.md)）+ ResizableDivider + ContentContainer + RightGlobalSidepane 布局 | ~107 LOC |
| `ContentContainer.tsx` | `<main>` 包装器；渲染 `<Outlet>`（React Router），处理 `agent:newAgent` / `agent:editAgent` 事件 | ~80 LOC |
| `UserMenu.tsx` | 用户菜单下拉框（设置、更新、登出等） | ~145 LOC |
| `RightGlobalSidepane.tsx` | 右侧面板，用于 UserTask | ~59 LOC |
| `WindowsTitleBar.tsx` | 仅 Windows 的自定义标题栏：应用图标、侧边栏切换、缩放指示器、最小化/最大化/关闭控件 | ~155 LOC |
| `WindowZoomHotkeys.tsx` | 缩放放大/缩小/重置的全局键盘快捷键 | ~47 LOC |

## 架构

### 组件层次
```
AppRoutes → RequireAuth → AppShell (Sidebar + StatusBar + Titlebar)
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
- **Agent 导航事件**：`ContentContainer` 监听 `agent:newAgent` 和 `agent:editAgent` 自定义 DOM 事件。

## 常见变更
| 场景 | 需要修改的文件 | 备注 |
|------|---------------|------|
| 添加新的全局下拉框/上下文菜单 | `AgentLayout.tsx` | 将菜单组件作为兄弟元素渲染；状态通过 atom 管理 |
| 添加新的全局事件监听器 | `AgentLayout.tsx` | 在逻辑层添加带事件监听器的 `useEffect` |
| 更改 SessionPanel 最小/最大宽度 | `src/renderer/states/left-nav.atom.ts` | 常量 `MIN_WIDTH` / `MAX_WIDTH` 在此定义 |
| 修改 Sidebar 图标/布局 | `Sidebar.tsx` | 包含 `SidebarAgentItem`、`SidebarUserAvatar` 子组件 |
| 修改 SessionPanel 头部/搜索/列表 | [`src/renderer/components/agent-side/`](../../components/agent-side/ai.prompt.md) | sessions / jobs 子屏 + alarm 切换 |
| 修改 StatusBar 内容 | `StatusBar.tsx` | 目前仅有 DoctorStatusIndicator |
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
- 不要从布局子树外部的组件分发 `agent:newAgent` / `agent:editAgent` 事件，除非确认 `ContentContainer` 已挂载。
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

## 相关模块
- 依赖于：[userData providers](../userData/)、`agentSessionCacheManager`（`src/renderer/lib/chat/`）、`LeftNavSizeAtom` / `LeftNavCollapsedAtom`（`src/renderer/states/left-nav.atom.ts`）、`RightPaneCollapsedAtom`（`src/renderer/states/right-pane.atom.ts`）、`ResizableDivider` / `NavItem` UI 基础组件
- 被依赖于：几乎所有渲染进程视图 — `ChatView`、`AgentEditingView`、所有 `menu/` 下拉框；[Chat](../chat/ai.prompt.md) 渲染在 `ContentContainer` 的 `<Outlet>` 内
