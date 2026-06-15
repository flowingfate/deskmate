这里为 electron ipc 通讯的中间环节提供 API 逻辑封装

当前目录有 3 个入口文件，每个对应一个窗口：
- `./main.ts`：主窗口
- `./screenshot.ts`：截图工具窗口
- `./toolbar.ts`：悬浮工具栏窗口

所有 IPC 通道均已采用 [类型化 IPC 通讯方案](../shared/ipc/ai.prompt.md) 中定义的类型安全框架。每个命名空间的 invoke 函数独立封装在 `./<name>/invoke.ts` 中，由对应的 preload 入口文件引用和注册。
