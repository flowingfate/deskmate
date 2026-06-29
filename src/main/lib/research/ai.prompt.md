<!-- Last verified: 2026-06-30 -->
# lib/research — `web research` 的 research window 子系统

> human-in-the-loop 网页研究：agent 出 query，用户在可见窗口里搜索、浏览、
> 挑来源，Deskmate 只读取用户**明确确认**的 live page 文本。是 `web search`
> （Tavily API）撞风控 / 无 key / 需用户授权筛源时的**降级兜底**，不是自动搜索。

## 定位边界（不可漂移）

```txt
用户的眼睛负责 SERP 解析；Deskmate 负责把用户确认的网页变成可引用 Source。
```

是 `Human-in-the-loop Web Research fallback`，**不是** `free automatic web search`。
自动搜索负责效率（`web search` → Tavily）；`research` 负责可信、授权、兜底。
两者不要合并定位。

## 关键文件

| 文件 | 职责 | 进程 |
|---|---|---|
| `ResearchWindowManager.ts` | app 级单例。pending 注册 + lazy-open + **串行单飞**（同一时刻仅 1 个 active window）+ 多 `WebContentsView` tab + source 增删去重 + confirm/cancel + `activeChanged` 广播 | main |
| `extractLivePage.ts` | 薄封装：调共享 `extract/extractFromWebContents`（保留选区模式），套 `sourceId` 即得 `InteractiveSearchSource` | main |
| `../../pi/appcmd/builtins/web/research.ts` | AppCommand：参数解析 / 校验 / human·json 输出 | main |
| `../../pi/appcmd/builtins/web/kernel/research.ts` | orchestration：`eventSender===null` fail-fast → `humanLoopRequest('interactive-search')` → `registerPending`（不开窗）→ 等确认/取消/abort | main |
| `../../startup/ipc/research.ts` · `@shared/ipc/research.ts` · `src/renderer/ipc/research.ts` | research renderer ↔ main typed IPC 契约 + handler + binding | 三进程 |
| `src/preload/research.ts` · `src/preload/research/invoke.ts` | research window **专属** preload（最小权限：只暴露 `research` + `log`，不复用 main preload） | preload |
| `src/renderer/research.tsx` · `research.html` | research window UI：tab strip + sources 侧栏 + confirm/cancel | renderer |

## 架构（代码不自明的关键不变量）

### 网页不渲染进 `research.tsx`
`research.tsx` 只画「边框」（标题栏 + tab 条 + 右侧 Sources 侧栏）。中间的网页是
main 端 `WebContentsView` 按 bounds **叠放**在 `BrowserWindow` 上的（`CHROME_HEIGHT = 76`
顶部、`SIDEBAR_WIDTH = 420` 右侧让出空间）。切 tab = 改哪个 view 可见 + 重排 bounds，
不是 React 重渲染。改窗口布局 = 改 `ResearchWindowManager` 的 bounds 计算，不是改 tsx。

### lazy-open + 串行单飞
- 工具调用**不自动开窗**：`registerPending` 只登记 + 让 chat 渲染 SearchCard。用户在卡片
  点「开始研究」(`startRequest` IPC) 才真开 window。由用户注意力串行驱动 —— 这也是
  `research` 不设 `--timeout` 的原因。
- 同一时刻**只有一个** active research window。manager 强校验拒绝开第二个；`activeChanged`
  事件广播 active 状态，其余 session 的 card 置灰等待（UI 仅提示，**强约束落在 main**）。
- 软上限：`MAX_PENDING_REQUESTS = 16`（防失控 agent 循环堆积）、`MAX_SOURCES = 8`。

### 外部网页 view 沙箱隔离
外部网页 `WebContentsView` 配 `nodeIntegration:false` / `contextIsolation:true` /
`sandbox:true` / `partition:'persist:agent-search'`，**不注入 Deskmate preload**。
控制 UI 的 research IPC 只暴露给 research renderer，不暴露给外部网页。

### 选区门控 = 单向 console 标记桥（隐私关键）
`SELECTION_PROBE_SCRIPT` 注入外部页面，监听 `selectionchange`，仅在「有/无选区」**布尔翻转**
时经 `console.debug('${SELECTION_MARKER}' + '0|1')` 上报。main 从 console-message 读这个布尔
来启用/禁用「Add selected text」按钮。**不含选区文本、不落盘、不发 agent、不向外部页面注入
任何 IPC/preload**。选区文本只有在用户**点击** Add 时才经 `extractLivePage(selectedTextOnly)` 抽取。

### 内容抽取（已切共享提取层）
`extractLivePage` 调 `extract/extractFromWebContents`：选区优先（`method:'selection'`），否则对
`document.cloneNode(true)` 跑 **Readability** 提正文 → turndown 转 Markdown（`method:'readability'`），
判非文章页则退「最长可见容器 innerText」（`method:'readability-fallback'`）。保留 title / url /
siteName / excerpt / byline / publishedTime / lang / capturedAt / method / charCount
（`MAX_CHARS_PER_SOURCE=40_000` 截断）。整页来源按 `normalizeSourceUrl`（去 hash 片段）**去重**，
判据 `method !== 'selection'`；选区来源（同页不同选区）是合法的不同 source，不去重。
`InteractiveSearchSource = ExtractedContent & { sourceId }`，提取链与 `web fetch` 共用。

## 常见变更

- **加搜索引擎**：`InteractiveSearchEngine` 类型 + `buildSearchUrl`（目前只 `bing` / `baidu`，
  取国内可直达、质量可用）。
- **改窗口布局**：`ResearchWindowManager` 的 `CHROME_HEIGHT` / `SIDEBAR_WIDTH` + bounds 计算，
  不是 `research.tsx`。
- **改抽取策略**：现已并入子目录 `extract/`（Readability + turndown）——改提取质量改
  `src/preload/extract/extractor.ts`（改完必须重 build）；研究侧只管去重/排序/确认，`extractLivePage.ts`
  仅是薄封装。保持 selection 优先、`MAX_CHARS_PER_SOURCE` 截断不变。

## 注意事项

安全/隐私约束 —— **必须保持**：

- 不自动批量解析 SERP；不绕过 CAPTCHA / Turnstile / 风控页；不读未确认页面；不读系统浏览器页面。
- 外部网页 `WebContentsView` 永不获得 Deskmate preload API；控制 IPC 不暴露给外部网页。
- 后台 / scheduler 路径**必须 fail-fast**（`eventSender===null` → `action:'unavailable'`），
  不能伪造交互结果。
- 选区门控只回传布尔，永不回传选区文本（见上）。
- confirm 前展示隐私提示。

坑：

- abort 经 `args.signal` → `cancelRequest(callId)`；orchestration `finally` 必 `finishRequest`，
  否则 active 不释放、后续 session 永远置灰。

## 相关文件

- 工具系统设计：[`ai.prompt/tool-system.md`](../../../../ai.prompt/tool-system.md)
- 共享内容提取链（Readability + turndown，与 `web fetch` 共用）：[`extract/ai.prompt.md`](./extract/ai.prompt.md)
- web 能力域（`search`/`fetch`/`download`/`research` 注册表）：[`pi/appcmd/ai.prompt.md`](../../pi/appcmd/ai.prompt.md)
- human-loop 请求契约：`@shared/ipc/human-loop` + `@shared/types/interactiveRequestTypes`
