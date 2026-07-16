# Step 11 — 新 `subagent` 工具卡片、运行状态、取消与 Audit IPC

> 状态：待执行
> 前置：Step 6 store、Step 7 result、Step 9 manager/tool complete
> 下游：Step 12 Messages Dialog、Step 13 cleanup、Step 14 tests
> 本步交付 reload-safe 的核心运行可视化，不强制展示完整 transcript。

## 1. 为什么先做卡片再决定 Dialog

卡片需要的状态与 Dialog需要的完整 messages体量不同。先完成正式 result、live state、cancel和metadata查询，可以验证详情入口是否能在不重构整个消息渲染管线的前提下追加；这也是 Step 12是否实施的判断依据。

## 2. 开始前 review

1. 阅读 chat tool renderer registry和当前 app/web/shell renderer模式；不打开旧 app/subagent卡片或旧测试作为模板；
2. 从 Step 9 获取最终 manager state/cancel API，并核对 Step 3 已固定的单调用 `{ outcome }` envelope；
3. 从 Step 6获取 parent-scoped subrun query API；
4. 设计 shared IPC，确认 preload四层协变；
5. 组件不得超过500行；所有 tool call 复用同一单任务卡片，不为并行调用复制 batch 展示逻辑；
6. 不启动应用/浏览器，用户负责可视行为验证。

## 3. IPC namespace

新增命名明确且不复用旧 channel 的 `subagentRun` namespace，并更新所有文档：

Main → Renderer：

- `stateUpdate(SubAgentRuntimeState)`；该 union 已强制携带 `profileId + parentAgentId + parentSessionId + subrunId`，terminal `status` 与 `result.status` 对齐。

Renderer → Main：

- `cancelRun(parentAgentId,parentSessionId,subrunId)`；
- `getRunData(parentAgentId,parentSessionId,subrunId)`。

Step 12再决定是否暴露 `getRunMessages`；本 step不让 card预取 transcript。

安全：

- handler按 active profile和parent ownership解析；
- `001` 必须与 parent identity组合；
- unknown/terminal cancel明确返回；
- 不允许renderer传绝对路径。

按 shared/main/preload/renderer标准四层接入，旧 SubAgent CRUD IPC不复用。

## 4. 顶层 tool renderer

新增 `tool/renderers/subagent/` 并在顶层 registry注册 tool name `subagent`：

- parse `list` / `describe <agent-id>` / `run <agent-id> --task ... --expect ...`；run 可选 `--with-parent-summary` / `--max-turns` / `--timeout-seconds`；
- command parser只服务展示，不作为业务安全解析；不得支持旧 name、share-context、spawn/spawn-many 或已删除的 run-many；
- 三条命令 final JSON 都读取 `{ outcome: { kind: 'result' | 'rejected', ... } }`；
- 只有 run 的 `kind: 'result'` 进入 subrun runtime card；list/describe 使用只读 command result 展示，不订阅 runtime state、不显示 cancel；
- run result.status 映射 completed/partial/blocked/failed/cancelled；任意 `kind: 'rejected'` 显示调用拒绝且不伪造 subrunId；
- correlationId匹配各自 parent tool call；run live state按 parent identity + subrunId更新；final response到达后以各 tool result JSON为事实源。

注册新顶层 renderer 后，从生产 registry删除旧 renderer import；确认不可达后整体删除旧 `renderers/app/subagent` 源码，不修改其内部实现。

## 5. 单任务卡片

显示：

- target Agent name/avatar/description（可从 result/state带稳定 display snapshot，或通过 agents atom join；选择后记录事实源）；
- subrun ID，如 `#001`；
- pending/running/completed/partial/blocked/failed/cancelled；
- turn/maxTurns、duration；
- 最近 tool/step和有限 streaming snippet；
- formal content/reason/error/warnings；
- deliverables URI卡片/链接；
- running时 Cancel按钮。

状态用文字+icon，不只颜色。Cancel有loading、disabled和error feedback。

## 6. 并行多调用

- 同一 assistant response 的多个 `subagent` tool calls 各自渲染一张单任务卡片，不合并成 batch card；
- 每张卡片以自己的 toolCallId/correlationId 关联；有正式 result 后再使用 parent identity + subrunId 关联 live/audit 状态；
- 一个调用失败或 rejected 不改变其它卡片；
- 单个 cancel只作用已有 subrunId 的目标 run；
- state event丢失时，每个 call 自己的 final `{ outcome }` 仍可恢复终态。

## 7. Reload与持久化事实源

- 历史父消息中的 final tool result可完整重建终态卡片；
- stale running subrun由 Step 6/9收敛 interrupted，metadata query可显示；
- live progress不要求跨app restart恢复每个delta；
- card不依赖旧 runtimeStates内存才能显示final；
- 无 data记录时显示可恢复错误，不无限loading。

## 8. 详情入口预留

本 step在 card上可以先放“View details”入口，只有在 Step 12确定实施时启用：

- 如果没有 messages API，可隐藏或disabled并给清楚说明；
- 不交付点击无响应的placeholder；
- Step 11 review时评估复用现有 dialog/message renderer成本。

## 9. 不做

- 不实现完整 messages Dialog（Step 12）；
- 不改 Agent配置 UI；
- 不做 E2E/browser/manual smoke；
- 不新增/运行新单测；
- 不复用旧 CRUD IPC。

## 10. 静态验证

- typecheck/build/impact；
- IPC whitelist/handler/binding编译闭合；
- renderer registry只有顶层 subagent新入口；
- 搜索确认旧 subagent renderer 路径已删除且无生产引用；
- component行数检查；
- 搜索 state key 不单独使用 `subrunId`。

## 11. 下游交接与 Step 12 go/no-go材料

Progress记录：IPC名/方法、result parser、card组件结构、metadata query、detail入口现状。并在 Step 12开头写实际评估：

- 可否复用 MarkdownView/ToolDetail而不改render-items pipeline；
- Dialog预计新增/修改文件；
- 是否需要新context/atom；
- 是否超过500行或造成大范围状态改造。

更新 unit-test.md runtime UI/IPC候选。

## 12. Review 门禁

用户review核心卡片后，明确选择 Step 12 `in-progress` 或 `deferred`。不能由执行agent自行默默跳过或擅自扩大。
