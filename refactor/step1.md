# Step 1 — 固化目标契约与 `pi/subagent` 模块边界

> 状态：待执行
> 上游输入：`context.md` 第二轮决策、当前 shared Agent schema、Pi public boundary
> 下游消费者：Steps 2–9、11、14
> 本步不改变生产行为，不注册新工具。

## 1. 为什么第一步必须先做

后续至少有五个模块会同时消费“subrun ID、请求、正式结果、运行状态”：persist、Pi session、cmdline tool、IPC、renderer。若它们各自先写类型，三位 ID scope、terminal status 和 expected output 会立即漂移。

本步只建立最小共享语言和 `src/main/pi/subagent` 的依赖规则。它不预先搭满空目录，不创建 no-op manager，也不让 LLM 看见尚不可执行的工具。

## 2. 开始前必须 review

1. 阅读 `context.md`、`progress.md`、`unit-test.md`；
2. 阅读 `src/shared/persist/types/agent.ts`、`src/shared/types/profileTypes.ts`、`src/main/pi/index.ts`、`src/main/pi/ai.prompt.md`；
3. 搜索当前 `SubAgentTaskResult/RuntimeState` 的调用方，确认新类型不会误改旧参考路径；
4. 运行 `npm run check:impact -- <计划修改的 shared/pi 文件>`，补读命中文档；
5. 如果用户在本 step review 时改字段，先更新 Steps 2–14 和 `unit-test.md`，再写代码。

## 3. 本步输入契约

已确认：

- subrun ID 是 parent session scoped 三位字符串；
- target 通过 Agent ID 指定；
- task 和 expectedOutput 必填；
- context 只有 isolated / parent_summary；
- result 是五态 discriminated union；
- 不迁移旧数据；
- 新实现属于 `src/main/pi/subagent`。

## 4. 具体实现

### 4.1 Shared runtime types

新建或选择一个符合仓库 shared 类型组织的文件，例如 `src/shared/types/subAgentRunTypes.ts`。最终名称在实现前对现有命名检查后固定，内容包括：

- `SubrunId = string` 的运行时 validator/constructor；不使用 branded cast；
- `SubAgentRunContext`：`{ kind:'isolated' } | { kind:'parent_summary'; summary:string }`；
- `SubAgentRunPolicy`：maxTurns、timeoutMs；
- `SubAgentRunRequest`：delegateAgentId、task、expectedOutput、context、policy；
- `SubAgentRunUsage`：turns、durationMs、可得到的 token usage；
- `SubAgentRunResult` 五态 union；
- `SubAgentRunStep` 与 `SubAgentRuntimeState`，供 Step 9 manager 和 Step 11 renderer/IPC 共用。

约束：

- `subrunId` 的局部 scope 必须在注释写清；任何 state event 还要带 parentAgentId/parentSessionId；
- terminal result 不允许通过一堆 optional 字段表达；
- 不添加 `full_history`、typed output、async handle/join 字段；
- 不复用旧 `profileTypes.ts` 的 SubAgent runtime interface，也不删除它。

### 4.2 Runtime policy normalization

在 shared 纯函数或 `pi/subagent/types.ts` 提供：

- task/expectedOutput trim + 非空验证；
- maxTurns/timeout defaults 和系统上限；
- `SubrunId` format/parse helper；
- 无 `unknown`/`any`/强制 `as Xxx` 绕过。

如果 JSON cmdline input 的未知形态必须解析，使用现有 JSON value 类型/显式 type guard，不污染业务类型。

### 4.3 `src/main/pi/subagent` 边界文档

创建目录时只新增当前 step 真正有内容的文件，例如 `types.ts` 和 `ai.prompt.md`。`ai.prompt.md` 初版必须写：

- 模块职责与非职责；
- 依赖方向；
- 旧 `lib/subAgent` 只读参考，禁止新 import；
- 未来文件地图（标注 planned，不伪称已实现）；
- capability、persistence、result 的核心不变量；
- co-change map。

不要为了匹配未来地图创建空 `manager.ts/session.ts`。

### 4.4 Public exports

- shared 类型从正确 shared barrel 导出；
- `@main/pi` 根入口只有出现真实外部调用方时才新增 export。本 step 无调用方则不提前 export；
- 旧类型和旧 runtime 不改、不测。

## 5. 本步明确不做

- Agent description/delegates 落盘；
- cmdline facade；
- ToolContext owner split；
- subrun store；
- session/manager；
- renderer；
- 新单元测试；
- 任何运行或 E2E 验证。

## 6. 静态验证

- `npm run check:impact -- <实际修改文件>`；
- 按项目脚本运行 typecheck/build，确认 shared discriminated unions 在 main/renderer 均可编译；
- 不创建或运行新增测试；若需要行为测试才能判断，停止交给用户。

## 7. 对 Step 2–14 的交付

完成后必须在 `progress.md` 精确记录：

- 最终类型文件路径和导出名；
- `SubrunId` validator API；
- request/result/state 的最终字段；
- normalization defaults/limits；
- 与本计划的任何偏差。

随后逐一检查 Steps 2、3、5、6、7、9、11、14 是否引用了真实名称。不能让下游继续写占位名。

## 8. `unit-test.md` 更新

只更新候选：ID format、request normalization、result union/validator。不写 test 文件。

## 9. Review 门禁

本 step 完成后状态改 `awaiting-review` 并停止。用户若修改任何 shared 字段，所有下游 steps 先标 `needs-replan`，完成级联更新后才能进入 Step 2。
