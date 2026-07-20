<!-- Last verified: 2026-07-20 (Incident export invoke) -->

当前目录有 3 个入口文件，每个对应一个窗口：
- `./main.ts`：主窗口
- `./research.ts`：研究窗口
- `./screenshot.ts`：截图工具窗口

所有业务 IPC 通道均采用 [类型化 IPC 通讯方案](../shared/ipc/ai.prompt.md) 中定义的类型安全框架。每个命名空间的 invoke 函数集中在 `./invoke/<name>.ts`，由对应的 preload 入口文件引用和注册。

主窗口的 `profile` 能力来自 `windowProfile.ts`：main 在创建 `BrowserWindow` 时通过 `webPreferences.additionalArguments` 注入 `--deskmate-profile-id=<id>`；preload 在页面和 React 代码执行前从 `process.argv` 解析它，并直接暴露冻结的 `window.electronAPI.profile.id: string`。没有 profile owner IPC、没有切换事件；打开另一个 Profile 必须创建新主窗口。这个机制只承载“窗口创建后永远不变、renderer 必须在首次模块求值时取得”的业务 identity；不注入 `windowId`（main 从 IPC sender 得到、日志已自动写入）、window role（入口本身已知）或 Profile 配置（它们应走精确路由的 IPC）。

`subagentRun` 是主窗口专用 namespace：`invoke` 白名单 `getRunState` / `getRunMessages` / `cancelRun`，并复用主桥已有 `on` / `off` 接收 `stateUpdate`；query 与 push 共用 `SubAgentRuntimeState`，messages 仅以完整 parent identity 返回 Domain `Message[]`，不暴露文件路径。

`app` namespace 只暴露受控的 `listCrashIncidentsForExport` / `exportCrashIncident` 给 About 页：前者返回语义摘要，后者按 Incident ID 导出。不存在 renderer crash status、breadcrumb、DB path 或 artifact path 能力。
