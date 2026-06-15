<!-- Last verified: 2026-06-05 -->
# Main 日志子系统（`src/main/log/`）

> Main / worker 进程统一日志入口：pino → worker_thread transport → better-sqlite3。
> 也是 dev-only Log Viewer 窗口的主进程侧。

## 关键文件

| 文件 | 职责 | 大小 |
|------|------|------|
| `index.ts` | `log` proxy（lazy）、`flushLogs / closeLogs / getLogDbPath / isDevLogDb`、`normalize`（err 归一） | ~155 |
| `pino.ts` | `createPinoLogger`：pino + transport 工厂；测试环境返回 silent logger | ~80 |
| `sqlite-transport.cjs` | pino transport worker：纯 CJS、自包含 DDL、prepare(INSERT) 批写、rotate（max(id)-min(id) 估行数 + 范围 DELETE） | — |
| `viewer-window.ts` | Log Viewer BrowserWindow 单例 + dev-only `logViewer` IPC handler + 250ms poll `max(id)` 广播 `appended` | ~180 |

> Schema 是 **单份 source of truth**：在 `sqlite-transport.cjs` 内联。文档/查询层通过 `src/shared/log/query/schema.ts` 的 `LOG_SCHEMA_DOC` 字符串向 CLI / Doctor agent / Viewer 暴露字段语义。

## 架构

**写路径**：
```
log.info({ mod, msg, ... })
   ↓ Proxy lazy init → ensureRoot()
   ↓ normalize(fields)  ← err 抽 message/stack/name/code
   ↓ pino logger
   ↓ thread-stream → worker_thread
   ↓ sqlite-transport.cjs: prepare(INSERT).run(...)
   → app_logs (WAL)
```

`log` 是 Proxy：取属性才触发 `ensureRoot()`，避免 bootstrap 前调用崩溃。**测试环境**（`VITEST=true` / `NODE_ENV=test`）改为 eager 初始化普通对象 + pino `level: silent`，让 `vi.spyOn(log, 'info')` 可用，绕开 worker_thread（vitest 下会崩）。

**flush 语义**（容易踩坑）：
- `log.flush()` → `thread-stream.flush(cb)` —— **真等 worker ack 落盘**。pino 自带的 `p.flush(cb)` 只 fsync 主线程到 worker pipe，不等 worker 写完。
- `flushLogs()` —— 兼容未初始化（无 root logger 时 no-op），用于「导出 debug 包 / Log to Disk 菜单 / sqlite reader 入口（doctor tools / CLI 不行，CLI 跨进程没法触发）」。
- `closeLogs(timeoutMs=5000)` —— 退出专用：flush + transport.end + once('close')，带超时不阻塞退出。`onBeforeQuit` 调用，外层再裹 10s 兜底。**调用后不可再用 logger**。

**字段命名**：`mod / tid / sid / psid / dur / err` 是代码侧短名（日志调用密集，长名噪音翻倍）。sqlite 列仍是完整词 `component / trace_id / span_id / parent_span_id`，由 `sqlite-transport.cjs` 做映射；`dur` 不入列，落到 `fields` JSON。`psid` 用于嵌套 span（sub-agent / 工具内再触发 LLM 等场景）重建调用树；顶层 span 留空。schema 改动必须同步 `sqlite-transport.cjs` 内联 DDL + INSERT_SQL + `src/shared/log/types.ts` `LogRow` + `src/shared/log/query/schema.ts` 文档串 + `src/shared/log/query/filter.ts` `SELECT_FIELDS` + `src/main/lib/doctor/tools/traceTimeline.ts` SELECT 列表 + `scripts/log.ts` 两处 SELECT 列表。

**life_id**：标记一次完整 app 生命周期（启动 → 彻底退出）。worker transport 启动时算一次（`SELECT life_id FROM app_logs ORDER BY id DESC LIMIT 1` → `prevLife`），整轮 app 共享该值并由 transport 写入每条 INSERT。调用方无感、无法 override。值域 `[1, maxRows]`：`(prevLife % maxRows) + 1`，保证不超过日志行数上限、永不为 0。分析时用 `WHERE life_id = ?` 把单次运行的日志与其他运行隔离。

**dev / prod 判别**：`isDevLogDb()` 是唯一入口（`!app.isPackaged`）。任何「我要根据 dev/prod 选 db 路径或做特殊处理」的 reader 都用它，避免各处独立 `app.isPackaged` 漂移。

## 常见变更

- **加新字段**：
  1. 业务侧 `log.info({ mod, msg, 新字段 })` 即可；非保留字段自动落 `fields` JSON。
  2. 若需独立 sqlite 列：改 `sqlite-transport.cjs` DDL + `INSERT_SQL` + extract 映射 + `src/main/log/index.ts` `normalize`（如有抽取逻辑）+ `src/shared/log/types.ts` `LogRow` + `src/shared/log/query/schema.ts` 文档串。
- **改 transport 行为**：编辑 `sqlite-transport.cjs`，**注意它不走 vite 打包**——`scripts/vite/copy-files-plugin.ts` 在 main build 的 `closeBundle` 钩子原样拷到 `out/main/`；electron-builder 的 `asarUnpack` 列表内此文件必须 unpack 到 `app.asar.unpacked/out/main/`（pino worker 用绝对 `require()` 加载，asar 内 require 在 worker 上下文不可靠）。
- **改 viewer 实时通知**：当前 `viewer-window.ts` 用 250ms poll `max(id)`。viewer 关闭后停 poll、关 db。考虑改 fs.watch 或 worker postMessage 前先看历史决策——poll 是已知最简方案。

## 注意事项

- **bootstrap 顺序**：`src/main/bootstrap.ts` 必须最早执行 `app.setPath('userData', ~/.deskmate)`，否则 pino transport 把 db 写到默认 `~/Library/Application Support/Electron/`。bootstrap 与 main 是两个独立 bundle，`bootstrap.ts` 末尾用 `createRequire(__filename)('./main.js')` 动态 require 避免 rolldown 把 main hoist 到 bootstrap 之前。
- **登录关键路径**：`log:write` IPC handler 注册必须在 `setUpIPC` **最早一句**，避免 preload ready 后丢失启动期 renderer 日志。
- **viewer 是 dev-only**：`registerLogViewerIPC()` 内首句 `if (app.isPackaged) return;`，菜单项 `visible:!app.isPackaged`。生产包不存在 viewer 通道与窗口。
- **viewer 自身防成环**：viewer preload **故意不**暴露 `log.write`。viewer 内部异常只走 `console.warn`，不调 `log.error`。否则 viewer error → IPC → sqlite → broadcast → viewer 刷新 → viewer error 死循环。

## 相关文件

- [src/shared/log/ai.prompt.md](../../shared/log/ai.prompt.md) — types / query lib（buildWhere / buildQuery）
- [src/renderer/log-viewer/ai.prompt.md](../../renderer/log-viewer/ai.prompt.md) — viewer 渲染层
- [src/shared/ipc/ai.prompt.md](../../shared/ipc/ai.prompt.md) — `log:write` 单向 send 与 `logViewer` 命名空间
- [ai.prompt/log-analysis.md](../../../ai.prompt/log-analysis.md) — CLI / GUI / doctor 工具用法

## 协变映射

| 修改 | 同步检查 |
|------|---------|
| `sqlite-transport.cjs` DDL / INSERT_SQL | `src/shared/log/types.ts` `LogRow`；`src/shared/log/query/schema.ts` 文档串；`src/shared/log/query/filter.ts` `SELECT_FIELDS`；`src/main/lib/doctor/tools/traceTimeline.ts` SELECT 列表；`scripts/log.ts` 两处 SELECT 列表 |
| `sqlite-transport.cjs` 文件本身 | `scripts/vite/copy-files-plugin.ts`；`electron-builder.config.js` 的 `asarUnpack`；`src/main/log/pino.ts` 路径解析 |
| `LogFields` 新字段 | `normalize` 抽取逻辑；`src/shared/log/types.ts` 索引签名（业务字段自动落 `fields` JSON 不必改类型） |
| `viewer-window.ts` IPC | `src/shared/ipc/logViewer.ts` 契约；`src/preload/log-viewer.ts` 白名单；`src/renderer/log-viewer/api.ts` 绑定 |
