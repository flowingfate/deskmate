// 给 doctor agent / CLI 注入的 schema 自描述。
// 任何 schema 变更必须同步更新这里的文档。

export const LOG_SCHEMA_DOC = `
Table: app_logs
Columns:
  id           INTEGER PK
  ts           INTEGER (ms epoch)
  level        INTEGER  10=trace 20=debug 30=info 40=warn 50=error 60=fatal
  process_type TEXT     main | renderer | worker
  pid          INTEGER
  component    TEXT     dotted module path, e.g. "chat.streaming"
  msg          TEXT
  trace_id     TEXT?    cross-process correlation id
  span_id      TEXT?
  parent_span_id TEXT?  for nested spans; NULL on top-level span
  err_message  TEXT?
  err_stack    TEXT?
  window_id    INTEGER?
  life_id      INTEGER  auto-assigned per app lifecycle (start → quit). Same value for every log row in one run; increments (mod maxRows) +1 across runs. Use to isolate one run's logs from others when debugging.
  fields       TEXT?    JSON of remaining structured fields

Indexes:
  idx_logs_ts        (ts)
  idx_logs_level_ts  (level, ts)
  idx_logs_comp_ts   (component, ts)
  idx_logs_trace     (trace_id) WHERE trace_id IS NOT NULL
  idx_logs_life      (life_id)

Full-text:
  app_logs_fts(msg, err_stack, fields)  -- FTS5 unicode61
  Query via: id IN (SELECT rowid FROM app_logs_fts WHERE app_logs_fts MATCH ?)

Tips:
  - Always filter by ts range first; the DB can be very large.
  - Component supports glob via LIKE — caller should pre-translate '*' to '%'.
  - Use level >= ? for minimum-level filtering.
`.trim();
