<!-- Last verified: 2026-06-07 -->
# 日志分析指南

## 概述

Deskmate 的日志由 `pino` 收集，经 worker_thread transport 异步写入本地 SQLite（`app_logs` 表 + FTS5 索引）。
所有进程（main / renderer / worker）共用同一张表，靠 `process_type / window_id / pid` 区分来源，靠 `life_id` 区分不同的 app 启动周期。
查询入口有三个：

| 入口 | 适用 |
|------|------|
| **CLI** `bun scripts/log.ts <sub>` | 在终端做临时分析、grep、tail、聚合 |
| **GUI** `Develop → Open Log Viewer`（`Cmd/Ctrl+Alt+L`） | 浏览 / 过滤 / 看 trace 时间线 |
| **Doctor agent** 工具 `read_app_logs` / `get_log_schema` / `trace_timeline` | LLM 自助诊断 |

得出结论前**始终检查响应顶部的 `[Scope]` 与 `[DB]` 行**：`[DB] last entry at <iso> (Xs ago)` 告诉你最新事件距 now 多久；若差距大（>分钟级），日志反映的是上一次运行，应重启应用再查。

---

## 日志位置

| 模式 | 文件 | 行为 |
|------|------|------|
| dev | `~/.deskmate/logs/dev.db` | 跨启动累积；写入 level `debug` |
| prod | `~/.deskmate/logs/app.db` | 跨启动累积；写入 level `info` |

两者都靠 worker 内 200k 行滚动控制体量（超额时按 id 升序删最早 10%）。

旁路文件：`*.db-wal` / `*.db-shm`（WAL 模式产物，禁直接读）。
路径以 `bootstrap.ts` 把 Electron `userData` 覆写为 `~/.deskmate` 为前提；CLI 复用 `src/shared/constants/userDataDir.ts` 的 `USER_DATA_DIRNAME` 常量。

---

## Schema（核心字段）

```
app_logs(
  id            INTEGER PK AUTOINCREMENT,
  ts            INTEGER 毫秒 epoch,
  level         INTEGER  10/20/30/40/50/60 = trace/debug/info/warn/error/fatal,
  process_type  TEXT     'main' | 'renderer' | 'worker',
  pid           INTEGER,
  component     TEXT     业务模块名（即代码里的 `mod` 字段，如 chat.streaming）,
  msg           TEXT,
  trace_id      TEXT?    跨进程链路 id（代码里 `tid`）,
  span_id       TEXT?    （代码里 `sid`）,
  err_message   TEXT?    error 对象的 message,
  err_stack     TEXT?    error 对象的 stack,
  window_id     INTEGER? renderer 的 webContents id,
  life_id       INTEGER  本次 app 生命周期 id（启动→彻底退出共享同一值；跨启动 +1，对 200k 取模再 +1，值域 [1, 200000]）,
  fields        TEXT?    剩余结构化字段 JSON（如 dur / errName / errCode / 业务字段）
)

索引：
  idx_logs_ts        (ts)
  idx_logs_level_ts  (level, ts)
  idx_logs_comp_ts   (component, ts)
  idx_logs_trace     (trace_id) WHERE trace_id IS NOT NULL
  idx_logs_life      (life_id)

全文索引：
  app_logs_fts(msg, err_stack, fields) USING fts5 unicode61
  通过：id IN (SELECT rowid FROM app_logs_fts WHERE app_logs_fts MATCH ?)
```

字段命名约定（代码侧 → sqlite 列）：`mod → component`、`tid → trace_id`、`sid → span_id`、`dur` 不入列，落到 `fields` JSON。

### life_id：隔离单次运行 ⚠️ 排查 bug 时优先使用

`life_id` 标记一次完整 app 生命周期（启动 → 彻底退出）。同一次启动内所有进程（main / renderer / worker）的日志共享同一 `life_id`；下一次启动 +1（对 200k 取模，永不为 0、永不超过日志总行数）。由 transport worker 启动时计算并自动写入，调用方无感、无法覆盖。

**典型用法 —— 排查 bug 时先锁定 life_id，避免跨运行混杂干扰**：

```sql
-- 1) 拿到当前 / 最近一次运行的 life_id
SELECT life_id FROM app_logs ORDER BY id DESC LIMIT 1;

-- 2) 列出最近 N 次运行（看每次的时间窗 / 行数）
SELECT life_id,
       MIN(ts) AS started, MAX(ts) AS ended,
       COUNT(*) AS rows,
       SUM(level >= 50) AS errors
FROM app_logs
GROUP BY life_id
ORDER BY life_id DESC
LIMIT 5;

-- 3) 只看某次运行
SELECT * FROM app_logs WHERE life_id = ? AND level >= 40 ORDER BY ts;
```

CLI / Doctor agent 当前的 filter flag（`--since / --level / --component / --trace / --grep`）**没有** `--life` 短路径：
- 在 CLI 里通过 `bun scripts/log.ts sql "... WHERE life_id = ?"` 走自定义 SQL。
- 在 Doctor agent 里 `read_app_logs`（stats/sources/entries 三模式）不支持 life_id 过滤；如需精准锁某次运行，先用 `read_app_logs(mode="stats")` 拿时间窗，再用 `from/to` 把窗口收紧到那次启动的时间段（通常等价）。或在排查时引导用户重启 → 立刻调 `read_app_logs`，此时 db 里 `life_id = max(life_id)` 即本次。

---

## CLI（`scripts/log.ts`）

```bash
bun scripts/log.ts <subcommand> [options]
```

子命令：

| 子命令 | 说明 |
|--------|------|
| `query [opts]` | 过滤查询，返回日志行 |
| `trace <traceId>` | 按 trace_id 取一条链路（按时间正序） |
| `top-errors [opts]` | 错误聚合 Top-N（默认 `minLevel=error`） |
| `tail [opts]` | 250ms poll 新行；尊重所有 filter flag |
| `schema` | 输出 `LOG_SCHEMA_DOC`（供 LLM/人查字段语义） |
| `sql "<SELECT ...>"` | 只读连接直跑 SELECT/WITH |
| `stats [opts]` | 行数 + 按 level / component 聚合 + 磁盘占用 |

通用 flag（`query / top-errors / tail / stats` 都支持）：

| flag | 示例 / 语义 |
|------|------------|
| `--since` | `10m` / `2h` / `@2026-05-30T10:00:00` |
| `--until` | 同 `--since` 语法 |
| `--level` | `warn,error` = IN 集合（精确）；`warn+` = minLevel；`warn` = 仅 warn |
| `--component` | glob，`chat.*` / `*Manager`；`% _` 自动转义 |
| `--trace` | trace_id 过滤 |
| `--grep` | **FTS5 MATCH** 表达式；`:` `-` 是操作符，原始词包双引号：`'"timeout: mcp"'` |
| `--limit` | `query` 默认 500；`top-errors` 默认 20；`tail` 忽略 |
| `--format` | `json` / `text` / `markdown`（默认 json；`trace` 默认 text） |

DB 路径：`DESKMATE_LOG_DB` 环境变量优先；否则按 `NODE_ENV` 选 `dev.db` / `app.db`。

### 常用模式

```bash
# 最近 10 分钟 warn+
bun scripts/log.ts query --since 10m --level warn+

# 链路展开
bun scripts/log.ts trace 0d8f4b1c-...

# Top 错误（含 fatal）
bun scripts/log.ts top-errors --since 1h

# 实时跟随 chat 模块
bun scripts/log.ts tail --component "chat.*"

# 自定义 SQL
bun scripts/log.ts sql "SELECT component, count(*) c FROM app_logs WHERE level>=50 GROUP BY 1 ORDER BY c DESC LIMIT 10"
```

---

## GUI Log Viewer

仅 dev 启用。`Develop → Open Log Viewer`（`Cmd/Ctrl+Alt+L`）。

- **Logs** 视图：toolbar（since / level / component / grep + Live 开关）+ 虚拟滚动表 + 详情抽屉。
- **Traces** 视图：按 `process_type` 分通道的 SVG 时间线 + hover card + 错误标红。
- **Errors / Stats / Saved**：占位待实装。
- 实时：viewer 打开期间 main 进程 250ms poll `max(id)`，通过 `logViewer.appended` 广播到 renderer 增量拉取。viewer 关闭即停 poll。

跨视图跳转：Logs 详情里点击 `traceId` → 切到 Traces 视图并 focus 该 trace（一次性 focus，消费后清空）。

---

## Doctor agent 工具

Doctor agent 直接通过工具调用 sqlite，不需要人工运行 CLI：

| Tool | 用途 |
|------|------|
| `read_app_logs` | 三模式：`stats` / `sources` / `entries`，参数映射到 `buildQuery` |
| `get_log_schema` | 输出 `LOG_SCHEMA_DOC` |
| `trace_timeline` | 按 trace_id 拉链路，附 staleness 检查 |

两个 sqlite-touching tool 在入口先 `await flushLogs()` 把 worker buffer 落盘，响应顶加 `[DB]` / `[Scope]` 行——LLM 看见 staleness 就该自行决定是否重启应用再查。

---

## 推荐工作流

0. **锁定运行（排查 bug 必做）** — `sql "SELECT life_id, MIN(ts), MAX(ts), COUNT(*) FROM app_logs GROUP BY life_id ORDER BY life_id DESC LIMIT 5"` 找到目标 `life_id`，后续所有查询带上 `WHERE life_id = ?`，避免跨运行串扰。
1. **看整体** — `stats --since 1h` 看行数 / 级别分布 / top component。
2. **缩范围** — 用 `--since / --component / --level` 限定窗口。
3. **抓异常** — `top-errors --since 1h` 看高频错误；用 `--grep '"keyword"'` 在 msg / stack / fields 里找。
4. **拉链路** — 拿到 traceId → `trace <id>` 看时间线。
5. **持续观测** — `tail --component foo --level warn+`。

---

## 常见场景

### 启动失败
```bash
bun scripts/log.ts query --since 5m --level error+ --limit 50
bun scripts/log.ts query --component "startup*" --level warn+
```

### 聊天 / Agent 错误

主链路用 `chat.*` 命名前缀（`chat.send` / `chat.ipc` / `chat.turn` / `chat.llm` / `chat.tool` / `chat.compress` / `chat.compress.summary` / `chat.subturn` / `chat.recv`），都带 `tid` 与 `sid`，从 renderer 发消息一直串到 main 收尾。

```bash
# 一次聊天 turn 的所有 span（按 tid 反查；tid 取 chat.send 行的 fields.tid）
bun scripts/log.ts trace <tid>

# 主链路全量 warn+（含 IPC / LLM / tool / compress）
bun scripts/log.ts query --component "chat.*" --level warn+

# 只看 LLM 调用时延 / 错误
bun scripts/log.ts query --component chat.llm --level warn+

# Top 失败工具
bun scripts/log.ts sql "SELECT json_extract(fields,'$.toolName') AS tool, count(*) AS n FROM app_logs WHERE component='chat.tool' AND json_extract(fields,'$.isError')=1 GROUP BY tool ORDER BY n DESC LIMIT 10"

# 按 sessionId 过滤
bun scripts/log.ts query --grep '"<sessionId>"'
```

### MCP 工具问题
```bash
bun scripts/log.ts query --component "mcp.*" --level warn+
bun scripts/log.ts query --component "mcp.*" --grep '"timeout"'
```

### 性能 / 慢路径
```bash
bun scripts/log.ts sql "SELECT component, json_extract(fields,'$.dur') AS dur, msg FROM app_logs WHERE json_extract(fields,'$.dur') > 1000 ORDER BY dur DESC LIMIT 50"
```

### 实时跟随
```bash
bun scripts/log.ts tail --component "chat.*"
bun scripts/log.ts tail --level error+
```

---

## 相关文档

- [src/main/log/ai.prompt.md](../src/main/log/ai.prompt.md) — pino + transport + viewer-window 内部细节
- [src/shared/log/ai.prompt.md](../src/shared/log/ai.prompt.md) — types / query lib / format
- [src/renderer/log-viewer/ai.prompt.md](../src/renderer/log-viewer/ai.prompt.md) — viewer 渲染层
- [src/shared/ipc/ai.prompt.md](../src/shared/ipc/ai.prompt.md) — `log:write` 单向 send + `logViewer` invoke/event 通道
