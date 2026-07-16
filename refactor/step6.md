# Step 6 — 实现父 Session 下三位序号 Subrun 持久化

> 状态：complete（2026-07-16 用户 review 通过）
> 前置：Step 1 `SubrunId`/`SubAgentRunRequest`/`SubAgentRunResult`、Step 2 Agent IDs、Step 4 parent owner lookup
> 下游：Steps 8、9、11、12、14
> 本步只实现 persist/store，不运行 LLM。

## 1. 为什么独立成一步

Step 8 的新 session 若先用内存 transcript，后续接持久化会重新设计生命周期、恢复和取消。先把 hidden subrun 作为真实 store 做好，session 从第一行消息开始就在最终数据模型上工作。

## 2. Persist 与 Pi 的职责边界

磁盘 I/O 仍遵守 persist 单一所有权：

- shared disk shape 定义在 `src/shared/persist/types/subrun.ts`，并经 `@shared/persist/types` 导出；该文件包含所有会写入 subrun `data.json` 的 ID/request/result/data types；
- main store 为 `src/main/persist/subrun.ts` 的 `Subrun`；
- parent `Session` 暴露最小 `createSubrun` / `getSubrun` / `listSubruns` owner API；
- `Subrun` 直接实现 Step 8 所需 `PersistSessionLike` 最小契约，不继承既有 `Session`，也不进入 SQLite/index/普通 session emit；
- `src/main/pi/subagent` 后续只消费 `@main/persist` 导出的 `Subrun`，不直接散写 fs。

Step 5 已具备输入（delegate-only redesign）：parent session lookup 继续只使用现有 `agentId + sessionId`；delegate context 不携带 parent identity，也不参与 parent store 定位。Step 6 不读取 AsyncLocalStorage。
如果实现发现名称 `subrun.ts` 与其它概念冲突，在本 step review 时改名并级联更新后续文档。


## 3. 物理布局

```text
<parent-session-root>/subruns/
  001/
    data.json
    messages.jsonl
  002/
    ...
```

- parent 可以是 RegularSession 或 JobRun；
- 不创建 `files/`；
- 不写 `regular_sessions` / `job_runs` SQL；
- 不 emit 普通 session index/message append channels；
- 父目录删除/归档/复制的既有目录语义自然包含 subruns，除非该操作明确需要排除。

## 4. 三位 allocator

### Scope

`subrunId` 只在具体 parent session 下唯一。所有 API 至少通过 owner `Session` 实例调用；禁止 `Subrun.get('001')` 这种全局 lookup。

### Allocation

1. 获取 parent session scoped in-memory single-flight lock；
2. 读取 `subruns/` 下符合 `^[0-9]{3}$` 的目录；
3. 取最大序号 + 1，首个为 1；
4. 格式化 `padStart(3,'0')`；
5. 原子创建该目录作为 reservation；EEXIST 则继续下一个；
6. 原子写初始 data.json；
7. 释放锁。

异常/崩溃规则：

- 空的已 reservation 目录不复用，避免同一个 ID 指向两次运行；
- 非三位目录忽略并记录 warning，不猜用户文件；
- `999` 已存在后返回 exhausted error；
- 当前 20 次/session 上限不替代 allocator 的完整 999 边界。

## 5. Data schema

使用 discriminated union 表达状态：

- pending；
- running；
- completed/partial/blocked/failed/cancelled 等 terminal projection。

公共字段：

- `version: 1`、`kind: 'subrun'`、subrunId；
- profileId、parentAgentId、parentSessionId、delegateAgentId；
- request snapshot；
- `createdAt`；`session` 内嵌 `title`、`updatedAt`、`contextState`、`turn`，直接满足 `PersistSessionLike`；
- pending/running/terminal 均为命名 interface 组成的 discriminated union；terminal 带 `startedAt`、`finishedAt` 与正式 `SubAgentRunResult`。

request snapshot 使用 normalized `SubAgentRunRequest`；terminal formal result 使用 `SubAgentRunResult`，不得另造同义字段。

Terminal 状态有 finishedAt + formal result；pending/running 不带伪 terminal 字段。

## 6. Messages 与 adapter

`Subrun` 直接提供 `PersistSessionLike` 所需的：

- append user/assistant；
- append tool response；
- flush 串行化；
- load/rehydrate；
- rewrite messages。

消息沿用 Domain Message、`PersistedJsonLine` 与 `messageWire`；不创建 files 目录、普通 session emit 或 no-op rewrite。`Subrun.start()` 与 `finish(result)` 只维护 data union 的合法 pending → running → terminal 转换；Step 7 负责 result 的不可信输入校验，Step 8 负责 LLM 生命周期调用。

## 7. Crash/reload

- load terminal run 原样返回；
- load pending/running 遗留记录时，不自动续跑或改写；
- Step 9 的 manager bootstrap/query seam 是唯一将 stale running 收敛为 interrupted failed 的事实入口；
- 保留 messages 供详情查看；
- 空 reservation 目录通过 `getSubrun` 的 `incomplete` 显式结果返回，不默默当 completed。

## 8. 查询 API 预留

给 Step 11/12 足够但不超量的 main API：

- get data；
- list metadata（若 UI 真实需要）；
- load messages 独立调用，避免 card 首屏拉 transcript。

本 step 不加 renderer IPC，Step 11 结合 UI 所需 shape 再加，避免过早承诺。

## 9. 不做

- 不运行 LLM；
- 不写 manager/cancel；
- 不加 renderer；
- 不创建 SQL 表；
- 不用 ULID；
- 不扫描/迁移旧 sub-agents 数据；
- 不新增/运行测试，不做端到端测试。

## 10. 静态验证和下游交接

- 已完成 `npm run check:impact -- src/shared/persist/types/subrun.ts src/shared/persist/types/index.ts src/shared/types/subAgentRunTypes.ts src/shared/persist/path.ts src/main/persist/subrun.ts src/main/persist/session.ts src/main/persist/index.ts src/main/pi/subagent/types.ts src/main/pi/subagent/commands/types.ts src/main/pi/subagent/commands/run.ts`、`npm run typecheck` 与 `npm run build`（仅既有 renderer chunk-size warning）；
- `Session.createSubrun/getSubrun/listSubruns` 是唯一 parent owner API；`Subrun` 是 Step 8 的直接 `PersistSessionLike` adapter；
- Step 8 用 `Subrun.start()` 和 `finish(result)` 管理已验证 result 的状态写入；Step 9 用 `create` 的 exhausted 结果、`list` 的 persisted count 与 `get` 的 stale record 做 admission/recovery；
- 已更新 persist 与 `pi/subagent` 文档、`unit-test.md`、`context.md`。

## 11. Review 门禁

停止等待用户 review。用户若改变序号复用、上限或 crash 语义，Steps 8、9、11、12 全部 needs-replan。
