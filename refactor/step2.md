# Step 2 — 让普通 Agent 承载 description 与 delegates 图

> 状态：待执行
> 前置：Step 1 complete，shared request/ID 命名已固定
> 输出将被 Steps 5、6、8、9、10、14 消费
> 本步仍不启用 subagent runtime。

## 1. 为什么现在做

新 runtime 必须从普通 Agent 读取 target 配置与授权关系；renderer 也必须能编辑同一事实源。因此在写 manager 之前先把 Agent graph 做完整，避免 manager 临时读旧 `SubAgentConfig` 或按 name fallback。

## 2. 已具备输入

从 Step 1 获取：target 字段固定为 `SubAgentRunRequest.delegateAgentId: string`；shared result/state 分别为 `SubAgentRunResult` / `SubAgentRuntimeState`；state 的 parent identity 固定为 `profileId + parentAgentId + parentSessionId + subrunId`。运行类型直接从 `@shared/types/subAgentRunTypes` 导入。Step 1 当前为 `awaiting-review`，用户确认前不开始本步。

## 3. 开始前 review

1. 阅读 persist 总览/模块文档和 shared IPC 文档；
2. 阅读 Agent hot/cold 两层：`AgentRecord`、`AgentDetail`、AGENT.md parser/store/IPC/atoms；
3. 运行 impact：`src/shared/persist/types/agent.ts`、`src/main/persist/agent.ts`、`profile.ts`、`src/shared/ipc/persist.ts`；
4. 检查 renderer 当前哪些列表只拿 AgentRecord；description 是否必须 hot。默认结论：是，委派选择和 prompt 不应 fan-out N 份 AGENT.md；
5. 不读取或修改旧 `sub-agents/` store。

## 4. 目标数据契约

### Hot `AgentRecord`

新增：

- `description?: string`。

原因：Agent picker、委派 prompt、renderer list 高频使用；启动期从 `agents.json` 获得。

### AGENT.md / Cold `AgentDetail`

新增：

- front-matter `description?: string`；
- front-matter `delegates?: string[]`；
- detail `delegates?: string[]`。

旧 `subAgents?: string[]` 暂留旧源码能编译，但新生产路径不得读取。它不是迁移输入，因为本项目不迁移旧数据。

### Patch/Create

- `AgentFrontPatch` 支持 description/delegates；
- `CreateAgentInput` 可在创建时带 description；delegates 可通过 front patch；
- renderer compat `AgentPersona` 若仍是实际写桥，最小增加映射；长期新 UI优先直接使用 persist types。

## 5. Graph 规则放在 Profile/Agent 事实源

提供单一 normalization/resolution 入口，避免 command、renderer、manager 三处各写一份：

- trim/去空/去重，保持首次顺序；
- self ID 拒绝；
- dangling ID 允许落盘并保留；
- `resolveDelegates(parentId)` 返回按配置顺序的 available records + unavailable IDs；
- archived target 因不在 active registry，表现为 unavailable；
- runtime 在真正 run 前再次调用 resolver，不能信任 prompt/UI 的旧快照。

不要在 bootstrap fan-out 读每个 AGENT.md。resolver 可按 parent ID 只读父 detail，再 join hot registry。

## 6. 写路径协变

同步更新：

- markdown narrow/serialize/round-trip；
- `AgentConfig.assign/toFrontMatter`；
- `Agent.toRecord/toDetail/patchFront/init`；
- `Profile.createAgent/duplicateAgent`；
- persist IPC create/patch/get detail/event payload；
- renderer atoms 的类型消费（不做 UI）；
- app agent 的 status/list/update schema若展示或修改这些字段，先只保证编译，完整 delegation command 在 Step 3/9。

Duplicate 规则：复制 description 和 outgoing delegates；如果复制后 delegates 包含新 Agent 自己的 ID，normalizer 必须剔除（通常旧 ID 不等于新 ID）。

Archive 规则：不主动重写其它 Agents；dangling 保留。

## 7. 不做

- 不读取旧 SubAgent name references；
- 不写迁移器；
- 不删旧 `subAgents` 字段或文件；
- 不构建 prompt/catalog；
- 不做 UI；
- 不新增测试。

## 8. 静态验证

- impact + 所有命中文档；
- typecheck/build；
- 检查 create/patch/detail/event 类型三层闭合；
- 不启动应用验证，不做 E2E；若必须验证磁盘行为，停下由用户执行。

## 9. 下游交接

完成后更新 `progress.md`：

- description 位于 hot/cold 哪些 shape；
- delegates 的 normalize/resolve API 及文件；
- dangling/self/archive/duplicate 的实际语义；
- app/renderer 暂存兼容点。

然后更新：

- Step 5 用 resolver 做授权；
- Step 8/9 不得直接读 `Agent.config.delegates` 绕过规则；
- Step 10 使用最终 patch 字段和 atom 数据源；
- `unit-test.md` 增加 graph/round-trip 候选。

## 10. Review 门禁

停在 `awaiting-review`。若用户改变 description hot/cold 或 dangling 语义，Steps 5、8、9、10 必须同步重写后再继续。
