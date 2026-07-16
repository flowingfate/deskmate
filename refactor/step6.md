# Step 6 — 实现父 Session 下三位序号 Subrun 持久化

> 状态：待执行
> 前置：Step 1 SubrunId/result types、Step 2 Agent IDs、Step 4 parent owner lookup
> 下游：Steps 8、9、11、12、14
> 本步只实现 persist/store，不运行 LLM。

## 1. 为什么独立成一步

Step 8 的新 session 若先用内存 transcript，后续接持久化会重新设计生命周期、恢复和取消。先把 hidden subrun 作为真实 store 做好，session 从第一行消息开始就在最终数据模型上工作。

## 2. Persist 与 Pi 的职责边界

虽然新业务主体在 `src/main/pi/subagent`，磁盘 I/O 仍遵守 persist 单一所有权：

- shared persist type：例如 `src/shared/persist/types/subrun.ts`；
- main store：例如 `src/main/persist/subrun.ts`；
- parent Session 暴露最小 `create/get/listSubrun` owner API；
- `src/main/pi/subagent` 后续只消费 store/PersistSessionLike adapter，不直接散写 fs。

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
- createdAt/startedAt；
- contextState/turn metadata（仅满足 BaseSession adapter 的必要部分）。

Terminal 状态有 finishedAt + formal result；pending/running 不带伪 terminal 字段。

## 6. Messages

复用 Domain Message 和 `messageWire`：

- append user/assistant；
- append tool response；
- flush 串行化；
- load/rehydrate；
- 如 BaseSession 需要 rewrite，明确支持或通过 adapter 提供，不能用 no-op。

Subrun store 应实现 Step 8 所需的 `PersistSessionLike`，或者提供一个窄 adapter；选择后在 progress 记录唯一接口。

## 7. Crash/reload

- load terminal run 原样返回；
- load pending/running 遗留记录时，不自动续跑；
- 由 store 或 Step 9 bootstrap/query seam 收敛为 failed/interrupted，必须只有一个事实入口；
- 保留 messages 供详情查看；
- 空 reservation 目录以 corrupt/incomplete 明确处理，不默默当 completed。

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

- typecheck/build/impact；
- 静态检查 ID API总是带 parent scope；
- 更新 persist 与 `pi/subagent` 文档；
- 更新 `unit-test.md` allocator/state/message 候选。

在 progress 记录：最终路径、allocator lock owner、reservation 语义、data union、PersistSessionLike adapter。Step 8 必须直接使用这些真实接口；Step 11/12 根据最终 query API 改计划。

## 11. Review 门禁

停止等待用户 review。用户若改变序号复用、上限或 crash 语义，Steps 8、9、11、12 全部 needs-replan。
