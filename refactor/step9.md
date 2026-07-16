# Step 9 — 实现 Manager、接通顶层工具并切换主进程生产路径

> 状态：待执行
> 前置：Step 3 command seam、Step 6 store、Step 8 single-session API complete
> 下游：Steps 11、13、14
> 这是新后端第一次对 LLM 生效的原子 cutover。

## 1. 为什么集中在一个 step

不能先注册 `subagent` 再补 manager，也不能先移除旧入口后留下空窗。本步在生产 root 原子接通新 manager/tool，并删除旧注册/import；确认旧 backend 子树不可达后整体删除它，而不是修改旧实现配合新接口。

## 2. 开始前 review

1. 从 progress 读取 Step 3/6/8 的实际 APIs，不按计划中的示例猜；
2. 搜索所有生产注册：tools/index、app commands、feature flag、prompt template；
3. 搜索 parent cancel 路径和 ToolContext callback seam；
4. 写出 manager state key：必须包含 parent identity + 三位 subrunId；
5. impact Pi root exports、tool registration、session regular/job、app command registry；
6. 若 Step 8 尚未用户 review complete，不开始本 cutover。
7. runtime event 使用 Step 1 的 `SubAgentRuntimeState`，terminal result 使用 `SubAgentRunResult`；不得弱化 parent identity 或复制第二套状态 shape。
8. 预先列出将被删除的旧 backend 目录及其全部生产引用；删除前必须证明新入口已完整接线。

### Step 3 已具备输入（2026-07-16）

- construction：`createSubagentTool(runner)` → `createSubAgentCommand(runner)`；没有未注入 runner 的工具常量。
- runner：`listDelegates(scope)` / `describeDelegate(scope, id)` / `run(scope, request)`；scope 已含 `profileId + parentAgentId + parentSessionId + signal + tracer + correlationId`。
- outcomes：三条命令的可预期业务拒绝返回 `{ kind: 'rejected', error }`；run 的真实 subrun 终态返回 `{ kind: 'result', result: SubAgentRunResult }`。
- run parser 已输出 normalized request；`--with-parent-summary` 会通过 AppCmdContext callback 获取 summary，manager 不再重复解析 CLI 或生成 summary。
- facade 当前未从 `tools/index.ts` import/register；本 step 必须在 manager adapter 可用后调用 `createSubagentTool(adapter)` 原子注册。

### Step 4/5 已具备输入

- parent Agent/session 固定为 `agentId/sessionId`；manager 把它传给 SubAgentSession，不复制到 delegate context。
- Step 5 delegate context 只在 SubAgentSession run root 建立，只有 `delegateId`；normal execution 没有 store。
- manager 不从 eventSender 推断角色，也不包装第二个 scope。MCP/Auth、tools、router 在 scope 有值时自行分支。
- 旧 ToolContext/AppCmdContext mode union 仅是旧 runtime bridge；production root 切换并证明旧 backend orphan 后，必须随旧源码整体删除其 consumer/bridge。

### Step 6 已具备输入（2026-07-16）

- manager 从 parent `Session.createSubrun(normalizedRequest)` 获得 `{ kind:'created', subrun } | { kind:'exhausted' }`；不得自行扫目录或分配 ID。
- `listSubruns()` 是跨 restart 的 persisted reservation count 来源，且返回 incomplete/corrupt IDs；总数门控只计已 reservation 的合法目录，异常目录不被静默重用。
- `getSubrun(subrunId)` 始终受 parent Session scope 限定；pending/running load 不自动改写。Step 9 必须成为 stale running → interrupted failed 的唯一 recovery writer。
- `Subrun` 直接是 Step 8 的 `PersistSessionLike`；session 正常完成先 flush transcript，再通过 `finish(result)` 原子更新 terminal data。

### Step 8 实际输入（2026-07-16）

- `SubAgentSession` 构造只需 `{ subrun, signal, parentTracer?, callbacks? }`，parent/delegate/request 均从 Subrun data 唯一读取；`run()` 返回 `{ kind:'result', result } | { kind:'not_pending', status }`。
- manager 对 newly created pending run 把 `not_pending` 视为明确 internal rejection；它必须等 `run()` resolve 后才从 result 读取 terminal state，不能预先合成 completed。
- session 在 scope 内加载 delegate config/prompt/catalog，controller/missing-submit/formal builder 已内聚。manager 不复制这些语义，只提供 callbacks 的 bounded-state sink。
- prompt 边界：`buildSystemPrompt()` 已完全通用化，不读取 legacy/new sub-agent config，也不输出 delegation guidance。Step 9 在新顶层 `subagent` 真正生产注册时，才由需要委派能力的 parent BaseSession 子类在通用 prompt 后显式追加基于 `Profile.resolveDelegates(parentId)` 的新 Agent graph guidance；SubAgentSession 永不追加。

## 3. `src/main/pi/subagent/manager.ts`

Manager 负责 orchestration，不复制 session逻辑：

- 按 profile/parent Agent/session/request 校验；
- 调 Step 2 `Profile.resolveDelegates(parentAgentId)`；返回 null 时明确报告 parent config unavailable，仅允许非 null `available` 中命中 request.delegateAgentId；`unavailableIds` 命中时区分 self 与 unavailable target，禁止直接读 config 或按 name fallback；
- 通过 parent Session创建 Step 6 subrun，取得 `001..999`；
- 创建 per-run AbortController并启动 Step 8 SubAgentSession；
- 同 parent session max parallel=5、max total=20；多个独立 `subagent` tool calls 会由 RegularSession/JobRun 并行发起，manager 的 admission/reservation 必须并发安全；
- timeout触发 controller.abort 并等待 session收尾，不用无界 `Promise.race`；
- cancel one、cancel by parent；
- finally释放 active map、parent set、timer和listener；
- terminal state来自 persisted formal result，不另拼字符串。

### Key 设计

`subrunId='001'` 非全局唯一。内部 map key可用结构化 nested maps：

```text
parentSessionKey -> subrunId -> ActiveRun
```

或稳定复合 key，但对外 API始终要求 parent identity + subrunId。

### Total count

max total 20以已经 reservation 的 subrun count为准，跨 app restart仍一致；不能只用内存 `spawnCountMap` 重启归零。

## 4. Command kernel 接线

实现 Step 3 `SubAgentCommandRunner` adapter：

- `listDelegates` 调 `Profile.resolveDelegates(parentAgentId)`；null 返回 rejected，否则保持 available 顺序投影 ID/name/description/model，并原样返回 unavailable IDs；
- `describeDelegate` 先走同一 resolver 授权，只允许 available ID；再对一个 target 调 `getAgentDetail`，投影 thinking/local-tools/MCP/Skills，禁止输出 systemPrompt/delegates/subAgents/zero；
- `run` 不改 command grammar、复制 parser 或绕过 `normalizeSubAgentRunRequest`；manager负责授权/limits/store/session；
- 三条命令固定 JSON `{ outcome }`；run 的 formal result 自带 parent-scoped subrunId；
- 并行来自同一 assistant response 的多个独立 run calls，不在 manager/command 内再造 batch API；
- 不输出旧 `<sub_agent_result>` 自由文本包，不按 name lookup；scope 已透传 signal、tracer、profile/parent Agent/session、correlationId。

## 5. 注册新顶层工具

在 `src/main/pi/tools/index.ts` 用真实 adapter 注册 `createSubagentTool(adapter)`：

- 与 app/web并列；
- spec description列出 commands synopsis；
- 普通 Agent catalog是否可见仍受其 tools selection规则，但若 parent想委派且未启用 subagent，应有清楚配置/UI表现；具体默认可见语义在本 step review时对齐现有 tools白名单；
- SubAgentSession 的 delegate scope 按 LocalTool 对象黑名单过滤；注册前把真实 `createSubagentTool(adapter)` 返回对象加入黑名单，禁止嵌套委派。除 `web research` 与已知 shell device-auth 外，其余工具与子命令保持普通能力；MCP OAuth 保持全局交互流。它不依赖 general agent scope 或 catalog replacement API。

更新 tool-system文档的顶层工具数和分工。

## 6. 下线并删除旧 backend

- 从 `appCommands` production registry删除旧 command 的 import/registration，并从 app help/synopsis移除；
- parent prompt示例全部改 `subagent("run ...")`，所有生产调用改走新 manager；
- 搜索证明 `src/main/lib/subAgent/` 与 `src/main/pi/appcmd/builtins/app/subagent/` 已无生产引用；
- 证明不可达后整体删除上述旧 backend 目录及其旧测试，以及 Step 4 mode/delegate bridge、旧 recursion guard；禁止先逐文件修改它们；
- 通用 ToolContext / AppCmdContext 删除不再有调用方的 identity 字段，只保留技术依赖与新 `run --with-parent-summary` getter；不留 alias、转发 shim或 archive 副本。仍被 Step 10 UI/persist 使用的旧 CRUD 数据层不在本步修改，等其引用归零再整体删除。

## 7. Parent prompt 与 context callback

`pi/prompt.ts`：

- 调用 `Profile.resolveDelegates(parentAgentId)` 获取结果并显式处理 null，不直接读取 parent config；
- join active AgentRecord，展示 ID/name/description/model；
- dangling targets不提供可执行示例，并记录/显示 unavailable；
- 指导 task/expect具体化；
- 不暴露旧 global subAgents registry；
- SubAgentSession自身 prompt不注入 delegation list。

Step 2 已固定 prompt 数据源：available 直接使用 resolver 返回的 hot `AgentRecord`（含 description/model），unavailable 只展示真实 ID；不要为 prompt fan-out 调 `getAgentDetail`。

RegularSession/JobRun ToolContext：

- 提供 manager运行所需 parent summary getter；
- event/correlation/tracer显式传递；
- parent cancel调用 manager cancelByParentSession；
- JobRun可委派，但 human UI cancel能力可能为空；manager本身仍正确处理上游 signal。

## 8. Runtime state seam

Manager维护 Step 1 shared runtime state并支持订阅/sink，但本 step不必完成 renderer IPC：

- state包含 parent identity、subrunId、delegate ID、status、turn/steps；
- bounded steps，防止内存无限增长；
- terminal state可从 store恢复；
- Step 11接 IPC时不需要改 manager内部模型。

## 9. 不做

- 不改 Agent配置 UI；
- 不做 renderer卡片/Dialog；
- 不删除或迁移用户磁盘上的旧数据；
- 不修改仍待 Step 10 下线的旧 CRUD UI/persist 实现；
- 不新增/运行新单测；
- 不做端到端/手工运行。

## 10. 静态验证

- typecheck/build/impact；
- 搜索 production registry/import确认新 tool已注册、旧 app command未注册；
- 搜索确认旧 backend 目录已删除，新 production不依赖旧 `lib/subAgent`/persist SubAgents；
- 静态确认 timer/signal/finally cleanup路径完整；
- 若只有真实 LLM运行才能判断，状态改 `blocked-for-user-test`，让用户测试。

## 11. 下游交接

Progress记录：manager API、state subscription、cancel APIs、tool result JSON、prompt格式、生产注册点。更新 Step 11 renderer与IPC计划、Step 13 cleanup清单、unit-test manager候选。

## 12. Review 门禁

本 step完成后必须由用户决定新后端是否可接受。未获 review complete，不进入 renderer runtime UI。任何 tool syntax/result JSON变化要同步 Step 11 parser和 unit-test plan。
