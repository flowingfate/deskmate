<!-- Last verified: 2026-06-14 -->
# 聊天界面

> 最大的 UI 模块，提供完整的聊天界面：消息渲染、富文本输入、Agent 选择、Agent 编辑、工具调用可视化和工作区文件浏览。

## 关键文件
| 文件 | 职责 | 规模 |
|------|------|------|
| `ChatView.tsx` | 主聊天视图容器；负责路由↔会话同步、会话分叉/选择、编辑 agent 导航 | ~300 LOC |
| `ChatViewContent.tsx` | 可滚动的消息列表区域，带回放逻辑；负责 isEmpty/zeroStates 判断，将渲染委托给 `ChatContainer`，主输入委托给 `ComposeInput` | ~300 LOC |
| `ChatViewHeader.tsx` | 顶部栏，包含 agent 名称、会话控制和工作区切换 | — |
| `ChatRenderItem.tsx` | `ChatRenderItemComponent` — 把扁平的 `ChatRenderItem[]`（来源于 `render-items-manager`）按类型分发到对应渲染器，并通过 `React.memo` + 自定义浅比较跳过未变化的项 | ~200 LOC |
| `ChatContainer.tsx` | 消息列表的滚动容器；管理跟随滚动（首屏 / 会话切换 / 用户新消息 → force；流式 chunk → 内容驱动）、`ResizeObserver` 稳定窗口；将每项渲染委托给 `ChatRenderItemComponent` | ~590 LOC |
| `message/MarkdownView.tsx` | 唯一的 Markdown 渲染器：无 state / 无 effect / 无打字机，输入即输出；封装 react-markdown + remark 插件 + Prism 语法高亮 + Mermaid + 本地路径检测；用 `React.memo` 包裹 | ~160 LOC |
| `message/AssistantMessage.tsx` | 渲染单条 assistant 文本消息；消费 `render-items-manager` 预清洗好的 `cleanedText` / `scheduleIds`，装配 MarkdownView、GeneratedFileCards、GeneratedScheduleCards、CopyButton | ~140 LOC |
| `message/UserMessage.tsx` | 渲染单条用户消息：MarkdownView + AttachmentList + Copy/Edit 按钮 | ~75 LOC |
| `message/GreetingMessage.tsx` | 欢迎消息渲染：MarkdownView + 可选 SayHiActionItems | ~30 LOC |
| `message/AttachmentList.tsx` | 用户消息附件列表（图片 / 文件 / Office / 其它）；点击通过 `window.dispatchEvent('imageViewer:open' / 'fileViewer:open')` 唤起全局 viewer | ~145 LOC |
| `message/CopyButton.tsx` | 复制到剪贴板按钮；`text` 支持字符串或惰性 getter | ~60 LOC |
| `message/ToolCallsSection.tsx` / `message/ToolCallItem.tsx` | 折叠面板包装器，根据工具类型选择正确的 `toolCallViews/` 组件 | — |
| `message/MermaidDiagram.tsx` | 延迟加载的 Mermaid 图表渲染器，支持全屏 | — |
| `message/ImageGallery.tsx` | `<IMAGE_REGISTRY>` 分段解析 + `ImageGalleryNew` 渲染 | — |
| `InteractiveRequestCard.tsx` | 时间线原生渲染器，用于待处理的 `approval`、`choice` 和 `form` 交互 | — |
| `InteractiveAuthCard.tsx` | 时间线原生渲染器，用于交互式 CLI 认证提示（设备码、链接、倒计时），使用相同的卡片样式系统 | — |
| `chat-input/ComposeInput.tsx` | 主聊天输入组件；负责新消息编写、附件/截图、上下文 @-提及、模型选择、thinking level 选择、取消生成与 ErrorBar 展示 | ~290 LOC |
| `chat-input/EditInlineInput.tsx` | 内联编辑输入组件；负责编辑已有 user message、附件补充、确认弹窗触发和重新生成提交 | ~220 LOC |
| `chat-input/shared/useFileHandling.ts` | 输入组件共享 hook;封装拖拽、Electron 文件选择器、浏览器 fallback、图片压缩、截图捕获与 MIME 推断;所有附件在 `attachmentManager.addXxx` 前都会经 `prepareForSandbox` → `copyFileToSandbox` 物化到当前 session `files/uploads/`,`(file as FileWithSource).fullPath` 改写为 `local://uploads/<name>` URI(下游 ContentConverter 把 URI 写进 `filePath` 字段) | ~310 LOC |
| `chat-input/shared/useChatInputState.ts` | 输入组件共享 hook；创建 textarea/attachments atom，并在卸载时清理状态 | 小 |
| `chat-input/shared/transformMentions.ts` | 纯函数；把 `[@knowledge://...]`、`[@local://...]`、`[#skill:...]` 这些 mention bracket 形态转换为 markdown inline code（防止前后符号被解析为粗体/链接） | 小 |
| `chat-input/ThinkingLevelSelector.tsx` | 单聊会话的 thinking level 选择器（pi-ai `ThinkingLevel` 枚举：`minimal/low/medium/high/xhigh`）；仅在活跃模型支持 ≥2 个等级时渲染；写入 `chat.agent.thinkingLevel`，通过 `updateAgent` 持久化到 AGENT.md front-matter。dropdown 顶部 "Auto" 项写入 `thinkingLevel: null` 清除字段，回到 provider 默认 —— 前端不假装知道默认值。运行时由 `pi.streamSimple({ reasoning })` 翻译给各 provider，不再走旧的"Claude→high / GPT→medium"启发式 | 小 |
| `chat-input/ContextMenu.tsx` | @-提及下拉菜单，用于文件、技能和工作区项目 | — |
| `toolCallDisplayConfig.ts` | 工具名称 → 显示标签/图标的静态映射 | — |
| `ErrorBar.tsx` | 聊天中的内联错误显示 | — |
| `ChatInlinePreviewOverlay.tsx` | inline 文件预览的全屏浮层;铺满整个 chat-content 区域(连 ComposeInput 一起遮住),通过 `fileViewer:open` 自定义事件触发。导出的 `inlinePreviewCoordinator.mounted` 让 `OverlayFileViewer` 在本组件挂载时让出处理权,避免同一事件被两个 viewer 同时打开 | — |
| `chat-side.atom.ts` | `WorkspaceExplorerAtom` 和 `InlinePreviewAtom` 的 atom | — |
| `edit-message.atom.ts` | 内联用户消息编辑状态的 atom | — |
| `agent-area/AgentList.tsx` | 左侧边栏 agent 列表，支持搜索、置顶和创建入口 | ~2.3K LOC |
| `agent-editor/AgentBasicTab.tsx` … `AgentSystemPromptTab.tsx` | 单个 agent 的设置标签页（基本信息、上下文增强、知识库、MCP 服务器、技能、子 agent、系统提示词） | — |
| `agent-editor/AddScheduleOverlay.tsx` | 共享的定时任务创建/编辑对话框；由 `components/agent-side/jobs/JobsView` 与 `JobRunsView` 调用 | — |
| `agent-editor/scheduleTemplates.ts` | 内置定时任务模板，被 `JobHeader` 的"+"下拉消费 | — |
| `toolCallViews/ShellToolCallView.tsx` | Shell 命令结果展示，包含退出码、stdout/stderr | — |
| `toolCallViews/WebFetchToolCallView.tsx` | 抓取页面内容展示 | — |
| `toolCallViews/WebSearchToolCallView.tsx` | 搜索结果卡片 | — |
| `toolCallViews/WriteToolCallView.tsx` | 写入文件路径和差异摘要 | — |
| `toolCallViews/SubAgentToolCallView.tsx` | 子 agent 任务进度和结果展示 | — |
| `workspace/FileTreeExplorer.tsx` | 活动工作区的可展开文件树 | — |
| `workspace/PasteToWorkspaceDialog.tsx` | 将 AI 生成内容保存到工作区文件的对话框 | — |

## 架构

### 组件层级
```
ChatView (路由同步, 会话操作)
  └─ ChatViewContent (消息过滤, isEmpty/zeroStates, 回放)
       ├─ ChatContainer (滚动管理, 渲染项迭代)
       │    └─ ChatRenderItemComponent (按类型分发每项)
       │         ├─ AssistantMessage → MarkdownView (流式 + 已完成统一)
       │         ├─ UserMessage → MarkdownView + AttachmentList
       │         ├─ GreetingMessage → MarkdownView + SayHiActionItems
       │         ├─ ToolCallsSection (工具调用折叠面板)
       │         ├─ InteractiveRequestCard
       │         ├─ InteractiveAuthCard
       │         └─ EditInlineInput (内联编辑模式)
       ├─ ChatZeroStates (快速启动提示)
       ├─ ComposeInput (主编辑器)
       ├─ ChatWorkspaceSideOverlay (右侧工作区浮层, 覆盖消息区; ChatViewContent 本地组件)
       └─ ChatInlinePreviewOverlay (全屏 inline 文件预览, 覆盖整个 chat-content)

`ChatView` 位于 `/agent/:agentId/:sessionId` 与 `/agent/:agentId/job/:jobId/:sessionId` 路由下。两条路由在 `entries/main.routes.tsx` 用同一个 `ChatView` 组件渲染，由路由显式注入 `kind?: 'regular' | 'job-run'` prop（默认 `'regular'`）；ChatView 据此决定快照拉取走 `loadChatSessionSnapshot/markSessionRead`（regular，命中 `regular_sessions` + `Agent.getSession()`）还是 `loadJobRunSnapshot/markJobRunRead`（job-run，命中 `job_runs` + `Agent.getJob().getRun()`）。两条 IPC 路径在主进程 persist 层完全物理隔离，禁止写"按 sessionId 万能取" 的混查 helper。它通过 `agentSessionCacheManager` 将路由与后端会话状态同步，处理会话分叉/选择，并分发 agent 编辑的导航事件。

### 消息渲染管线
消息通过清晰的管线流转：
1. `ChatView` 通过 `CurrentSessionStatus.use()` 读取会话状态
2. `ChatViewContent` 通过 `useMessagesWithStream()` 接收消息，过滤掉 say-hi 消息，判断 `isEmpty`/`showZeroStates`，并可选地通过回放系统包装消息
3. `ChatContainer` 以 props 接收最终消息列表，通过 `lib/chat/render-items-manager.ts` 中的 `RenderItemsManager` 将 `Message[]` 转换为类型化的 `ChatRenderItem[]`，并管理自动滚动
4. `ChatRenderItemComponent` 按类型将每项分发到对应的渲染器
5. 所有 markdown 都经过 `MarkdownView`（同步无 state） — 流式与已完成走同一渲染路径，区别仅在容器外层的 `streaming` CSS 类

### 渲染项系统
`lib/chat/render-items-manager.ts` 把扁平的 `Message[]` 转换成类型化可辨识联合类型的渲染项 `ChatRenderItem[]`，并在 `recompute` 时通过 `reuseUnchangedItems()` 按 stable key 对齐前后两版，**复用未变化的 item 引用**，这样下游 `ChatRenderItemComponent` 的 `React.memo` 浅比较才能跳过未变项。

该模块还集中处理：
- 把连续的 tool-result 消息归并为 `tool-calls-section` 项
- 把 assistant message 的 derived 文本（去 `<FINAL_SUMMARY>` 前缀）与 schedule job id 提前抽出并缓存（WeakMap by message reference），喂给 `AssistantMessage` 的 `cleanedText` / `scheduleIds` props
- 通过 `extractFilePathsFromText` 抽出 generated file 列表
- 通过扫描 tool calls 抽出 `present_deliverables` 的 `presentedFiles`

### 滚动管理
`ChatContainer.useAutoScroll` 把滚动所有权与反向消息布局分离：外层 `.chat-container-reverse` 是滚动容器，内层反向流包装器处理 `column-reverse`。触发跟随滚动的入口：
- **首屏 / 会话切换 / 用户消息追加** → `messages.length` effect，`force: true`
- **流式 chunk** → 监听 streaming message 的文本长度变化（`streamingMessageTextLength` memo + effect），每个 chunk 顺势 `scheduleLatestScroll`
- **ResizeObserver** → 在 1500ms `stabilizationWindow` 内对 message-flow 容器尺寸变化做兜底
- **手动跳转** → `JumpToLatest` 按钮

流式与 ResizeObserver 驱动的滚动都会受 `userScrolledAwayRef` 阈值保护（用户上滚后不再被拉下去），只有 `force: true` 调用才会复位该标志。`agentId` 不得用来驱动重置 — 会话历史切换可以在相同的聊天标识下发生。

### 会话切换
`ChatView` 和 `ChatViewContent` 将会话切换视为显式的瞬态 UI 状态。当路由目标 `chatSessionId` 处于活跃状态但其缓存快照尚未就绪时，消息列表被替换为中立的 "Opening chat history..." 占位符，编辑器被锁定。

### 交互式请求
交互式请求是聊天会话原生的。待处理的请求通过 `InteractiveRequestCard` 在时间线中内联渲染，提交或解决后从 UI 中移除。审批请求在每个项目都有批准/拒绝决定后自动提交。选择请求和表单 select 类控件渲染为响应式的换行选项网格，带有 `Other` 回退卡片用于自定义文本输入。

### 用户消息编辑
内联用户消息编辑通过 `editMessageAtom` 管理。`ChatContainer` 为正在编辑的消息渲染 `EditInlineInput`；底部主输入则保持为 `ComposeInput`，必要时通过 `isInputLocked` 进入只读锁定态。编辑确认对话框由 `AgentLayout` 通过 window-event 桥接拥有；其跳过偏好持久化在 `profile.json` 的 `confirmationSettings.inlineEditRegenerate.skipConfirmation` 中。

### 侧边栏和编辑器
Agent 侧边栏（`agent-area/`）是 `AgentPage` 中的兄弟面板，而非 `ChatView` 的子组件。Agent 编辑器（`agent-editor/`）在导航到 `/agent/:agentId/settings/*` 时出现。**定时任务（jobs / runs）UI 已搬迁到 [`components/agent-side/`](../agent-side/ai.prompt.md)**：alarm 切换 + jobs CRUD + runs 列表 + AddScheduleOverlay 全部走那条主从二级视图，URL 是真相源；`SchedulesSidepane` / `AgentSchedulesTab` / `SchedulesContentView` 已物理删除。

## 常见变更
| 场景 | 需要修改的文件 | 备注 |
|------|---------------|------|
| 修改 markdown 渲染（代码块、链接、表格、Mermaid） | `message/MarkdownView.tsx` — `markdownComponents` 对象 | 全部消息（assistant / user / greeting）共享同一渲染器，一处修改全局生效 |
| 添加新的工具调用展示 | `toolCallViews/<NewTool>ToolCallView.tsx`、`toolCallViews/index.ts`、`message/toolCallDisplayConfig.ts`、`message/ToolCallItem.tsx` | 遵循现有视图组件模式；在 `index.ts` 和显示配置映射中注册 |
| 添加新的渲染项类型 | `lib/chat/render-items-manager.ts`（`ChatRenderItem` 联合类型 + `computeRenderItems` + `isSameRenderItem`） + `ChatRenderItem.tsx`（`ChatRenderItemComponent` 分发） | derived 字段一并加入 `MessageDerived` + `reuseUnchangedItems` 复用判定 |
| 修改主聊天输入行为 | `chat-input/ComposeInput.tsx` | 涉及发送、取消生成、模型选择和 ErrorBar |
| 修改内联编辑输入行为 | `chat-input/EditInlineInput.tsx` | 涉及编辑确认、重新生成、编辑态附件与取消按钮 |
| 修改两种输入共享的附件/截图逻辑 | `chat-input/shared/useFileHandling.ts` | 同时影响 compose 和 inline edit,两边都要回归;新增 attach 路径(自定义来源等)记得同样走 `copyFileToSandbox` 让 sandbox URI 化 |
| 修改用户消息附件展示 | `message/AttachmentList.tsx` | image / file / office / others 共用 |
| 更改 approval / choice / form 交互 | `InteractiveRequestCard.tsx`、`ChatRenderItem.tsx`、`agentSessionCacheManager.ts` | 待处理请求经 `render-items-manager` 进入渲染流水线，由 `ChatRenderItemComponent` 分发 |
| 添加 agent 编辑器标签页 | `agent-editor/Agent<Name>Tab.tsx`、`AppRoutes.tsx` 中的路由、编辑器外壳中的标签页导航 | 遵循现有标签页外壳模式 |
| 修改滚动行为 | `ChatContainer.tsx` — `useAutoScroll` hook | 始终验证基于 `chatSessionId` 的重置；流式跟随由 `streamingMessageTextLength` effect 驱动 |

## 联动变更映射
| 变更内容 | 同时需要修改 |
|----------|-------------|
| 新工具调用类型 | `toolCallViews/<New>ToolCallView.tsx` + `toolCallViews/index.ts` + `message/toolCallDisplayConfig.ts` + `message/ToolCallItem.tsx` |
| 新渲染项类型 | `lib/chat/render-items-manager.ts`（类型联合 + `computeRenderItems` + `isSameRenderItem` + `getChatRenderItemStableKey`）+ `ChatRenderItem.tsx`（分发） |
| 聊天输入中的新附件类型 | `chat-input/shared/useFileHandling.ts` + `contentUtils.ts`(`ContentPartFactory`)+ `@shared/types/chatTypes`(`UnifiedContentPart`)+ shared constants 中的 `FILE_ATTACHMENT_LIMITS` + `message/AttachmentList.tsx`(渲染分支)+ [`src/main/lib/attachment/`](../../../main/lib/attachment/ai.prompt.md)(若新来源需要新的 main 端 attach 入口) |
| 新交互式请求控件类型 | `InteractiveRequestCard.tsx` + `@shared/types/interactiveRequestTypes` + `agentSessionCacheManager.ts` |
| 新 agent 编辑器标签页 | `agent-editor/Agent<Name>Tab.tsx` + `AppRoutes.tsx`（嵌套路由）+ 编辑器外壳导航 |
| 会话滚动/布局变更 | `ChatContainer.tsx` + `ChatContainer.css` — 始终验证基于 `chatSessionId` 的重置，而非基于 `agentId` |
| Markdown 渲染变更 | `message/MarkdownView.tsx` + `message/MarkdownView.scss`（全局生效） |
| 发送门控逻辑 | `chat-input/ComposeInput.tsx` + `chat-input/EditInlineInput.tsx`（显式 `chatStatus === 'idle'` 守卫）+ 渲染进程发送入口点缓存状态重新检查 |

## 反模式
- **在 `ChatContainer` 内部读取 `useMessages()`**：会导致会话切换时的过时渲染。消息列表必须由 `ChatViewContent` 拥有并通过 props 传递。
- **基于 `agentId` 驱动滚动重置**：历史切换可以在相同的聊天标识下交换会话。始终以 `chatSessionId` 为键进行滚动重置。
- **将 `null`/`undefined` chatStatus 视为 idle**：重新打开了编辑器在会话状态水合前触发的竞态条件。
- **在会话缓存就绪前显示零状态**：在 `ChatViewContent` 中使用 "Opening chat history..." 占位符门控。
- **在 message 组件里加 state / effect / RAF / typewriter**：`MarkdownView` 必须保持无状态；流式跟随由 `ChatContainer` 的 `streamingMessageTextLength` effect 驱动，不要绕回到“子组件回传高度”那种已删除的模式。
- **在 `ChatRenderItem.tsx` 里加渲染项类型逻辑**：项类型联合、derived 字段、相等比较都属于 `lib/chat/render-items-manager.ts`，`ChatRenderItem.tsx` 只做按类型分发。
- **在聊天文件中直接导入 `mermaid`**：`MermaidDiagram` 是延迟异步的 webpack chunk；同步导入会破坏代码分割。
- **绕过 `installAndActivateSkill` 进行新技能流程**：所有安装路径必须通过唯一权威入口点。

## 验证步骤
修改此目录中的组件后：
1. 发送一条消息，确认流式渲染逐步进行（没有闪烁到完成状态、没有打字机动画 — 已永久砍除）。
2. 在流式传输过程中切换聊天会话，验证前一个会话的消息没有短暂显示。
3. 触发一个 `approval` 交互式请求，确认在每个项目做出决定后自动提交。
4. 打开一个带工作区的 agent；确认 `@`-提及上下文菜单填充了文件结果。
5. 附加一张图片和一个 Office 文件；确认两者都出现在编辑器预览中并包含在发送的消息负载中。
6. 对于工具调用变更：展开工具调用折叠面板，验证正确的视图渲染且控制台无错误。
7. 长会话里发一条新消息，观察历史消息**不重渲**（DevTools Profiler；ChatRenderItem 的 memo + render-items-manager 的引用复用应让旧 item 跳过）。
8. 在流式生成中向上滚动，确认不会被拉回底部；向下滚到底部后流式应自动跟随。

## 注意事项

- 聊天输入已拆分为 `ComposeInput`、`EditInlineInput` 和 shared hooks。修改时先确认行为属于哪个场景，不要把 compose 专属逻辑重新塞回 inline edit，反之亦然。
- 已**永久移除**打字机动画、`StreamingV2Message` 组件以及 `renderer/lib/streaming/` 整个配置/监控目录（之前 `uiConfig.showCursor` 默认为 false，整套打字机 + 设备分级优化 + 自适应内存调节都跑空）。流式消息只是不停地把 `cleanedText` 喂给 `MarkdownView`，由 React.memo + 引用复用控制重渲。
- 工具结果消息并不总是最终状态。`streamingComplete === false` 的 `tool` 消息是进行中的快照，仍应渲染为执行状态。
- 交互式认证卡片是有意设计为临时的。当命令结束、超时或用户取消时，时间线卡片应消失。
- `ChatContainer` 不是会话消息的真实来源。消息选择位于 `ChatViewContent`（或回放状态）中；活跃列表通过 props 传递。
- 会话切换不等同于空聊天。在目标会话缓存就绪前，不要显示空状态或零状态 UI。
- 聊天输入的发送可用性必须在 `ComposeInput` 和 `EditInlineInput` 两侧保持一致，且都应基于显式的 `chatStatus === 'idle'`。将缺失的状态视为 idle 会重新打开编辑器在会话状态水合前提交的竞态条件。
- 内联编辑提交失败是可恢复的聊天错误。如果 `onSubmitEditedMessage` 被拒绝，将消息捕获到 chat-session cache 中，以便 `ErrorBar` 能够渲染它。
- 时间线自动滚动不仅仅由消息数量变化驱动。如果插入了待处理的交互式请求或类似的非消息时间线项，`ChatContainer` 仍需要显式的最新滚动触发（当前由 `ResizeObserver` 稳定窗口兜底）。
- Agent 编辑器标签页路由使用嵌套的 React Router `<Outlet>` — 添加标签页需要同时修改组件树和 `AppRoutes.tsx`。
- Mermaid 图表作为异步 webpack chunk 延迟加载；避免在同步加载的聊天文件中直接导入 `mermaid`。
- AttachmentList 通过 `window.dispatchEvent('imageViewer:open' / 'fileViewer:open')` 与全局 viewer 解耦。新加附件类型时记得在两侧都注册（事件 detail 字段与 viewer 监听）。

## 后续可做（Backlog）

> 已识别但**暂未实施**的改造；动手前先回到对应文件的代码注释看最新现状。

- **`<FINAL_SUMMARY>` 分段渲染**（折叠 thinking + 显示最终回答）
  - 当前：只在 `lib/chat/render-items-manager.ts` 的 `FINAL_SUMMARY_PREFIX_PATTERN` 里**剥前缀**，主路径已无 system prompt 主动输出该 tag，留这条正则纯属兼容历史 chat session 快照（见 `resources/examples/profiles/chat_sessions/`）
  - 期望：在 system prompt 加指令让模型在最终答案外包 `<FINAL_SUMMARY>...`；把 cleanedText 升级为"按 tag 切两段"的派生结果，UI 用 `<details>` 折叠前段（thinking）、后段进 MarkdownView
  - 牵动：`lib/chat/render-items-manager.ts`（派生字段从 `cleanedText: string` 变成 `{ thinking, final }`）、`message/AssistantMessage.tsx`（渲染折叠器）、`@shared/types/chatTypes.ts`（评估是否一并清掉几乎没人填充的 `ThinkingContentPart`）
  - 触发条件：当前缀策略不够、需要让用户看到完整推理过程时再做

## 相关模块

- 依赖于 [IPC](../../../shared/ipc/ai.prompt.md) 进行所有主进程通信
- 渲染层入口：`MarkdownView`（位于 `message/MarkdownView.tsx`） — 唯一的 Markdown 出口
- 通过 IPC 通道与 [Chat Engine](../../../main/lib/chat/ai.prompt.md) 通信
- Agent/配置文件状态来源于渲染进程 userData providers 和 `agentSessionCacheManager`
