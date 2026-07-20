<!-- Last verified: 2026-07-20 -->
# lib/research/extract — 共享网页内容提取（一个 DOM + 一段注入提取器 → ExtractedContent）

> 把「网页 → 给 LLM 的高质量 Markdown」抽成全 web 工具共享的一等能力。
> 两个消费者（`web research` 的 live view、`web fetch` 的 headless 渲染）**差别只在
> DOM 从哪来**；提取器（Readability + turndown）只在页面里跑，产出统一形态。

## 保留原则（不可漂移）

```txt
一个 DOM + 一段注入提取器 → ExtractedContent
```

DOM 来源可换（live view / headless），提取器唯一、注入产物唯一、输出形态唯一。
新增任何「网页 → 文本」消费者都接这条链，**不再**各写一套 innerText/正则提取。

## 关键文件

| 文件 | 职责 | 进程 |
|---|---|---|
| `src/preload/extract/extractor.ts` | 注入脚本**源码**：Readability + turndown + gfm，挂 `window.__deskmateExtract(opts)`。**零 export，纯全局副作用**；对 `document.cloneNode(true)` 跑 Readability（破坏性，不动真实 DOM）；非文章页退「最长可见容器 innerText」兜底。 | 独立 IIFE 子构建源 |
| `extractFromWebContents.ts` | main 侧：对**任意** WebContents 先 probe、未注入才前置整包 SRC，再调 `__deskmateExtract`；截断（`MAX_CHARS_PER_SOURCE=40_000`）、字段兜底，返回 `ExtractedContent`。 | main |
| `injectScript.ts` | 运行时读取并 memoize `out/preload/extractor.js` 字符串。 | main |
| `HeadlessRenderer.ts` | `web fetch` 用的**有界并发隐藏渲染池**（`maxConcurrent=3` + FIFO 队列）：渲染 URL → 等加载 settle → `extractFromWebContents`；窗口注册为 Crash Recorder `research/headless-renderer` auxiliary，正常清理先标记 expected termination 再 `win.destroy()`。 | main |
| `@shared/types/extractedContent.ts` | 统一产物形态 `ExtractedContent` + `ExtractionMethod` union。 | shared |

## 架构（代码不自明的关键不变量）

### 注入产物 = 独立单 entry IIFE 子构建
`extractor.ts` 经 `scripts/vite/extractor-plugin.ts` 挂在 **preload 段**的 build 插件里串跑一次
（dev/build 两边都走 preload build → 两边都产出 `out/preload/extractor.js`）。**不**复用 preload 多
entry CJS 段：preload 段 `formats:['cjs']`，CJS 注入页面会因 readability 的 CJS interop 残留
`require`/`exports` 而炸。IIFE 单 entry 结构上不含 `require(`/`module.exports`，天然可注入。
**构建后硬校验**产物无 `require(`/`module.exports`/`exports.` 且挂了 `window.__deskmateExtract`，
不通过即红。

### 运行时注入 = 动态 executeJavaScript（非 preload 注册）
提取只在「点 Add / fetch」那一刻需要，外部页面 view **故意不挂** Deskmate preload（安全隔离）。
`extractFromWebContents` 读 IIFE 字符串 → cheap probe `typeof window.__deskmateExtract` →
未注入才前置 SRC → `window.__deskmateExtract(opts)`。**同页反复 Add 不会每次重 parse 数十 KB 依赖**。
默认 main world（Readability 需要的 DOM API 都在；提取器无状态/无 Node/IPC，被页面看到也无害）。

### selectedTextOnly 选区模式
`extractFromWebContents({ selectedTextOnly:true })` 只取页面内 `selection`，`method='selection'`，空则抛。
否则取 Readability/兜底的 `markdown`，`method='readability' | 'readability-fallback'`，空则抛。

### HeadlessRenderer 安全/隐私（headless 比 raw fetch 更像真人）
- **内存** partition（`'agent-fetch'`，**无 `persist:`** → 不落盘、cookie/cache 不跨 fetch 残留）。
- 不注入 Deskmate preload；`sandbox:true`；权限请求/检查全 deny；`will-download` 拦下载。
- 默认 `blockMedia`：经 `webRequest.onBeforeRequest` 拦 image/media/font（per-webContents，因 partition session 共享）。
- `loadURL` + `did-finish-load` 后短 settle（`SETTLE_MS=400`）兼顾 SPA；硬超时 + `signal` abort → `destroy` + reject。
- 每个隐藏 `BrowserWindow` 都注册到 Crash Recorder；正常 cleanup 在 destroy 前标记 expected termination，真正 renderer gone 仍保留 auxiliary Incident identity。
- 用完即 `destroy`（v1 不复用 webContents，避免跨源状态污染）。

## 常见变更

- **改提取质量**（turndown 配置 / 元数据回填 / 兜底策略）：`src/preload/extract/extractor.ts`，改完
  **必须 `npm run build`** 重产 `extractor.js`（注入产物是构建期 bundle，源码改了不重建不生效）。
- **改并发/超时/媒体策略**：`HeadlessRenderer.ts` 的 `MAX_CONCURRENT` / `SETTLE_MS` / `blockMedia`。
- **加新消费者**：调 `extractFromWebContents(wc, opts)`，不要另写提取脚本。

## 注意事项

- `ExtractedContent` **不落盘**，但 `InteractiveSearchSource = ExtractedContent & { sourceId }` 是
  **跨进程 IPC 契约**，字段调整需 clean cutover 全消费者（renderer/kernel/manager）+ typecheck 兜底。
- `extractor.ts` 改动**必须重 build**；只改源码不重建，运行时仍读旧 `out/preload/extractor.js`。
- 注入产物若被改出 `require(`/`module.exports`，build 校验会硬 fail —— 别 external 那三个依赖。
- main world 跑在不可信页面里，页面可篡改 `Array`/`JSON`/原型链干扰提取（最坏只是抽取结果差，
  无 Node/IPC 不致 RCE）；isolated world 加固列 backlog。

## 相关文件

- 设计文档：`headless-page-extract.md`（仓库根）
- research live view 消费者：[`lib/research/ai.prompt.md`](../ai.prompt.md)
- web fetch 消费者：`pi/appcmd/builtins/web/kernel/fetchWebContent.ts`
- 构建插件：`scripts/vite/extractor-plugin.ts` · 路径常量：`lib/buildPaths.ts`（`INJECT_PATH`）
