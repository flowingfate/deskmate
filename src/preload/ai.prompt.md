<!-- Last verified: 2026-07-16 (Step 11：subagentRun audit/cancel/state bridge 已接入) -->

当前目录有 2 个入口文件，每个对应一个窗口：
- `./main.ts`：主窗口
- `./screenshot.ts`：截图工具窗口

所有 IPC 通道均已采用 [类型化 IPC 通讯方案](../shared/ipc/ai.prompt.md) 中定义的类型安全框架。每个命名空间的 invoke 函数独立封装在 `./<name>/invoke.ts` 中，由对应的 preload 入口文件引用和注册。

`subagentRun` 是主窗口专用 namespace：`invoke` 仅白名单 `getRunData` / `cancelRun`，并复用主桥已有 `on` / `off` 接收 `stateUpdate`；不暴露 transcript 或文件路径。
