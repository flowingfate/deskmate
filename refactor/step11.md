# Step 11 — 新 `subagent` 工具卡片、运行状态、取消与 Audit IPC

> 状态：complete
> 前置：Step 6 store、Step 7 result、Step 9 manager/tool complete
> 下游：Step 12 Messages Dialog、Step 13 cleanup、Step 14 tests
> 本步交付 reload-safe 的核心运行可视化，不强制展示完整 transcript。

## 1. 为什么先做卡片再决定 Dialog

卡片需要的状态与 Dialog需要的完整 messages体量不同。先完成正式 result、live state、cancel和metadata查询，可以验证详情入口是否能在不重构整个消息渲染管线的前提下追加；这也是 Step 12是否实施的判断依据。

## 2. 开始前 review

1. 阅读 chat tool renderer registry和当前 app/web/shell renderer模式；旧 app/subagent 卡片已删除，不能作为模板；
2. 从 Step 9 获取最终 manager state/cancel API，并核对 Step 3 已固定的单调用 `{ outcome }` envelope；
3. 从 Step 6获取 parent-scoped subrun query API；

Step 6 实际查询链：先按 active profile/parent ownership 取得 `Session`，再调用 `getSubrun(subrunId)`；只有 `found` 才从 `Subrun.toDataFile()` 读取 metadata。`missing`、`invalid_id`、`incomplete`、`corrupt` 必须映射为明确 query error，不能把 `001` 作为全局 key 或直接拼磁盘路径。
Step 9 实际 manager seam：IPC handler 先按 active profile/parent ownership 取得 `Profile`，再调 `SubAgentManager.forProfile(profile)`；此对象提供 `cancelRun({ profileId,parentAgentId,parentSessionId,subrunId }): boolean`、`cancelByParentSession(parent): number`、`subscribe(listener): unsubscribe`、`getRuntimeState(key): Promise<SubAgentRuntimeState | null>`。active state 的 steps 上限为 50；terminal/reload state 从 Subrun data 派生。handler 不能把 manager 的内存 state 当持久查询来源。

4. 设计 shared IPC，确认 preload四层协变；
5. 组件不得超过500行；所有 tool call 复用同一单任务卡片，不为并行调用复制 batch 展示逻辑；
6. 不启动应用/浏览器，用户负责可视行为验证。

### 本轮复核结论（2026-07-16）

- 原计划的 IPC 四层、parent-scoped query、顶层 `subagent` renderer 与单调用卡片边界仍成立。
- live state 需要覆盖 renderer 在工具调用流事件后才挂载卡片的竞态：renderer IPC 模块在加载时订阅 `stateUpdate`，以完整 parent identity + correlationId 缓存最新状态；卡片只读取匹配本次 tool call 的记录。
- Profile 可切换且 manager 是按 Profile 新建的 WeakMap owner，因此 main IPC 需订阅所有现有及后续 manager 的 state publish；在 manager 内增加精确的 process-level bridge subscription，避免 startup 时只订阅一次 active Profile 导致切换后丢失 live state。
- `getRunData` 只返回当前 parent-owned `SubrunDataFile`，不读取 transcript；`cancelRun` 先沿 active Profile → parent Agent → parent Session → Subrun 解析，并用 explicit union 区分 invalid/missing/incomplete/corrupt/terminal/not-active。
- 卡片用 `OutputExecutingBlock` / `OutputSuccessBlock` 接管 `subagent` 的 output slot；JSON parser 只做展示投影，未知输出回落原始文本，不承担命令安全校验。无 messages API 前不渲染无效的详情入口。

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

旧 `renderers/app/subagent` 已由 Step 10 随其 CRUD IPC 一并删除；本 step只注册新的顶层 `subagent` renderer。

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

## 11.1 实际交付（2026-07-16）

- 新增 `subagentRun` namespace：`getRunData(parent)` 返回仅 metadata 的 `SubrunDataFile`；`cancelRun(parent)` 返回 explicit cancel/terminal/not-active/lookup outcomes；`stateUpdate(SubAgentRuntimeState)` 推送 live state。四层 shared/main/preload/renderer 已闭合。
- manager 的 process-level `subscribeStateUpdates()` 让 IPC 能转发所有 profile-bound manager 的事件；renderer cache 只保留 pending/running，且以 profile + parent identity + correlationId（已知时 subrunId）过滤，终态仍以 final tool result / persisted data 为准。
- 顶层 `subagent` renderer 仅对 `run` result 渲染独立卡片；`list`/`describe` 只读展示，rejected 不生成 subrun。卡片拆为 parser、运行卡片和结果展示，最大组件 258 行；无 messages API，未放无响应的详情入口。
- 静态验证：LSP diagnostics、`npm run check:impact -- <12 个代码文件>`、`npm run typecheck`、`npm run build` 均通过；build 只有既有 renderer chunk-size warning，npm 有既有 `.npmrc` unknown-config warnings。按政策未新增/运行单测，未启动应用、未做 browser/smoke/E2E。

### Story 补充复核（2026-07-16）

- 用户暂不能跑完整流程，要求把所有 `components/chat/tool` 的可视组件置于 `src/renderer/story/tools/` 独立调试。
- stories 不改生产组件；仅在 story 目录安装 Electron bridge mock，并以 lazy import 确保 mock 先于需要 IPC 的 subagent/write/tool registry 模块求值。
- 覆盖 `AnimatedHeight`、`ToolChip`、`ToolDetailView`、`ToolCallsSection`，以及 app/shell/web/write/subagent 五个 renderer 的槽位组合；registry 在 ToolCalls integration story 中通过真实 builtin registration 覆盖。
- 该补充不改变 runtime/IPC 契约或 Step 12 scope；Ladle build 是本次唯一运行验证。

### Story 实际交付（2026-07-16）

- 新增 `src/renderer/story/tools/`：AnimatedHeight、ToolChip、ToolDetailView（app/shell/web/write/subagent renderer gallery）、ToolCallsSection（真实 builtin registry）与 SubagentRunCard（formal/live/cancel）stories。
- `mockElectron.ts` 只在 Story 路径提供最小 Electron bridge；需要 IPC 的模块均通过 lazy import 在 mock 后加载，未改任何生产组件或 runtime code。
- 验证：`npm run ladle:build`、`npm run typecheck`、`npm run build` 均通过。未启动完整应用或 E2E。

### Story 浏览器修复（2026-07-16）

- 复现：`Chat / Tools / Subagent Run Card / Formal Result` 在 Ladle dev server 中报 `Cannot read properties of undefined (reading 'invoke')`。
- 根因：`GeneratedFileCards` 的 transitive import 触发 `agentSessionCacheManager`，其 module 初始化还需要 `agentChat` / `research`、renderer `log` 与 `_human_in_loop_`，初版 story mock 未提供这些 globals。
- 修复：只扩展 `story/tools/mockElectron.ts` 的 mock surface，不修改生产文件；running fixture 改为相对 `Date.now()`，避免虚假的多年 duration。
- 浏览器验证：逐一打开 7 个 `Chat / Tools` stories 均无 page error；Subagent formal result 正常渲染，running card 显示约 4 秒 duration，Cancel 可触发 mock command。

### Subagent Tool Chip 补充（2026-07-16）

- 用户指出 Subagent card story 未展示 tool chip。现将真实 `ToolCallsSection` 与 builtin renderer registry 放入 formal/live Subagent stories：初始可见 `subagent` chip，点击后展示实际 input/output detail；formal/live card 仍保留在下方供独立检查。
- 为避开 renderer typecheck 的 mixed static/dynamic import gate，Story helper 改为直接引用 `ToolCallsSection` / `registerBuiltins`，并由 lazy-loaded story demo 承载；不通过 production barrel 混用导入。
- 验证：浏览器加载 formal route 无 page error，实际可见 chip，点击后显示完整 subagent input/output；`npm run typecheck` 与 `npm run ladle:build` 通过。

### Subagent Chip 样式复核（2026-07-16）

- 不增加 `ToolChip` prop 或 renderer 分支：顶层 tool name 已是稳定 `subagent`，由 `ToolChip` 本地判别即可，避免无意义 API 扩张。
- 沿用 MCP 的特殊表面策略，但使用独立 indigo 色阶与 `Bot` 图标，避免与 MCP violet 混淆；selected/unselected、tooltip、aria label 与现有 chip 交互保持一致。
- Story 直接加入 subagent chip state，Subagent run Story 继续验证真实 `ToolCallsSection` 集成。

### Subagent Chip 实际交付（2026-07-16）

- `ToolChip` 依据稳定 tool name `subagent` 使用 indigo selected/unselected 表面、`Bot` 图标、`delegated agent` tooltip 和专用 aria label；MCP 保持 violet 语义，普通工具保持中性。
- 浏览器确认 unselected 状态包含 indigo ring/background 与 Bot SVG；点击后切换至 indigo selected surface。`npm run typecheck`、`npm run ladle:build`、`npm run build` 均通过。

### Subagent Chip 归属修正（2026-07-16）

- 用户否决在通用 `ToolChip` 按 tool name 做 subagent 分支。已完全恢复其通用/MCP-only职责。
- indigo、Bot、tooltip、aria label 与状态点逻辑全部移至 `renderers/subagent/index.tsx::SubagentChip`，并由 `subagentRenderer.Chip` 正式 override；样式直接内联于 DOM，不保留 class 常量。
- 浏览器与构建验证：Subagent Story 的 chip 保持 indigo + Bot；`npm run typecheck`、`npm run ladle:build`、`npm run build` 通过。

### Subagent Story 场景复核（2026-07-16）

- `SubagentChip`：completed、executing、execution-failed、interrupted、selected。
- `OutputExecutingBlock`：pending（无 state）与 running（live state + cancel）。
- `OutputSuccessBlock`：completed、partial、blocked、failed、cancelled；rejected；list/describe read-only outcome；unknown JSON fallback。
- 每个正式结果分支通过 `ToolDetailView + subagentRenderer` 渲染，不只直接挂内部卡片，保证覆盖真实 slot override。

### Subagent Story 场景实际交付（2026-07-16）

- `subagent-run.stories.tsx` 从两个入口扩展至：chip states、pending、running/cancel、completed、partial、blocked、failed、cancelled、rejected、read-only list/describe 与 unknown fallback。
- terminal result、rejected/read-only/fallback 全部经 `ToolDetailView + subagentRenderer` 覆盖真实 output slot；pending/running 覆盖 `OutputExecutingBlock`，chip states 覆盖 custom `Chip` 的 completed/executing/failed/interrupted。
- 浏览器逐一加载 11 个 route 均无 page error；`npm run typecheck`、`npm run ladle:build`、`npm run build` 通过。

### Subagent Chip Tooltip 实际交付（2026-07-16）

- custom chip tooltip 现在显示 `Delegated Agent` 和本次 `toolCall.args.cmd`；无 cmd 时显示允许委派任务的说明，不再使用无信息的静态文案。
- 浏览器 hover 验证显示完整 `run <agent-id> --task ... --expect ...` 命令；`npm run typecheck`、`npm run ladle:build`、`npm run build` 通过。

## 12. Review 门禁

用户review核心卡片后，明确选择 Step 12 `in-progress` 或 `deferred`。不能由执行agent自行默默跳过或擅自扩大。
