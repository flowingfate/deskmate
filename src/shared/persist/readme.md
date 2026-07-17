# Shared Persist

`src/shared/persist/` 包含 main、renderer 与 worker 共享的持久化 schema 和纯数据工具；不依赖 Node 或 Electron API。

- `types/index.ts` 是所有持久化 schema 的唯一公共入口。
- `types/` 按磁盘资源域拆分：`profile`、`settings`、`auth`、`agent`、`session`、`message`、`schedule`、`resource`、`subrun`、`thinking`。
- 新增任何会写入本地磁盘的字段或结构时，先在对应 `types/` 模块定义，再由 `types/index.ts` 统一导出；不得从 `src/shared/types/` 反向引用运行时数据形态。
- 运行时算法、文件 I/O 和主进程 store 仍分别属于 `src/main/`；此目录只承载 schema 与无环境依赖的纯数据工具。
