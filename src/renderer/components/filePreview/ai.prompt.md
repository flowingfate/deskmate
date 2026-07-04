<!-- Last verified: 2026-07-04 -->

# filePreview — 文件预览模块

## 关键文件

| 文件 | 职责 | 规模 |
|---|---|---|
| `FilePreviewPanel.tsx` | **纯受控**通用文件预览面板(无自有可见状态,全靠 props)。能力:Markdown(渲染/源码切换)、code / JSON / text(Monaco 只读)、HTML(iframe/源码)、PDF(iframe)、office / other(兜底"用默认应用打开")、就地编辑保存(Monaco)、磁盘 mtime 轮询自动刷新、原生全屏、Install Skill。形态与定位由外层容器决定。原 `chat/InlineFilePreviewPanel.tsx`,Phase 4 SCSS 迁移后无 scss | ~750 LOC |
| `filePreview.atom.ts` | `createFilePreviewAtom()` 工厂 + 两个**独立实例** `ChatFilePreviewAtom` / `GlobalFilePreviewAtom`。state = `{ file, isDirty } \| null`;`open` 同文件 toggle、切文件时有脏改动弹 confirm;`markDirty` 由 panel 的 `onDirtyStateChange` 回填。两实例状态互不干扰 | 小 |
| `useFilePreviewEvent.ts` | 共享事件监听 hook + `chatFilePreviewCoordinator` 互斥单例。监听全局 `fileViewer:open` 自定义事件,把 descriptor 的 URI(`local://` / `knowledge://`)经 `resolveFileDescriptorUrl` 解析成绝对路径后交给 `open`。**类型守卫**(`in`/`typeof`)从 `CustomEvent.detail` 重建精确 `FilePreviewDescriptor`,零 cast | 小 |
| `ChatFilePreviewOverlay.tsx` | 聊天页 inline 容器:满铺 chat-content 区(`absolute inset-0`)。接 `ChatFilePreviewAtom`,`useFilePreviewEvent({ isChat: true })` —— **捕获阶段**监听 + 占用 coordinator + `stopImmediatePropagation`,优先消费。挂载在 `ChatViewContent` | ~30 LOC |
| `GlobalFilePreviewOverlay.tsx` | 全局兜底容器:shadcn `Dialog` 居中弹窗(80vw×85vh)。接 `GlobalFilePreviewAtom`,`useFilePreviewEvent({ isChat: false })` —— 冒泡阶段监听,coordinator 被占用(聊天页在场)时**让出**。透传 `onInstallSkill`。挂载在 `AgentLayoutContent`,覆盖 agent 编辑器知识库 / 工作区侧栏等非聊天场景 | ~50 LOC |

## 架构

### 一个面板,两个容器,按上下文互斥

同一功能"打开文件预览"在旧代码里是两套重复实现(`ui/OverlayFileViewer.tsx` 745 行居中弹窗 + `chat/InlineFilePreviewPanel.tsx` inline),监听同一 `fileViewer:open` 事件、靠单例开关二选一。本模块把渲染收敛成**唯一** `FilePreviewPanel`,外面套两个薄容器决定形态:

```
dispatchEvent('fileViewer:open', { detail: { file } })
        │
        ├─ 聊天页在场？ChatFilePreviewOverlay(捕获阶段, coordinator.mounted=true)
        │    → stopImmediatePropagation 优先消费 → 满铺 inline 面板
        │
        └─ 否(agent 编辑器等)：GlobalFilePreviewOverlay(冒泡阶段兜底)
             → coordinator.mounted=false 才处理 → 居中弹窗
```

**互斥单例** `chatFilePreviewCoordinator.mounted`:聊天容器挂载期置真;全局容器监听首行 `if (!isChat && coordinator.mounted) return` 让出。模块级单例(所有 chunk 共享、HMR 不残留),比挂 `window` + cast 干净。

### 事件 detail 收窄(零 cast)

`useFilePreviewEvent.extractDescriptor` 用 `instanceof CustomEvent` + `'file' in detail` + `typeof` 逐字段校验,**重建**精确 descriptor(必填 `name`/`url` 非空字符串,可选 `mimeType`/`size`/`lastModified` 各自 narrowing 后透传),不做 `as { file }` 内联断言。

## 常见变更

- **新增可预览文件类型**:改 `FilePreviewPanel` 的 `classifyFile` + `renderBody` switch;两个容器/atom 自动复用,无需改。
- **新增触发源**:任意位置 `dispatchEvent(new CustomEvent('fileViewer:open', { detail: { file: { name, url, ... } } }))`;`url` 可为 `local://` / `knowledge://` URI,hook 自动解析成绝对路径。
- **调整弹窗尺寸/形态**:改 `GlobalFilePreviewOverlay` 的 frame `<div>` 尺寸类;聊天满铺形态改 `ChatFilePreviewOverlay` 的外层 `<div>`。

## 注意事项

- **两 atom 必须独立实例**:`createFilePreviewAtom()` 每次 new(框架 `atom()` 工厂产独立闭包)。共用一个会让聊天与全局预览状态串台。
- **聊天容器必须捕获阶段监听**(`addEventListener(..., true)`):否则全局容器可能先在冒泡阶段命中,导致双开或形态错。
- **panel 的 hook 类名保留 `inline-preview-*` 前缀**:`inline-preview-fullscreen`(`:fullscreen` 伪类几何)、`inline-preview-markdown`(ReactMarkdown 裸 HTML element 选择器)、`inline-preview-frontmatter`/`fm-key`/`fm-val`,定义在 `styles/biz/_file-preview.scss`(§5 特殊 CSS,un-layered;原在 `globals.css` 尾部,现归入 biz 层)。改名会牵连 CSS,勿动。
- **CSS keyframe** `inlinePreviewSlideIn`/`inlinePreviewSavePulse` 在 `styles/biz/_keyframes.scss`,panel 用 `animate-[...]` 任意值引用。

## 相关文件

- [`../chat/ChatViewContent.tsx`](../chat/ChatViewContent.tsx) —— 挂载 `ChatFilePreviewOverlay`,会话切换时 `ChatFilePreviewAtom.cancel()`。
- [`../chat/chat-side.atom.ts`](../chat/chat-side.atom.ts) —— `WorkspaceExplorerAtom.effectiveToggle` 打开侧栏时 `ChatFilePreviewAtom.cancel()`。
- [`../../pages/layout/agent/AgentLayoutContent.tsx`](../../pages/layout/agent/AgentLayoutContent.tsx) —— 挂载 `GlobalFilePreviewOverlay`,注入 `onInstallSkill`。
- [`../../lib/internalUrls.ts`](../../lib/internalUrls.ts) —— `resolveFileDescriptorUrl`:URI → 绝对路径。
- [`../chat/ai.prompt.md`](../chat/ai.prompt.md) —— 聊天模块文档(组件树里的 `ChatFilePreviewOverlay`)。
