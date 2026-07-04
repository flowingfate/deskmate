# Settings Page Development Guide

本文档描述如何在 Deskmate 新增一个 Settings 页面，以及所有 Settings 页面必须遵循的统一设计与实现约定。

> **样式约定**：Settings 页面**全部使用 Tailwind + shadcn 组件**，**不再有任何 `.scss` / `.css` import**，也不再使用 `runtime-*` / `toolbar-*` / `unified-header` / `content-view-container` 等历史全局类。头部由 `SettingsLayout` 统一提供，控件用 `@/shadcn/*`。

---

## 1. 整体架构

每个 Settings 页面遵循**两层组件模式**，头部由共享的 `SettingsLayout` 提供：

```
<XxxSettingsView>              ← 容器层：持有 state、处理逻辑、发起 IPC
  └── <SettingsLayout>        ← 共享布局：渲染顶部标题栏（icon + title + 可选 badges/actions）
        └── <XxxSettingsContentView>  ← 内容层：纯 props（数据 + 回调），无 IPC
```

**原则：**
- `*View.tsx` — 唯一有状态的一层；负责数据加载、保存、IPC 调用。
- `SettingsLayout` — 共享组件（`SettingsLayout.tsx`），提供固定头部与可滚动内容区。
- `*ContentView.tsx` — 完全由 props 驱动（数据 + 回调），不直接调 IPC，便于独立测试。

---

## 2. 文件命名与目录结构

文件位于 `src/renderer/components/settings/<feature>/`，命名如下：

| 文件 | 说明 |
|------|-------------|
| `XxxSettingsView.tsx` | 容器层（旧页面亦有 `XxxView.tsx`，如 `AboutAppView.tsx`） |
| `XxxSettingsContentView.tsx` | 内容层 |

示例（Screenshot）：

```
screenshot/
  ScreenshotSettingsView.tsx
  ScreenshotSettingsContentView.tsx
```

> **约定**：新页面用 `XxxSettingsView.tsx` 命名；`XxxView.tsx` 是遗留例外。头部**不再单独建 `*HeaderView.tsx`**，改由 `SettingsLayout` 的 `icon` / `title` props 提供。

---

## 3. 两层组件模式

### 3.1 `*View.tsx` — 容器层

```tsx
import React, { useState, useEffect, useCallback } from 'react'
import { Camera } from 'lucide-react'
import SettingsLayout from '../SettingsLayout'
import XxxSettingsContentView from './XxxSettingsContentView'
import { xxxApi } from '../../../ipc/xxx'
import type { XxxSettings } from '@shared/ipc/xxx'

const XxxSettingsView: React.FC = () => {
  const [settings, setSettings] = useState<XxxSettings>(defaultSettings)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const res = await xxxApi.getSettings()
      if (res?.success && res.data) setSettings(res.data)
      else setError('Failed to load: ' + (res?.error ?? 'Unknown error'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSettingsChange = useCallback(async (next: XxxSettings) => {
    setSettings(next) // 乐观更新
    const res = await xxxApi.updateSettings(next)
    if (!res?.success) setError(res?.error ?? 'Save failed')
  }, [])

  return (
    <SettingsLayout icon={<Camera size={18} />} title="Xxx">
      <XxxSettingsContentView
        settings={settings}
        error={error}
        onSettingsChange={handleSettingsChange}
      />
    </SettingsLayout>
  )
}

export default XxxSettingsView
```

**关键规则：**
- 根元素**必须**是 `<SettingsLayout icon={...} title="...">`，它负责整页的 flex 布局与头部。
- 把 `error`（以及需要的 `loading`）作为 props 传给 ContentView。
- 所有事件回调（`onXxx`）在此定义并向下传。
- 立即生效的 toggle 用**乐观更新**：先 `setSettings()`，再 async IPC。

### 3.2 `SettingsLayout` — 头部与内容容器

`SettingsLayout.tsx` 提供固定头部（`icon` + `title`，可选 `badges` / `actions`）与 `flex-1 min-h-0 overflow-y-auto` 的滚动内容区。**不要再手写 `unified-header` / `header-title` 结构**，直接传 props：

```tsx
<SettingsLayout icon={<Terminal size={18} />} title="Runtime Environment" badges={...} actions={...}>
  {children}
</SettingsLayout>
```

### 3.3 `*ContentView.tsx` — 内容层

见 [第 4 节](#4-内容区设计约定)。

---

## 4. 内容区设计约定

### 4.1 根结构（Tailwind）

ContentView 根节点自行铺满并滚动，居中约束宽度：

```tsx
<div className="flex flex-col p-6 bg-surface-primary h-full overflow-auto" data-dbg="xxx-settings">
  <div className="max-w-4xl mx-auto w-full">
    {/* 错误横幅（见 §7） */}
    <div className="space-y-6 px-6 pb-6">
      {/* 每个逻辑分组一个 Card */}
      <div className="bg-white rounded-md p-2 border border-black/7 flex flex-col gap-2">
        {/* setting rows */}
      </div>
    </div>
  </div>
</div>
```

**关键规则：**
- 内容宽度约束用 `max-w-4xl mx-auto w-full`（≈ 56rem，居中）。
- 分组之间用 `space-y-6` 间距。

### 4.2 Card 约定

Card 用 Tailwind 直接写，不再有 `.toolbar-settings-card` 类：

```tsx
<div className="bg-white rounded-md p-2 border border-black/7 flex flex-col gap-2">
  {/* Card header（可选，带底部分隔线） */}
  <div className="flex items-center justify-between px-1 pb-2.5 border-b border-black/6 mb-1">
    <div className="flex-1">
      <label className="block text-content text-base font-medium">Card Title</label>
      <p className="text-xs text-content-secondary mt-0.5 leading-normal">Optional description.</p>
    </div>
  </div>
  {/* setting rows */}
</div>
```

**何时新建 Card：** 每个逻辑功能组一个 Card（如 General / Shortcut / Save Path）；不要把所有项塞进一个 Card。

### 4.3 Setting Item 约定

每行设置项：左标签、右控件，`justify-between`：

```tsx
<div className="flex items-center justify-between px-1 py-2.5">
  <div className="flex-1">
    <label className="block text-content text-base font-normal">Setting Name</label>
    <p className="text-xs text-content-secondary mt-0.5">Optional helper text.</p>
  </div>
  {/* 右侧控件：Switch / Select / Input / Button */}
</div>
```

---

## 5. 状态管理（容器模式）

### 5.1 状态声明

- 所有状态位于容器 View。
- 数据状态与 UI 状态（`error`、必要时 `loading`）分开。
- 值与回调一并作为 props 传给 ContentView。

### 5.2 乐观更新

立即生效的 toggle：

```tsx
const handleToggle = async (value: boolean) => {
  setSettings(prev => ({ ...prev, enabled: value })) // 1. 立即本地更新
  const res = await xxxApi.updateSettings({ ...settings, enabled: value }) // 2. async 通知主进程
  if (!res?.success) setError(res?.error ?? 'Save failed')
}
```

### 5.3 回调命名

| Prop 名 | 用途 |
|-----------|---------|
| `onSettingsChange` | 整个 settings 对象变更（toggle / select 等） |
| `onXxxChange` | 单字段变更（如 `onShortcutChange`） |
| `onInstall` | 安装动作 |
| `onDelete` / `onUninstall` | 删除 / 卸载 |
| `onSelectPath` / `onResetPath` | 路径选择 / 重置 |

---

## 6. IPC 调用约定

**规则：IPC 只在 `*View.tsx`（容器层）发起。`*ContentView.tsx` 绝不直接调 IPC。**

所有 IPC 遵循统一响应形态：

```ts
interface IpcResponse<T> {
  success: boolean
  data?: T
  error?: string
}
```

---

## 7. 错误处理

ContentView 在表单顶部渲染错误横幅（Tailwind）：

```tsx
{error && (
  <div className="glass-surface mb-4 p-4 border border-[#fecaca] rounded-xl text-[#b91c1c]">
    <div className="flex items-center gap-2">
      <div className="w-4 h-4 rounded-full bg-(--status-error-light) shrink-0"></div>
      <span className="font-medium">Error:</span>
    </div>
    <p className="mt-1 text-sm leading-5">{error}</p>
  </div>
)}
```

**规则：**
- `error: string | null` 由 props 传入 — ContentView 不自持。
- 在 View 层 catch 后 `setError()`。

---

## 8. 常用 UI 控件

统一使用 shadcn 组件（`@/shadcn/*`），不再有 `toolbar-toggle-*` / `runtime-select` / `runtime-action-btn` 等类。

### 8.1 Toggle Switch

```tsx
import { Switch } from '@/shadcn/switch'

<Switch checked={settings.enabled} onCheckedChange={(v) => onSettingsChange({ ...settings, enabled: v })} />
```

### 8.2 Dropdown Select

```tsx
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/shadcn/select'

<Select value={value} onValueChange={onChange}>
  <SelectTrigger className="w-16 bg-transparent border-none outline-none text-sm text-content">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
  </SelectContent>
</Select>
```

### 8.3 Shortcut Recorder

```tsx
import ShortcutRecorder from '../../ui/ShortcutRecorder'

<ShortcutRecorder value={settings.shortcut} onChange={onShortcutChange} requireModifier />
```

### 8.4 Action Button

```tsx
import { Button } from '@/shadcn/button'

<Button size="sm" onClick={onSelectSavePath}>Browse...</Button>
<Button variant="link" size="sm" onClick={onResetSavePath} className="mt-2">Reset to Default</Button>
```

### 8.5 Setting Description Text

```tsx
<p className="text-xs text-content-secondary mt-0.5">A short description of this setting.</p>
```

---

## 9. 在导航中注册

导航在 `sidepanel/index.tsx`（`SettingsSidepanel`）。新增页面需两处改动：

### Step 1: 在 `getActiveView()` 映射路径

```tsx
const getActiveView = () => {
  const path = location.pathname;
  if (path.includes('/settings/xxx')) return 'xxx';
  // ...
  return 'mcp'; // 默认
};
```

### Step 2: 渲染一个 `NavItem`

在 `sidepanel/index.tsx` 的 `<nav>` 内加：

```tsx
{xxxEnabled && (
  <NavItem
    icon={<XxxIcon size={20} />}
    label="Xxx"
    isActive={activeView === 'xxx'}
    onClick={() => navigate('/settings/xxx')}
  />
)}
```

`NavItem`（`sidepanel/NavItem.tsx`）基于 shadcn `Button` 封装，`isActive` 切换 `secondary` / `ghost` variant，图标用 lucide（size 20）。

### Step 3: Feature Flag（可选）

```tsx
const xxxEnabled = useFeatureFlag('deskmateFeatureXxx');
```

已全量发布的页面不需要 feature flag。

---

## 10. 注册路由

在 `src/renderer/entries/main.routes.tsx` 的 `/settings` 子路由下添加：

```tsx
import XxxSettingsView from '../components/settings/xxx/XxxSettingsView';

// children of { path: '/settings', Component: SettingsPage }
{ path: 'xxx', Component: XxxSettingsView },
```

路径约定：`/settings/<feature-kebab-case>`。默认子路由 `index` 重定向到 `tools`。

---

## 11. Feature Flags

实验性或平台相关页面用 feature flag：

```tsx
// src/renderer/lib/featureFlags.ts
export const FEATURE_FLAGS = {
  deskmateFeatureXxx: {
    defaultValue: false,
    platforms: ['darwin', 'win32'],
    envs: ['development'],
  }
}
```

用法：`const xxxEnabled = useFeatureFlag('deskmateFeatureXxx')`。

---

## 12. 新页面 Checklist

- [ ] 建 `xxx/XxxSettingsContentView.tsx`
  - [ ] 根 `flex flex-col p-6 ... h-full overflow-auto` + `max-w-4xl mx-auto w-full`
  - [ ] 分组用 Card（`bg-white rounded-md p-2 border border-black/7`）
  - [ ] 每行用 `flex items-center justify-between px-1 py-2.5`
  - [ ] 顶部错误横幅
  - [ ] shadcn 控件（`Switch` / `Select` / `Button`），**无 CSS import**
  - [ ] **无直接 IPC** — 全走 props
- [ ] 建 `xxx/XxxSettingsView.tsx`（容器层）
  - [ ] 根用 `<SettingsLayout icon={...} title="...">`
  - [ ] `useEffect` 加载初始数据
  - [ ] 定义所有回调并传给 ContentView
  - [ ] 集中管理 `error`（及需要的 `loading`）
- [ ] `sidepanel/index.tsx`：`getActiveView()` 映射 + 加 `NavItem`
- [ ] `main.routes.tsx` 加 `<Route>`
- [ ] （可选）`featureFlags.ts` 注册 feature flag

---

## 现有页面

| 页面 | 路由 | Feature Flag |
|------|------|--------------|
| Tools | `/settings/tools` | — |
| MCP | `/settings/mcp` | — |
| Skills | `/settings/skills` | — |
| Sub-Agents | `/settings/sub-agents` | `deskmateFeatureSubAgent` |
| Screenshot | `/settings/screenshot` | `deskmateFeatureScreenshot` |
| Runtime | `/settings/runtime` | — |
| Provider | `/settings/provider` | — |
| About | `/settings/about` | — |
| Archived Agents | `/settings/archived-agents` | — |

---

## App 级配置（app.json）

**跨所有 profile 共享**的设置（如 runtime 环境、updater 版本）走 app 级配置管线。

`appDataManager` 实现在 `src/renderer/lib/userData/appDataManager.ts`，主进程对端在 `src/main/lib/appCache/`。

| 任务 | 做法 |
|------|-----|
| 读 app 配置 | `appDataManager.getConfig()` / `appDataManager.getRuntimeEnvironment()` |
| 响应配置变更 | `useEffect` 里 `appDataManager.subscribe(listener)` |
| 写配置 | `appDataManager.updateConfig({ field: value })` |
| 禁止 | 用 `window.electronAPI.runtime.*` **读**配置；直接调 IPC 读持久化状态 |

```tsx
useEffect(() => {
  appDataManager.initialize().then(() => setEnv(appDataManager.getRuntimeEnvironment()));
  const unsub = appDataManager.subscribe(cfg => setEnv(cfg.runtimeEnvironment ?? null));
  return unsub;
}, []);
```

---

## Profile 级配置（profile.json）

**每用户**设置（如 MCP servers、agent 配置、toolbar 设置）走 profile 级配置管线。每个用户的数据存于 `{userData}/profiles/{alias}/profile.json`，与其他 profile 完全隔离。

Profile 级配置写路径走 IPC 到 main 进程的 `persist/` 模块（详见 [`src/main/persist/ai.prompt.md`](../../../main/persist/ai.prompt.md)）；renderer 侧通过 atom 订阅 `persist:*` 通道获取最新缓存。

```tsx
useEffect(() => {
  const cache = profileDataManager.getCache();
  if (cache.profile) setMyConfig((cache.profile as ProfileV2).myFeature ?? DEFAULT_MY_FEATURE_CONFIG);
  const unsub = profileDataManager.subscribe((cache) => {
    if (cache.profile) setMyConfig({ ...(cache.profile as ProfileV2).myFeature! });
  });
  return unsub;
}, []);
```

---

## 视觉规范参考

| 属性 | 值 |
|----------|-------|
| 主文本色 | `text-content`（`#272320`） |
| 次要/描述文本色 | `text-content-secondary` |
| 主文本尺寸 | `text-base` / `font-normal` |
| Card 标题文本 | `text-base` / `font-medium` |
| Card 圆角 | `rounded-md` |
| Card 边框 | `border border-black/7` |
| Card padding | `p-2`（含 header 时 `p-3`） |
| 内容最大宽度 | `max-w-4xl`（≈ 56rem，`mx-auto`） |
| 分组间距 | `space-y-6` |
