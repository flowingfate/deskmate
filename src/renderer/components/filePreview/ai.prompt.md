<!-- Last verified: 2026-07-13 -->

# filePreview — 文件预览模块

## 关键文件

| 文件 | 职责 | 规模 |
|---|---|---|
| `FilePreviewPanel.tsx` | **纯受控**通用文件预览面板(无自有可见状态,全靠 props)。能力:Markdown(渲染/源码切换)、code / JSON / text(Monaco 只读)、HTML(iframe/源码)、PDF(iframe)、office / other(兜底"用默认应用打开")、就地编辑保存(Monaco)、磁盘 mtime 轮询自动刷新、原生全屏、Install Skill。形态与定位由外层容器决定。原 `chat/InlineFilePreviewPanel.tsx`,Phase 4 SCSS 迁移后无 scss | ~750 LOC |
| `filePreview.atom.ts` | `createFilePreviewAtom()` 工厂 + 两个**独立实例** `ChatFilePreviewAtom` / `GlobalFilePreviewAtom`。state = `{ file, isDirty } \| null`;`open` 同文件 toggle、切文件及 `cancel` 在脏改动时都通过 RootLayout 全局异步确认框确认 discard 后才改变状态；`markDirty` 由 panel 的 `onDirtyStateChange` 回填。两实例状态互不干扰 | 小 |
| `filePreviewScope.tsx` | **「就近优先」路由**(替代旧 `useFilePreviewEvent.ts` 的 `fileViewer:open` 全局事件 + capture/bubble + coordinator 单例)。`useOpenFilePreview()` 按当前 React 作用域选 atom：聊天子树被 `<ChatFilePreviewScope>` 包裹 → context 提供绑定 `ChatFilePreviewAtom` 的 open；无 provider 兜底 → `GlobalFilePreviewAtom`。open 内部先 `resolveFileDescriptorUrl`(URI→绝对路径)再交 atom。producer 一律 `const open = useOpenFilePreview()` 后调 `open(descriptor)`，零事件、零 cast | 小 |
| `ChatFilePreviewOverlay.tsx` | 聊天页 inline 容器:满铺 chat-content 区(`absolute inset-0`)。纯订阅 `ChatFilePreviewAtom.use()` 渲染，不再监听事件。挂载在 `ChatViewContent`(在 `ChatFilePreviewScope` 内) | ~25 LOC |
| `GlobalFilePreviewOverlay.tsx` | 全局兜底容器:shadcn `Dialog` 居中弹窗(80vw×85vh)。纯订阅 `GlobalFilePreviewAtom.use()` 渲染。透传 `onInstallSkill`。挂载在 `AgentLayoutContent`,覆盖 agent 编辑器知识库 / 工作区侧栏等非聊天场景 | ~50 LOC |

## 架构

### 一个面板,两个容器,按作用域就近路由

同一功能"打开文件预览"在旧代码里是两套重复实现(`ui/OverlayFileViewer.tsx` 745 行居中弹窗 + `chat/InlineFilePreviewPanel.tsx` inline),监听同一 `fileViewer:open` 事件、靠单例开关二选一。本模块把渲染收敛成**唯一** `FilePreviewPanel`,外面套两个薄容器决定形态,由 producer 所在的 React 作用域决定进哪个 atom:

```
useOpenFilePreview()(producer 侧)
        │
        ├─ 在 <ChatFilePreviewScope> 内(聊天子树)？→ ChatFilePreviewAtom.open → 满铺 inline 面板
        │
        └─ 否(agent 编辑器 / 工作区侧栏等)：→ GlobalFilePreviewAtom.open → 居中弹窗
```

**就近优先靠 React context** —— `<ChatFilePreviewScope>` 包裹 `ChatViewContent` 全部子树(含消息附件、工具渲染器、工作区侧栏)；context 里带绑定 `ChatFilePreviewAtom` 的 open。scope 外的 producer(agent 编辑器知识库)拿不到 context，`useOpenFilePreview` 回退到 `GlobalFilePreviewAtom`。这精确复刻旧代码"聊天页在场则聊天预览优先"的语义，但用组件作用域而非 DOM 捕获阶段 + 模块单例实现——无事件总线、无 `stopImmediatePropagation`、无 coordinator。

脏编辑确认是异步的：`FilePreviewPanel` 在 Cancel Edit / Close 前等待全局 `requestConfirmation` 的 `Discard changes` 结果；atom 的切文件、同文件 toggle 与外层关闭也执行同一门控。仅确认 discard 才 dispose Monaco 或改变预览 state。

### descriptor 收窄(零 cast)

producer 直接构造类型化 `FilePreviewDescriptor`(必填 `name`/`url`，可选 `mimeType`/`size`/`lastModified`)传给 `open`，编译期即校验——不再从 `CustomEvent.detail` 用类型守卫重建。URI(`local://` / `knowledge://`)由 `useScopedOpen` 里的 `resolveFileDescriptorUrl` 解析成绝对路径。

## 常见变更

- **新增可预览文件类型**:改 `FilePreviewPanel` 的 `classifyFile` + `renderBody` switch;两个容器/atom 自动复用,无需改。
- **新增触发源**:producer 组件里 `const open = useOpenFilePreview()`，点击时 `open({ name, url, ... })`;`url` 可为 `local://` / `knowledge://` URI，自动解析成绝对路径。聊天子树内自动进 inline 预览，其余进全局弹窗。
- **调整弹窗尺寸/形态**:改 `GlobalFilePreviewOverlay` 的 frame `<div>` 尺寸类;聊天满铺形态改 `ChatFilePreviewOverlay` 的外层 `<div>`。

## 注意事项

- **两 atom 必须独立实例**:`createFilePreviewAtom()` 每次 new(框架 `atom()` 工厂产独立闭包)。共用一个会让聊天与全局预览状态串台。
- **聊天子树必须被 `<ChatFilePreviewScope>` 包裹**:否则聊天内的文件点击会回退到全局居中弹窗(而非满铺 inline)。scope 挂在 `ChatViewContent` 最外层，覆盖消息 / 附件 / 工具渲染器 / 工作区侧栏所有 producer。
- **panel 的 hook 类名保留 `inline-preview-*` 前缀**:`inline-preview-fullscreen`(`:fullscreen` 伪类几何)、`inline-preview-markdown`(ReactMarkdown 裸 HTML element 选择器)、`inline-preview-frontmatter`/`fm-key`/`fm-val`,定义在 `styles/biz/_file-preview.scss`(§5 特殊 CSS,un-layered;原在 `globals.css` 尾部,现归入 biz 层)。改名会牵连 CSS,勿动。
- **CSS keyframe** `inlinePreviewSlideIn`/`inlinePreviewSavePulse` 在 `styles/biz/_keyframes.scss`,panel 用 `animate-[...]` 任意值引用。

## 相关文件

- [`../chat/ChatViewContent.tsx`](../chat/ChatViewContent.tsx) —— 挂载 `ChatFilePreviewOverlay`,会话切换时 `ChatFilePreviewAtom.cancel()`。
- [`../chat/chat-side.atom.ts`](../chat/chat-side.atom.ts) —— `WorkspaceExplorerAtom.effectiveToggle` 打开侧栏时 `ChatFilePreviewAtom.cancel()`。
- [`../../pages/layout/agent/AgentLayoutContent.tsx`](../../pages/layout/agent/AgentLayoutContent.tsx) —— 挂载 `GlobalFilePreviewOverlay`,注入 `onInstallSkill`。
- [`../../lib/internalUrls.ts`](../../lib/internalUrls.ts) —— `resolveFileDescriptorUrl`:URI → 绝对路径。
- [`../chat/ai.prompt.md`](../chat/ai.prompt.md) —— 聊天模块文档(组件树里的 `ChatFilePreviewOverlay`)。
