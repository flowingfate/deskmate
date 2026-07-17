<!-- Last verified: 2026-07-17 (Step 12：subagent run lazy transcript Dialog 已接入) -->
# 聊天界面

> 最大的 UI 模块，提供完整的聊天界面：消息渲染、富文本输入、Agent 选择、Agent 编辑、工具调用可视化和工作区文件浏览。

## 关键文件
| 文件 | 职责 | 规模 |
|------|------|------|
| `ChatView.tsx` | 主聊天视图容器；仅负责 URL↔会话同步，以 `kind` 区分 regular 可交互会话与 job-run 只读回放 | ~120 LOC |
| `JobRunChat.tsx` | job-run 的只读说明与转换入口；仅 terminal run 可经 persist IPC 创建独立 regular session，成功后导航到普通 session URL | small |
| `ChatViewHeader.tsx` | 顶部栏：左侧组合 agent 身份与自包含的 Skills / Local tools / MCP tools 状态徽标；右侧 `ContextBadge` 点击向下展开 context window 详情及当前消息历史中 assistant usage 的累计 token 消耗：Prompt input（uncached input + cache read + cache write）、output、total | — |
| `../ui/StatusBadges.tsx` | 聚合当前 agent 的 Skills / Local tools / MCP tools 状态；徽标直接调用 `editAgent(agentId, tab)` 进入对应设置，不经 `ChatView` / `ChatViewHeader` 回调透传 | — |
| `ribbon/index.tsx` | 输入框上方的紧凑控制条：左侧弹性槽渲染提示或错误，job-run 不显示 regular-only Retry；保留右侧会话操作的固定宽度 | 小 |
| `ribbon/RibbonItem.tsx` | ribbon 专用紧凑按钮：由 ribbon 的交叉轴拉伸铺满高度、无圆角；统一 hover / active / disabled 状态，并通过包裹 disabled button 的 tooltip trigger 保证所有项目均可显示提示 | 小 |
| `ribbon/DevInfoBadge.tsx` | 开发环境的版本、Agent ID、scheduler job 名称/ID、会话 ID 信息及复制菜单；自行获取 app version，路由和会话状态为标识符来源，菜单向上展开 | 小 |
| `ribbon/RibbonTip.tsx` | 左侧垂直居中的灯泡图标 + 操作提示轮播；每次仅以一次 state 更新并行挂载当前/下一项，分别播放 `ribbon-tip-exit` 与 `ribbon-tip-enter` CSS 关键帧，避免 rAF 状态切换导致的闪跳；文本省略但保留悬浮全文 | 小 |
| `ribbon/ErrorBar.tsx` | 无背景的紧凑错误行；重试按钮紧随消息，错误文本在左侧弹性槽内单行截断并经悬浮全文暴露诊断建议 | 小 |
| `ribbon/JumpToLatest.tsx` | 始终显示的跳转控件 `JumpToLatestItem`：不可跳转时 disabled，滚离最新消息后激活并显示 `Jump to latest` 文案；同文件定义 `JumpToLatestAtom` 状态机 | 小 |
| `ribbon/useSessionActionTarget.ts` | 导出 `SessionActionTarget` 可辨识联合，并在 ribbon 内聚路由会话操作判定：job-run target 携带 agent / job / session 标识，所有 target 均核对当前 route/cache，regular 再以消息数识别新建空会话；不经 `ChatView` / `ChatViewContent` 透传 | 小 |
| `ribbon/ForkSessionItem.tsx` | 仅对已就绪且已有消息的 regular session 启用；job run、无会话与切换中均 disabled，通过 `chatSessionCommands` 复用 fork + 路由跳转逻辑 | 小 |
| `ribbon/OpenSessionFolderItem.tsx` | 对已就绪的 regular session 与 job run 启用；regular 经 `getFilePath → Agent.getSession()`，job run 经 `getScheduleRunFilePath → Agent.getJob().getRun()` 取得各自真实 session 根目录后交给系统文件管理器打开 | 小 |
| `ribbon/ToggleWorkspaceExplorer.tsx` | 工作区侧栏的可见性切换按钮，使用 `RibbonItem` | 小 |
| `ChatRenderItem.tsx` | `ChatRenderItemComponent` — 把扁平的 `ChatRenderItem[]`（来源于 `render-items-manager`）按类型分发到对应渲染器，并通过 `React.memo` + 自定义浅比较跳过未变化的项 | ~200 LOC |
| `ChatContainer.tsx` | 消息列表渲染容器；组合 `useChatAutoScroll`、渲染项派生与编辑动作，不持有 ribbon 桥接状态 | ~410 LOC |
| `useChatAutoScroll.ts` | 自动滚动、流式跟随、稳定窗口与 `ResizeObserver`；持有滚动 DOM refs，消费/发布跳转最新消息状态机 | ~185 LOC |
| `message/MarkdownView.tsx` | 唯一的 Markdown 渲染器：无 state / 无 effect / 无打字机，输入即输出；封装 react-markdown + remark 插件 + Prism 语法高亮 + Mermaid + 本地路径检测；用 `React.memo` 包裹 | ~160 LOC |
| `message/AssistantMessage.tsx` | 渲染单条 assistant 文本消息；消费 `render-items-manager` 预清洗好的 `cleanedText` / `scheduleIds`，装配 MarkdownView、GeneratedFileCards、GeneratedScheduleCards、CopyButton | ~140 LOC |
| `message/UserMessage.tsx` | 渲染单条用户消息：MarkdownView + AttachmentList + Copy/Edit 按钮 | ~75 LOC |
| `message/AttachmentList.tsx` | 用户消息附件列表（图片 / 文件 / Office / 其它）；sandbox 大图(`local://`+fileRef / opaque)经 [`lib/mediaUrl.ts`](../../lib/mediaUrl.ts) 构造 `media://` URL 由 `<img loading=lazy>` 字节直供（不读 base64），小图内联 dataURL；点击图片走 `ImageViewerAtom.open`（`ui/OverlayImageViewer`），点击文件走 `useOpenFilePreview()`（就近作用域路由，聊天页 inline 预览） | ~215 LOC |
| `message/CopyButton.tsx` | 复制到剪贴板按钮；`text` 支持字符串或惰性 getter | ~60 LOC |
| `tool/ToolCallsSection.tsx` | 工具调用章节;两套视图共享同一外壳 + CSS transition(220ms): **collapsed** 紧凑 600px 卡片(chip 行 + 单选 detail);**expanded** (view all) 贴边浅灰条 max-h 60vh 内滚,所有工具纵向列出(每张白卡片复用 `ToolDetailView`)。水平 inset 模式:`!px-0` 这层豁免 `.chat-message-flow-reverse > *` 的默认 `--chat-pad-x` padding,由本组件正向控制 margin(collapsed 推内容对齐其他消息)或 padding(expanded bg 撑满 wrapper + 内 padding 拉回对齐) — **不用负 margin breakout**,bg 天然占满 chat 全宽;高度切换由 `AnimatedHeight` 平滑过渡,避免 column-reverse 上方兄弟闪动。`selectedId` 切 mode 时保留 | ~350 LOC |
| `tool/ToolChip.tsx` | 通用工具胶囊；状态点 executing(琥珀脉动) / failed(红实心) / completed(无点)；选中态深色填充。MCP 用低饱和 violet 表面 + tooltip 标识 server；其它顶层工具若需定制，必须由自己的 `ToolRenderer.Chip` override 承担，不向通用 chip 增加 tool-specific 分支 | ~115 LOC |
| `tool/ToolDetailView.tsx` | 唯一的两段式详情容器(input/output)；按 slot 优先级（粗 InputBlock/OutputSuccessBlock/OutputExecutingBlock > 细 inputArgsText/outputResultText > 默认）注入 renderer 覆盖。一个 renderer 一旦提供粗粒度 block,就**完全接管**该 slot,不会再回到细粒度 —— 多层兜底由 renderer 自己内部完成(典型例子:`renderers/app/`)。`verticallyUnbounded?: boolean` prop:默认 false → 默认 pre 限高 220px + 内滚(单 detail 展开);true → pre 不限高,由调用方外层统一滚动(view-all 模式由 `ToolCallsSection` 的 ExpandedView 传入,避免嵌套滚动条) | ~165 LOC |
| `tool/types.ts` | `ToolCallExecutionStatus`、`ToolRenderer`（slot-only,无 id/match）、`ToolSlotProps` / `ToolChipSlotProps` / `ToolOutputSuccessSlotProps`，复导出 shared 的 ShellToolArgs/Result、WriteToolArgs/Result | ~85 LOC |
| `tool/toolRendererRegistry.ts` | `Map<toolName, ToolRenderer>`：`registerToolRenderer(toolName, renderer)` / `resolveToolRenderer(toolName)`；一个工具一个坑，O(1) 查询，幂等去重 | ~40 LOC |
| `tool/registerBuiltins.ts` | 集中注册五个内置 renderer（`app` / `shell` / `write` / `web` / `subagent`）。子命令分派由各 renderer 自己负责，不在本表 | ~30 LOC |
| `tool/index.ts` | barrel；import 副作用触发 `registerBuiltinToolRenderers()`；导出 ToolCallsSection / ToolDetailView / registry helpers | ~25 LOC |
| `tool/renderers/shell/index.tsx` | `shellRenderer` —— `chipLabel` (`shell: <cmd>`) + `InputBlock`（终端 prompt+command）+ `OutputSuccessBlock`（stdout/stderr/exit 终端块） | ~110 LOC |
| `tool/renderers/write/index.tsx` | `writeRenderer` —— `inputArgsText`（细，仅 fileUri）+ `OutputSuccessBlock`（可点击文件卡片，图片走 `ImageViewerAtom.open`、其余走 `useOpenFilePreview()`） | ~110 LOC |
| `tool/renderers/app/index.tsx` | `appRenderer` —— 顶层接管所有四个 slot；所有 app 子命令走稳定的通用 cmdline/result fallback | ~45 LOC |
| `tool/renderers/app/cmdline.ts` | App 命令展示工具：`extractAppCmdline`、`firstNonFlagTokens`、`tokenizeForView`。**只**给 renderer 用，不带语义保证 | ~90 LOC |
| `tool/renderers/subagent/{parse,RunCard,RunMessagesDialog,RunResultDetails,index}.tsx` | 顶层 `subagent` renderer：只做 `{ outcome }` 展示解析；单 run 卡片关联 live state、查询 metadata、显示 formal result 并发起单次 cancel；详情按钮以局部 Dialog state 懒取 parent-owned Domain transcript，关闭释放数据，复用 MarkdownView 和简化只读 tool 块，不进主 chat cache/render-items pipeline。`story/tools/subagent-run.stories.tsx::Transcript` 以 production Dialog + Electron mock 展示 user/assistant/tool transcript | ~700 LOC |
| `agent-editor/AgentDelegationTab.tsx` | 普通 Agent delegates 选择器：hot `agents.atom` 候选、cold delegates、dangling 可移除行，以及 Agent 创建/设置导航 | ~205 LOC |
| `message/MermaidDiagram.tsx` | 延迟加载的 Mermaid 图表渲染器，支持全屏 | — |
| `message/ImageGallery.tsx` | `<IMAGE_REGISTRY>` 分段解析 + `ImageGalleryNew` 渲染；图 src 经 [`lib/mediaUrl.ts`](../../lib/mediaUrl.ts) `toImageDisplaySrc` 同步解析（`local://`/`knowledge://`→media://、远程 http(s) 原样），**不再** `fetch`+base64 缓存 | — |
| `interactive/RequestCard.tsx` | 时间线原生渲染器，用于待处理的 `approval`、`choice` 和 `form` 交互；Tailwind className 直接内联，无独立样式模块 | — |
| `interactive/SearchCard.tsx` | `web research` 的轻量控制卡；三态由全局 `activeChanged` 单飞信号驱动——未开窗时「开始研究」(`startRequest` 才真正打开 research window)、其他研究占用窗口时置灰等待、已开窗时聚焦/取消；含 query/source 计数 | — |
| `interactive/AuthCard.tsx` | 时间线原生渲染器，用于交互式 CLI 认证提示（设备码、链接、倒计时），使用相同的卡片样式系统 | — |
| `chat-input/ComposeInput.tsx` | 主聊天输入组件；负责新消息编写、附件/截图、上下文 @-提及、模型选择、thinking level 选择与取消生成；会话错误由 ribbon 统一展示 | ~290 LOC |
| `chat-input/EditInlineInput.tsx` | 内联编辑输入组件；负责编辑已有 user message、附件补充、确认弹窗触发和重新生成提交 | ~220 LOC |
| `chat-input/shared/useFileHandling.ts` | 输入组件共享 hook;封装拖拽、Electron 文件选择器、浏览器 fallback、截图捕获与 MIME 推断。**附件只「暂存」不落盘**:`addImage`/`addFile`/`addOffice`/`addOthers` 都把原始 `File` 存进 atom 内 `pendingFiles` WeakMap(image 另存 objectURL 预览),附件 URI/dataUrl 留空占位。真正物化推迟到 `attachmentManager.createMessage(text, ctx)`(= 点击发送):image 走 `processImage` IPC(main 用 sharp 按【解码尺寸】判别 inline/sandbox)、其余走 `copyFileToSandbox` → `local://uploads/<name>`。落盘 = 发送,取消/不发则永不进 session `files/uploads/`。**图片阈值判别已搬到 main**(`startup/ipc/attachment.ts` 的 `processImageAttachment`,`width×height×4` vs `IMAGE_INLINE_MAX_BYTES`=256KB,≈256×256;不看编码字节 —— PNG 对截图压得太好):小图回原始 base64 建 `image`+`dataUrl` 内联随消息发送(不压缩),大图落 sandbox 建 `image`+`fileRef` 附件(原图;非 opaque),annotation 把 URI+尺寸告诉模型,模型按需 `read local://uploads/<name>.png`(read backend 按 OpenAI vision 指南压缩后回 base64)。useFileHandling 不再读尺寸、不再判别 | ~300 LOC |
| `chat-input/shared/useChatInputState.ts` | 输入组件共享 hook；按 `scope`('compose' \| 'edit')选定一组**模块级** textarea/attachments/valid atom（`composeXxxAtom` / `editXxxAtom`，定义在 `Textarea.tsx` / `Attachments.tsx`），并在卸载时清理草稿状态。**不再用工厂动态建 atom** —— compose 与 inline-edit 各自一组具名模块级 atom 即可隔离（框架按 store 懒初始化，每个 atom 持有独立闭包状态），避免旧工厂把 per-mount atom 槽位永久泄漏进 `WithStore` 根 store | 小 |
| `chat-input/shared/transformMentions.ts` | 纯函数；把 `[@knowledge://...]`、`[@local://...]`、`[@skill://...]` 这些 mention bracket 形态转换为 markdown inline code（防止前后符号被解析为粗体/链接）。三种 scheme 统一走 internal URI，一条正则覆盖 | 小 |
| `chat-input/ThinkingLevelSelector.tsx` | 单聊会话的 thinking level 选择器（pi-ai `ThinkingLevel` 枚举：`minimal/low/medium/high/xhigh`）；仅在活跃模型支持 ≥2 个等级时渲染；写入 `chat.agent.thinkingLevel`，通过 `updateAgent` 持久化到 AGENT.md front-matter。dropdown 顶部 "Auto" 项写入 `thinkingLevel: null` 清除字段，回到 provider 默认 —— 前端不假装知道默认值。运行时由 `pi.streamSimple({ reasoning })` 翻译给各 provider，不再走旧的"Claude→high / GPT→medium"启发式 | 小 |
| `chat-input/ContextMenu.tsx` | @-提及下拉菜单，用于文件、技能和工作区项目 | — |
| `chat-input/chatInputCommands.ts` | compose 聊天输入子树的**命令句柄注册表**（替代旧 `chatInput:selectFiles`/`chatInput:screenshot`/`context:mentionSelect`/`context:skillMentionSelect` window 事件）。consumer 挂载期用 `useRegisterComposeTextHandle`（compose Textarea，`enableContextMenu` 门控，edit 实例不注册）/ `useRegisterComposeFileHandle`（ComposeInput）注册自身方法到模块单例（内部经 ref 转发器，handler 闭包变化免重注册）；producer 直接调 `composeTextCommands.insertMention` / `composeFileCommands.*`（selectFiles/screenshot）。**不是 state**——命令式句柄，无 atom/无 re-render/无 nonce diff，只把无类型 `CustomEvent` 换成编译期类型契约 + 可跳转引用。选注册表而非 context：producer 之一 `context-menu.atom.ts` 非 React 组件读不了 context | 小 |
| `../filePreview/ChatFilePreviewOverlay.tsx` | 聊天页 inline 文件预览浮层;满铺 chat-content 区(连 ComposeInput 一起遮住),纯订阅 `ChatFilePreviewAtom` 渲染。聊天子树被 `ChatFilePreviewScope` 包裹，producer 经 `useOpenFilePreview()` 就近命中此 atom（不再监听 `fileViewer:open` 事件）。**外壳薄,渲染共用 `filePreview/FilePreviewPanel`** | — |
| `chat-side.atom.ts` | `WorkspaceExplorerAtom`（右侧工作区侧栏可见性 + reveal）的 atom；`effectiveToggle` 打开侧栏时顺带 `ChatFilePreviewAtom.cancel()`。文件预览状态已迁到 `filePreview/filePreview.atom.ts` | — |
| `edit-message.atom.ts` | 内联用户消息编辑状态的 atom | — |
| `agent-area/AgentList.tsx` | 左侧边栏 agent 列表，支持搜索、置顶和创建入口 | ~2.3K LOC |
| `agent-editor/AgentBasicTab.tsx` … `AgentSystemPromptTab.tsx` | 单个 agent 的设置标签页（Basic 的 description、Delegation、上下文增强、知识库、MCP 服务器、技能、系统提示词） | — |
| `agent-area/AgentEditingView.tsx` + `useAgentEditorState.ts` + `AgentEditorTabs.tsx` | 设置页外壳、跨 tab dirty/save-all 状态和 tab 分发；三者分离以保持组件文件小于 500 行 | — |
| `agent-editor/AgentSettingsNav.tsx` | 设置页左侧导航；数据驱动的 `NAV_ITEMS`（key/label/Lucide 图标），每项带未保存改动小圆点。**新增 Tab 时在此加一项** | 小 |
| `agent-editor/AgentPresetsTab.tsx` + `PresetEditorDialog.tsx` | 「Quick Prompts」标签页：编辑聊天空态的预设提示词（增删改）。**已接持久化** —— 读写走 `zero/presetPrompts.ts`，落 AGENT.md front-matter `zero.preset_prompts`（cold 字段，`agentDetail.atom` 后端），与 `zero/index.tsx` 空态经 `agent:updated` 事件实时同步。CRUD 即时生效，不进 Save All 管线。新建/编辑走 `PresetEditorDialog`（含图标选择器），删除走 `AlertDialog` 二次确认 | 中 |
| `zero/index.tsx` + `zero/PresetPromptCard.tsx` | 聊天空态：渲染预设提示词卡片。点击卡片**不发送**，而是把 `prompt` 写入 `composeTextAtom`（ComposeInput 草稿真值）填入输入框；输入框已有内容时弹 `AlertDialog` 确认覆盖。插图区为占位待填 | 中 |
| `zero/presetPrompts.ts` + `zero/presetIcons.ts` | 预设提示词的数据层：类型 `PresetPrompt`（源真值 `@shared/persist/types`，`iconKey` 为 `string`）+ `usePresetPrompts`（订阅 `agentDetail.atom` 的 `zero.preset_prompts`，缺席回退空数组）+ `presetPromptActions`（CRUD → `persistApi.patchAgentFront(agentId, { zero })` 整段覆盖写）+ `MAX_PRESET_PROMPTS`。`presetIcons.ts` 是 iconKey→Lucide 组件的注册表（36 key + 兜底）。**数据链路已收敛到本文件，上层组件只依赖 hook/actions 不感知后端** | 小 |
| `agent-editor/AddScheduleOverlay.tsx` | 共享的定时任务创建/编辑对话框；由 `components/agent-side/jobs/JobsView` 与 `JobRunsView` 调用 | — |
| `agent-editor/scheduleTemplates.ts` | 内置定时任务模板，被 `NewJob` 的下拉消费 | — |
| `workspace/WorkspaceExplorerSidepane.tsx` | 工作区侧栏容器：Agent Knowledge（`knowledge://`）+ Session Deliverables（`local://`）两个 `FileExplorerSection`；`local://` 由 main 按 session ID 跨 regular / job-run 定位各自物理目录 | — |
| `workspace/FileExplorerSection.tsx` | 单个文件根的展示外壳（折叠态 / 头部 / body 分发）；`readOnly` 目录允许浏览 / 打开 / 复制路径，禁止拖入、添加、粘贴和删除；全部逻辑下沉到 `useFileExplorerSection` | — |
| `workspace/useFileExplorerSection.ts` | FileExplorerSection 的数据/副作用 hook：URI→路径解析、文件树加载与懒加载、文件监听、拖拽复制、菜单动作；所有写入口在 hook 内再次执行 `readOnly` capability 门控 | — |
| `workspace/FileTreeExplorer.tsx` + `FileTreeNodeItem.tsx` | 可展开文件树容器 + 单节点；展开态持久化到 localStorage；只读节点的上下文菜单不提供 Delete；图标查表在 `fileTreeIcons.tsx` | — |
| `workspace/PasteToWorkspaceDialog.tsx` | 将 AI 生成内容保存到工作区文件的对话框 | — |

## 架构

### 组件层级
```
ChatView (URL→会话同步)
  └─ ChatViewContent (会话切换占位, 回放)
       ├─ ChatContainer (滚动管理, 渲染项迭代)
       │    └─ ChatRenderItemComponent (按类型分发每项)
       │         ├─ AssistantMessage → MarkdownView (流式 + 已完成统一)
       │         ├─ UserMessage → MarkdownView + AttachmentList
       │         ├─ ToolCallsSection (工具调用折叠面板)
       │         ├─ InteractiveRequestCard
       │         ├─ InteractiveAuthCard
       │         └─ EditInlineInput (内联编辑模式)
       ├─ ComposeInput (主编辑器)
       ├─ ChatWorkspaceSideOverlay (右侧工作区浮层, 覆盖消息区; ChatViewContent 本地组件)
       └─ ChatFilePreviewOverlay (满铺 inline 文件预览, 覆盖整个 chat-content; 复用 filePreview/FilePreviewPanel)

`ChatView` 位于 `/agent/:agentId/:sessionId` 与 `/agent/:agentId/job/:jobId/:sessionId` 路由下。两条路由在 `entries/main.routes.tsx` 用同一个 `ChatView` 组件渲染，由路由显式注入 `kind?: 'regular' | 'job'` prop（默认 `'regular'`）；**kind 是 UI capability boundary，不只是 hydration 选项**：regular 走 `loadChatSessionSnapshot/markSessionRead`，可 compose / edit / retry；job 走 `loadJobRunSnapshot/markJobRunRead`，是只读回放，隐藏 compose、message edit、Retry 和 cancel。已结束 run 的 `JobRunChat` 可经 persist IPC 克隆为新 regular session 并导航过去；原 run 仍是只读调度历史。两条 IPC 路径在 persist 层完全物理隔离，禁止写“按 sessionId 万能取”的混查 helper。

新建 regular session 不经过 `location.state` 中的隐式 intent：入口直接用 `newEntityId('s')` 生成 ID，并导航到完整 `/agent/:agentId/:sessionId` URL。ID 只在 renderer 分配；首次发送消息前不持久化，因此未发送即离开的会话不会留下空壳。`/agent/:agentId` 表示 sessions 子屏无选中，ChatView 明确将 current session 置空。

### 消息渲染管线
消息通过清晰的管线流转：
1. `ChatView` 通过 `CurrentSessionStatus.use()` 读取会话状态
2. `ChatViewContent` 通过 `useMessagesWithStream()` 接收消息，并可选地通过回放系统包装消息
3. `ChatContainer` 以 props 接收最终消息列表，通过 `lib/chat/render-items-manager.ts` 中的 `RenderItemsManager` 将 `Message[]` 转换为类型化的 `ChatRenderItem[]`，并管理自动滚动
4. `ChatRenderItemComponent` 按类型将每项分发到对应的渲染器
5. 所有 markdown 都经过 `MarkdownView`（同步无 state） — 流式与已完成走同一渲染路径，区别仅在容器外层的 `streaming` CSS 类


### 累计 token 消耗
`ContextBadge` 不使用 `contextState.lastTokenUsage`（它只表示最近一次调用后的 context window 占用）。会话 cache 初始化或消息被截断重写时，由 `SessionManager.aggregateTokenUsage()` 汇总当前 `RenderMessage[]` 中每条 assistant 的持久化 `usage`；流式 assistant 收到 `complete` chunk 时写入该次 provider usage 并立即重算。展示时 `Prompt input = uncached input + cache read + cache write`：Claude 等 provider 会将被缓存的首轮 prompt 或工具结果计入 cache write/read，而非 uncached input。故工具循环的每次 LLM call 都会计入，旧历史缺少 usage 时按零兼容；编辑截断掉的历史也不再计入。
### 渲染项系统
`lib/chat/render-items-manager.ts` 把扁平的 `Message[]` 转换成类型化可辨识联合类型的渲染项 `ChatRenderItem[]`,并在 `recompute` 时通过 `reuseUnchangedItems()` 按 stable key 对齐前后两版,**复用未变化的 item 引用**,这样下游 `ChatRenderItemComponent` 的 `React.memo` 浅比较才能跳过未变项。

**坐标系契约**:
- `item.index` 在所有 item 类型(user / assistant / tool-calls-section / activity-*)上都是 **items 数组下标**(render-items 坐标)。从前 user/assistant 的 `index` 携带的是 messages 坐标,tool-section 携带的是 items 坐标 —— 同名异义的隐性 bug,已纠正。
- messages 坐标系仅用于 domain 操作(如 `editMessageAtom.save` 的 `messages.slice(0, index)` 截断),**不再走私进 render items**。
- dim / live 这类位置派生量由 iterator(`ChatContainer`) 在 render-items 坐标系里现算,以 props 形式下发,**不再 bake 进 item**。

该模块还集中处理:
- **合并连续的 "空文本 + 仅 tool_calls" 的 assistant** 成单个 `tool-calls-section`(一段连续操作流);`sectionKey = tool-section-${firstOwnerId}__${lastOwnerId}` 编码端点 owner,owner 链变 → key 变 → 自动失效复用。带文本的 assistant 会先冲掉前一条 merge 链,再把自己的 tools 起成**新的可合并链** —— 后续相邻的 empty-only tool 链会并入这条链(视觉上文本已在 section 上方,紧邻工具段合并更自然)。只有 user 消息或下一条带文本 assistant 才切断 merge 链。
- 把 assistant message 的 derived 文本与 schedule job id 提前抽出并缓存(WeakMap by message reference),喂给 `AssistantMessage` 的 `cleanedText` / `scheduleIds` props
- 通过 `extractFilePathsFromText` 扫描 assistant 收尾文字里的 `local://` / `knowledge://` URI 与绝对路径,作为产出文件卡片的唯一数据源

**位置派生量在 `ChatContainer` 里现算**(以 `useMemo`/iterator-local 形式):
- `editingItemIndex` —— 编辑中的用户消息在 `renderItemsWithActivity` 里的下标。由 `editingMessage?.id` 在 render-items 里现找,不再借用 `editingMessage.index`(那是 messages 坐标,只服务 `save()` 截断)。
- `lastSectionIndex` —— 整列里末位 tool-section 的下标。
- 迭代时为每项算出 `shouldDim = idx > editingItemIndex`、`isLive = item 是 tool-section ∧ idx === lastSectionIndex ∧ chatStatus 非 idle`,作为 props 下发给 `ChatRenderItemComponent`。
- `ToolCallsSection` 只收 `isLive: boolean`(连 `chatStatus` 都不再要),状态函数 3 行: `allDone? completed : !isLive? interrupted : (有部分? partial : executing)`。

### 滚动管理
`useChatAutoScroll` 把滚动所有权与反向消息布局分离：外层 `.chat-container-reverse` 是滚动容器，内层反向流包装器处理 `column-reverse`。触发跟随滚动的入口：
- **首屏 / 会话切换 / 用户消息追加** → `messages.length` effect，`force: true`
- **流式 chunk** → 监听 streaming message 的文本长度变化（`streamingMessageTextLength` memo + effect），每个 chunk 顺势 `scheduleLatestScroll`
- **ResizeObserver** → 在 1500ms `stabilizationWindow` 内对 message-flow 容器尺寸变化做兜底
- **手动跳转** → `JumpToLatestItem` 仅在 `JumpToLatestAtom.isAvailable` 时可点；其 action 递增 request nonce，`useChatAutoScroll` 消费后执行强制滚动

`ChatViewContent` 不参与跳转状态传递：ribbon 与滚动 hook 通过 `ribbon/JumpToLatest.tsx` 内联的 atom 通信，DOM refs 与实际滚动仍完全归 `useChatAutoScroll` 所有。

流式与 ResizeObserver 驱动的滚动都会受 `userScrolledAwayRef` 阈值保护（用户上滚后不再被拉下去），只有 `force: true` 调用才会复位该标志。`agentId` 不得用来驱动重置 — 会话历史切换可以在相同的聊天标识下发生。

### 会话切换
`ChatView` 和 `ChatViewContent` 将会话切换视为显式的瞬态 UI 状态。当路由目标 `chatSessionId` 处于活跃状态但其缓存快照尚未就绪时，消息列表被替换为中立的 "Opening chat history..." 占位符，编辑器被锁定。

### 交互式请求
交互式请求是聊天会话原生的。待处理的请求通过 `InteractiveRequestCard` / `InteractiveSearchCard` / `InteractiveAuthCard` 在时间线中内联渲染，提交或解决后从 UI 中移除。审批请求在每个项目都有批准/拒绝决定后自动提交。选择请求和表单 select 类控件渲染为响应式的换行选项网格，带有 `Other` 回退卡片用于自定义文本输入。`interactive-search` 的网页浏览本体在独立 research window，聊天卡片只承载 focus/cancel 和状态摘要。

### 用户消息编辑
内联用户消息编辑通过 `editMessageAtom` 管理。`ChatContainer` 为正在编辑的消息渲染 `EditInlineInput`；底部主输入则保持为 `ComposeInput`，必要时通过 `isInputLocked` 进入只读锁定态。编辑确认对话框由 `AgentLayout` 挂载 `ModifyMsgConfimOverlay`；`EditInlineInput` 通过其导出的 **imperative confirm atom** `inlineEditConfirmAtom.request({title, description}): Promise<boolean>` 发起确认（旧的 `chatInput:confirmInlineEditRequest/Result` 两段式 window 事件已移除）；skip 逻辑在 `request` 内同步读 `confirmationSettings.inlineEditRegenerate.skipConfirmation`（持久化在 `profile.json`）。

Agent avatar 的 `EmojiPicker` 采用 shadcn `Dialog`：打开时聚焦 Confirm，Radix 负责焦点陷阱、Esc 关闭与触发器焦点恢复；两个调用入口保持不变。

### 侧边栏和编辑器
Agent 侧边栏（`agent-area/`）是 `AgentPage` 中的兄弟面板，而非 `ChatView` 的子组件。Agent 编辑器（`agent-editor/`）在导航到 `/agent/:agentId/settings/*` 时出现。**定时任务（jobs / runs）UI 已搬迁到 [`components/agent-side/`](../agent-side/ai.prompt.md)**：alarm 切换 + jobs CRUD + runs 列表 + AddScheduleOverlay 全部走那条主从二级视图，URL 是真相源；`SchedulesSidepane` / `AgentSchedulesTab` / `SchedulesContentView` 已物理删除。

## 常见变更
| 场景 | 需要修改的文件 | 备注 |
|------|---------------|------|
| 修改 markdown 渲染（代码块、链接、表格、Mermaid） | `message/MarkdownView.tsx` — `markdownComponents` 对象 | 全部消息（assistant / user）共享同一渲染器，一处修改全局生效 |
| 添加新的工具调用展示 | 顶层工具：新建 `tool/renderers/<tool>/index.tsx`（export `<tool>Renderer: ToolRenderer`）+ `tool/registerBuiltins.ts` 加一行 `registerToolRenderer('<tool>', <tool>Renderer)`。子命令域（如 `app mcp`）：新建 `tool/renderers/app/<sub>/`（export 子 renderer + `resolve<Sub>Renderer(tokens)` 路由），在 `tool/renderers/app/index.tsx` 的 `pickSubRenderer` 加一行委派 | 三个点位 chip / input / output 每个可细（label / argsText / resultText）或粗（Chip / InputBlock / OutputSuccessBlock）二选一覆盖；output 额外允许 OutputExecutingBlock。**注意**：粗粒度 block 一旦提供就完全接管该 slot，多层兜底由 renderer 自己内部承担 |
| 修改委派 run 卡片 / IPC | `tool/renderers/subagent/`、`renderer/ipc/subagentRun.ts`、`shared/ipc/subagentRun.ts`、main/preload bridge | live event 必须匹配 profile + parent Agent/session + correlationId，已知结果后再核对 subrunId；terminal/reload 以 tool result 和 audit data 为事实，当前轮数上限读取 `data.execution.policy`；messages 仅由详情 Dialog 按需查询、关闭即释放 |
| 区分 MCP 工具调用 | `shared/persist/types/message.ts` 的 `ToolCall.mcp` 是 Domain / 历史真值，值为 MCP server 名称；`session/regular.ts` 从本轮 catalog 投影，`streamingTypes.ts` / `session-manager.ts` 保持流式首帧一致；`ToolChip.tsx` 用字段是否存在展示 Plug + 紫色变体,并把 server 名称放进 hover tooltip | 旧历史无 `mcp`，按本地工具样式兼容 |
| 添加新的渲染项类型 | `lib/chat/render-items-manager.ts`（`ChatRenderItem` 联合类型 + `computeRenderItems` + `isSameRenderItem`） + `ChatRenderItem.tsx`（`ChatRenderItemComponent` 分发） | derived 字段一并加入 `MessageDerived` + `reuseUnchangedItems` 复用判定 |
| 修改主聊天输入行为 | `chat-input/ComposeInput.tsx` + `ribbon/ErrorBar.tsx` | 涉及发送、取消生成、模型选择和会话错误展示 |
| 修改内联编辑输入行为 | `chat-input/EditInlineInput.tsx` | 涉及编辑确认、重新生成、编辑态附件与取消按钮 |
| 修改两种输入共享的附件/截图逻辑 | `chat-input/shared/useFileHandling.ts` + `chat-input/Attachments.tsx`(atom) | 同时影响 compose 和 inline edit,两边都要回归。物化推迟到发送:新增 attach 路径(自定义来源等)只需把原始 `File` 交给 `attachmentManager.addXxx`,`createMessage` 发送时统一走 `copyFileToSandbox` 落盘;**切勿在 attach 阶段调 `copyFileToSandbox`**,否则又会未发送先落盘 |
| 修改用户消息附件展示 | `message/AttachmentList.tsx` | image / file / office / others 共用 |
| 更改 approval / choice / form 交互 | `interactive/RequestCard.tsx`、`ChatRenderItem.tsx`、`agentSessionCacheManager.ts` | 待处理请求经 `render-items-manager` 进入渲染流水线，由 `ChatRenderItemComponent` 分发 |
| 添加 agent 编辑器标签页 | `agent-editor/Agent<Name>Tab.tsx`、`agent-area/useAgentEditorState.ts` 的 route/cache/save-all、`agent-area/AgentEditorTabs.tsx` 的分发、`agent-editor/AgentSettingsNav.tsx` 的 `NAV_ITEMS` | 遵循现有标签页外壳模式 |
| 修改滚动行为 | `useChatAutoScroll.ts` hook（由 `ChatContainer.tsx` 消费） | 始终验证基于 `chatSessionId` 的重置；流式跟随由 `streamingMessageTextLength` effect 驱动 |
| 修改 regular / job-run capability | `ChatView.tsx` + `ChatViewContent.tsx` + `ribbon/index.tsx` | job-run 的写入限制由 UI 实现；不支持取消 |

## 联动变更映射
| 变更内容 | 同时需要修改 |
|----------|-------------|
| 新工具调用类型 | `tool/renderers/<tool>/index.tsx` + `tool/registerBuiltins.ts`（顶层），或 `tool/renderers/<parent>/<sub>/` + 父级 `pickSubRenderer`（子命令域） |
| 新渲染项类型 | `lib/chat/render-items-manager.ts`（类型联合 + `computeRenderItems` + `isSameRenderItem` + `getChatRenderItemStableKey`）+ `ChatRenderItem.tsx`（分发） |
| 聊天输入中的新附件类型 | `chat-input/shared/useFileHandling.ts` + `contentUtils.ts`(`ContentPartFactory`)+ `@shared/types/chatTypes`(`UnifiedContentPart`)+ shared constants 中的 `FILE_ATTACHMENT_LIMITS` + `message/AttachmentList.tsx`(渲染分支)+ [`src/main/lib/attachment/`](../../../main/lib/attachment/ai.prompt.md)(若新来源需要新的 main 端 attach 入口) |
| 新交互式请求控件类型 | `interactive/RequestCard.tsx` 或专用卡片 + `@shared/types/interactiveRequestTypes` + `agentSessionCacheManager.ts` + `ChatViewContent.tsx` 分发 |
| 新 agent 编辑器标签页 | `agent-editor/Agent<Name>Tab.tsx` + `agent-area/useAgentEditorState.ts`（路由/cache/save）+ `agent-area/AgentEditorTabs.tsx`（分发）+ `agent-editor/AgentSettingsNav.tsx`（`NAV_ITEMS`） |
| 会话滚动/布局变更 | `ChatContainer.tsx`(容器几何已 Tailwind 化) + `styles/biz/_chat.scss`(scrollbar/inset/data-mode/`:has()` 等无法 Tailwind 化的规则,原 `ChatContainer.scss` 已删,曾暂存于 `globals.css` 尾部,现归入 biz 层) — 始终验证基于 `chatSessionId` 的重置，而非基于 `agentId` |
| Markdown 渲染变更 | `message/MarkdownView.tsx` + `message/MarkdownView.scss`（全局生效） |
| 发送门控逻辑 | `chat-input/ComposeInput.tsx` + `chat-input/EditInlineInput.tsx`（显式 `chatStatus === 'idle'` 守卫）+ 渲染进程发送入口点缓存状态重新检查 |
| `.chat-container-reverse` 左右 inset 改动 | `--chat-pad-x` CSS 变量是唯一写入点(现由 `ChatContainer.tsx` 容器上的 `[--chat-pad-x:36px]` 任意值设定) — 水平 inset 由 `styles/biz/_chat.scss` 里 `.chat-message-flow-reverse > *` 选择器统一加给所有直接子项(替代旧的 `.chat-container-reverse` 自带 padding);`ToolCallsSection` 通过 className 豁免该 padding 自己控制。改值只能改 `--chat-pad-x`;**禁止**删除该变量或在其它地方 hardcode 36px |

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
9. 打开 ContextBadge，确认累计 token 消耗等于当前 assistant 消息的 `usage` 之和；完成一轮流式回复后应立即更新，无需切换会话。
10. 打开 job run：确认输入区显示只读提示、user message 无编辑入口、ribbon 无 Retry；切回 sessions 后 URL 是 `/agent/:agentId`，不会复用 run ID。
11. 无法启动完整聊天流程时，运行 `npm run ladle` 打开 `Chat / Tools` stories：覆盖高度动画、chip、detail、calls section、五个 renderer 与 subagent running/final card；bridge mock 只在 `story/tools/`，不修改生产组件。

## 注意事项

- 聊天输入已拆分为 `ComposeInput`、`EditInlineInput` 和 shared hooks。修改时先确认行为属于哪个场景，不要把 compose 专属逻辑重新塞回 inline edit，反之亦然。
- 已**永久移除**打字机动画、`StreamingV2Message` 组件以及 `renderer/lib/streaming/` 整个配置/监控目录（之前 `uiConfig.showCursor` 默认为 false，整套打字机 + 设备分级优化 + 自适应内存调节都跑空）。流式消息只是不停地把 `cleanedText` 喂给 `MarkdownView`，由 React.memo + 引用复用控制重渲。
- 工具结果消息并不总是最终状态。`streamingComplete === false` 的 `tool` 消息是进行中的快照，仍应渲染为执行状态。
- 交互式认证卡片是有意设计为临时的。当命令结束、超时或用户取消时，时间线卡片应消失。
- `ChatContainer` 不是会话消息的真实来源。消息选择位于 `ChatViewContent`（或回放状态）中；活跃列表通过 props 传递。
- 会话切换不等同于空聊天。在目标会话缓存就绪前，不要显示空状态或零状态 UI。
- 聊天输入的发送可用性必须在 `ComposeInput` 和 `EditInlineInput` 两侧保持一致，且都应基于显式的 `chatStatus === 'idle'`。将缺失的状态视为 idle 会重新打开编辑器在会话状态水合前提交的竞态条件。
- job-run 是 scheduler 产物，不是 interactive chat。**不支持 send、edit、retry 或 cancel**；已结束 run 唯一的继续路径是派生新的 regular session，不能把 run 原地改类型或重用其 id。运行中的 run 必须由 main 拒绝转换；若未来要取消运行，必须由 scheduler 自己持有执行取消句柄，不能复用 `agentChat.cancelChatSession`。
- 内联编辑提交失败是可恢复的聊天错误。如果 `onSubmitEditedMessage` 被拒绝，将消息捕获到 chat-session cache 中，以便 `ErrorBar` 能够渲染它。
- 时间线自动滚动不仅仅由消息数量变化驱动。如果插入了待处理的交互式请求或类似的非消息时间线项，`ChatContainer` 仍需要显式的最新滚动触发（当前由 `ResizeObserver` 稳定窗口兜底）。
- Agent 编辑器标签页路由使用嵌套的 React Router `<Outlet>` — 添加标签页需要同时修改组件树和 `entries/main.routes.tsx`。
- Mermaid 图表作为异步 webpack chunk 延迟加载；避免在同步加载的聊天文件中直接导入 `mermaid`。
- 图片预览走 `ImageViewerAtom`（`ui/OverlayImageViewer`），文件预览走 `useOpenFilePreview()`（`filePreview/filePreviewScope`）——**均已从 `imageViewer:open` / `fileViewer:open` window 事件迁到就近作用域 atom 路由**。文件预览的「聊天 inline vs 全局弹窗」二选一由 React context（`ChatFilePreviewScope` 包住 `ChatViewContent` 子树）决定，替代旧的 capture/bubble + coordinator 单例。新增文件触发源：组件里 `const open = useOpenFilePreview()` 后 `open({name, url, ...})`。
- `.chat-container-reverse` 本身**没有水平 padding** —— 已迁到 `.chat-message-flow-reverse > *` 的子选择器上,通过 `--chat-pad-x` 变量统一。`!px-0` 豁免该 padding,让 `ToolCallsSection` expanded 模式 bg 能天然铺满 chat 全宽。新增直接子元素时自动继承默认 padding;若要做"贴边铺满"效果,加上 `!px-0` 同款豁免类。

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
