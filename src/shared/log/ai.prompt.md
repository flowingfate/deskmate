<!-- Last verified: 2026-06-08 (revised: LogQueryFilter 新增 lifeId 字段 + traceId 段) -->
# Shared 日志类型与查询库（`src/shared/log/`）

> 跨进程共享：types（main / renderer / worker / CLI / viewer 都引用）+ 纯函数查询库（buildWhere / buildQuery / format / parser）。
> **不依赖** Electron / Node electron API，可在 bun CLI 与 main 进程同时跑。

## 关键文件

| 文件 | 职责 |
|------|------|
| `types.ts` | `LogLevel` / `ProcessType` / `LogFields` / `Logger` / `LogRow` / `LogQueryFilter` / `LEVEL_NUM` / `NUM_LEVEL` |
| `trace.ts` | `newTraceId` / `newSpanId`（6/4 字符 Crockford32，唯一性范围 life_id；**不**复用 `src/shared/persist/id.ts` 的 `ulid()`） + `class Tracer`（derive/bind/fields；Tracer.noop 兜底）+ `interface TraceContext`（跨进程信封 `{tid,sid,psid?,startAt}`，`tracer.serialize()` / `Tracer.deserialize(ctx)` 收发）|
| `query/index.ts` | barrel 导出（CLI 一次性 `from '@shared/log/query'`） |
| `query/filter.ts` | `globToLike` / `buildWhere(filter)` / `buildQuery(filter)`；唯一的 WHERE 生成器 |
| `query/parser.ts` | `parseDuration / parseSince / parseUntil`（`10m` `2h` `@iso` 语法） |
| `query/format.ts` | `formatJson / formatText / formatMarkdown`（LogRow[] 渲染） |
| `query/schema.ts` | `LOG_SCHEMA_DOC` 字符串常量；schema 改动**必须**同步更新此处 |
| `query/__tests__/` | filter / parser / format 单测 |
## 架构

**`buildWhere(filter)`** 是唯一的 WHERE 生成器：返回 `{ where: string[], params: unknown[] }`。所有 reader（main 的 doctor `read_app_logs`、viewer 的 `query/stats` handler、CLI 的 `query/tail/top-errors/stats`）都基于它，避免「shared 改 schema，doctor/CLI 忘改」漂移。

**`buildQuery(filter)`** = `buildWhere` + `ORDER BY ts DESC LIMIT ?`。返回 `{ sql, params }` 直接喂 `db.prepare(sql).all(...params)`。

字段命名约定（代码 → sqlite）：`mod → component`、`tid → trace_id`、`sid → span_id`、`psid → parent_span_id`、`dur` 不入列（落 `fields` JSON）。schema 完整定义见 [src/main/log/ai.prompt.md](../../main/log/ai.prompt.md)。

**LogQueryFilter** 关键点：
- `minLevel` 与 `levels` 互斥；都给时 `levels` 优先（SQL IN 精确集合）。doctor `read_app_logs` 的 `level: string[]` 入参映射到 `levels`，不再折成 minLevel。
- `componentGlob` 自动经 `globToLike` 转 `LIKE` pattern（`*→%`、`?→_`，`% _ \` 反向转义）。
- `grep` 是 **SQLite FTS5 MATCH 表达式**，透传给 `app_logs_fts`；`:` `-` 是 FTS5 操作符，业务原始词需包双引号。
- `traceId` 严格匹配 `trace_id = ?`，走 `idx_logs_trace` 部分索引。
- `lifeId` 严格匹配 `life_id = ?`，走 `idx_logs_life`；viewer LifePicker 默认入口，按 life 隔离视角能屏蔽跨重启的旧日志。
- `sinceId` 是增量游标（`id > ?`），viewer follow 模式专用，按 id 严格单调（同 ms 多条不会漏 / 不会重）。

## 常见变更

- **加 filter 维度**：改 `LogQueryFilter` 类型 + `buildWhere` 加分支 + 单测。reader 自动跟上。
- **改 schema**：见 [src/main/log/ai.prompt.md](../../main/log/ai.prompt.md) 的协变映射；本目录的 `query/schema.ts` `LOG_SCHEMA_DOC` 是 LLM/人查字段语义的入口，必须同步更新。
- **新 format**：加到 `query/format.ts` 并在 barrel 导出；CLI 的 `parseFormat` 加分支。

## 注意事项

- 本目录**不能 import electron / better-sqlite3 / bun:sqlite**。CLI 用 bun:sqlite，main 用 better-sqlite3，二者只共享纯查询字符串。
- `LogFields` 索引签名是 `[key: string]: unknown` —— 业务任意 named field 自动落 `fields` JSON 不必改类型。已知系统注入字段（`processType / windowId / pid`）显式声明，仅为文档化「落库记录里会出现什么」。
- `LEVEL_NUM` / `NUM_LEVEL` 数值约定与 pino 对齐（10/20/30/40/50/60）。改动会破坏所有历史 db。

## 相关文件

- [src/main/log/ai.prompt.md](../../main/log/ai.prompt.md) — 写路径与 schema 维护
- [src/renderer/log-viewer/ai.prompt.md](../../renderer/log-viewer/ai.prompt.md) — viewer 消费者
- [ai.prompt/log-analysis.md](../../../ai.prompt/log-analysis.md) — CLI 用法、字段语义速查
- `scripts/log.ts` —— CLI 入口，最大一坨消费者，所有子命令都基于 `buildWhere / buildQuery`
