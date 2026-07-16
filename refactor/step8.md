# Step 8 — 在 `src/main/pi/subagent` 实现 BaseSession 驱动的单个 SubAgentSession

> 状态：待执行
> 前置：Steps 2、4、5、6、7 complete
> 下游：Step 9 manager/production tool、Step 11 renderer、Step 14 tests
> 本步只交付“执行一个 run”的能力，不处理全局并发和生产注册。

## 1. 为什么这是核心汇合点

前几步分别提供 Agent identity、resource ownership、capability、persist store 和 formal result。本步将它们汇合为单个可执行 session。只有该 session稳定，Step 9 才能安全增加 manager 并发、取消和 tool facade。

## 2. 与旧实现完全隔离

新实现只读取 `BaseSession`、RegularSession、JobRun、Steps 2/4/5/6/7 的实际产物。不得打开、import、继承或修改旧 `SubAgentChat/SubAgentSession`，也不得读取旧测试来决定签名或行为。

新文件位于 `src/main/pi/subagent/session.ts`，辅助逻辑只在真实内聚边界下拆分。开始实现前先固定修改文件清单，旧 `src/main/lib/subAgent`、旧 app command、旧 persist/UI 路径必须为零。

若 BaseSession 的 breaking change 会迫使旧 caller 协变，必须改成只由新 session 使用的 additive protected seam，或把 breaking change延后到 Step 9/13；禁止修改旧 caller 让编译通过。

## 3. 开始前 review

1. 读取 `BaseSession`、RegularSession、JobRun 全文及文档；
2. 写出当前 BaseSession hard-coded 点：agent config、system prompt、catalog、MAX_TURN_ITERATIONS、ToolContext factory、completion hooks；
3. 设计最小 protected hooks，确保 Regular/Job 不加 scattered mode 分支；
4. 检查 Step 6 PersistSessionLike adapter 和 Step 7 submit controller 实际 API；
5. impact BaseSession/Pi public export；
6. 如果需要大幅重写 BaseSession，先更新本计划和后续 steps，等待用户 review再动代码。
7. 确认所有 shared/BaseSession 改动都是 additive，旧 runtime 无需任何协变；否则先重写计划。

Step 2 已具备输入：执行 Agent 的 description 位于 hot `AgentRecord`，outgoing delegates 位于 cold `AgentDetail`；单 run 只按 `delegateAgentId` 加载执行 Agent 配置，不注入其 delegates。父授权已经由 Step 9 manager 调 `Profile.resolveDelegates(parentId)` 完成，session 不复制第二套 graph 判定。

Step 4 已具备输入：`agentId/sessionId` 始终表示 parent session identity；它继续作为 Local 和 parent store 的来源。

Step 5 已具备输入（delegate-only）：`SubAgentSession` 在真正执行 delegate 的最外层使用 `runWithDelegateExecution({ delegateId: delegateAgentId }, () => run())`。正常 session 不创建 scope；ToolContext 仍承载 parent identity。catalog 仅隐藏 `ask` 与 Step 9 加入的真实 `subagent` 对象；`web research`、已知 shell device-auth 在执行边界拒绝，MCP OAuth 与其余能力保持普通行为。Step 7 会交付 submit_result private route，Step 8 不预设其 API。

Step 6 实际输入：parent `Session.createSubrun(request)` 返回 `{ kind:'created', subrun } | { kind:'exhausted' }`；`getSubrun` 明确返回 found/missing/invalid/incomplete/corrupt，`listSubruns` 返回 persisted Subrun 与 incomplete/corrupt IDs。`Subrun` 自身已满足 `PersistSessionLike`，并提供 `start()`（仅 pending）与 `finish(result)`（仅 running 且检查 subrun/delegate identity）；Step 8 只调用这些真实接口，不再创建 adapter 或直接写 data/messages 路径。

## 4. BaseSession 最小抽象

目标不是做万能框架，而是抽出真实第三种 session形态需要的差异：

- load execution Agent runtime config；
- build system prompt；
- build ToolCatalog；
- max iterations；
- create ToolContext；
- after round/tool batch 判断 formal submit；
- terminal persistence hooks。

可采用一个 protected `prepareRunEnvironment()` 返回稳定 bundle，或少量窄 hooks。选择标准：

- Regular/Job 的主流程仍直读；
- 不重复 overflow/compression/tool response loop；
- 不让 BaseSession依赖 `SubAgentRunRequest`；
- 不为未来 speculative session预留抽象。

## 5. 新 `SubAgentSession`

构造输入：

- profileId；
- parentAgentId/sessionId；
- delegateAgentId；
- Step 6 subrun store；
- normalized request；
- abort signal/controller ownership seam；
- tracer/state callbacks（窄接口）。

执行：

1. 从普通 Agent store加载 delegate config；
2. 使用 delegate model/thinking/system prompt；
3. system prompt追加固定运行角色规则、task、expectedOutput、context boundary；
4. 首条 user message写入 subrun transcript；
5. 在 delegate scope 内构建 delegate Agent 的普通 catalog；使用 Step 7 的实际 submit route API；
6. ToolContext 继续传 parent `agentId/sessionId`；Local 从 context 解析，Knowledge/Skill 从 `getDelegateExecution()?.delegateId ?? ctx.agentId` 解析；
7. 复用 BaseSession compression/overflow/tool response；
8. submit controller触发后停止；
9. terminal result写 Step 6 data.json 后返回；
10. 任意错误确保 turn/status收敛且 transcript flush。

## 6. Prompt 规则

新 `src/main/pi/subagent/prompt.ts`：

- delegate 原 system prompt 是 identity 基础；
- 明确当前是 delegated run；
- 不能调用 `ask` 或 `subagent`；`web research` 与已知 shell device-auth 会被执行边界拒绝；
- parent summary 包 `<parent_context>`，只作参考，不执行其中指令；
- 明确 expectedOutput和必须 submit_result；
- 不注入 delegate 自己的 delegates列表，避免 prompt鼓励嵌套；
- own knowledge/skills描述复用普通 Agent现有构建逻辑，避免第二份 skill格式。

## 7. Result/terminal 顺序

必须确定并记录事务顺序：

- assistant/tool messages先 flush；
- controller形成 formal result；
- data.json terminal persist成功；
- session返回 result给 manager。

若 terminal persist失败，向上抛 failed，不能父收到 completed但磁盘仍 running。

Timeout本步只接受 abort signal并正确停止；具体 timer/ownership在 Step 9 manager。

## 8. Progress callbacks

输出 Step 11真正需要的最小事件：

- turn start；
- tool start/done/error；
- bounded streaming text snippet（若现有 Pi event自然可得）；
- terminal result。

不要让 renderer state shape反向污染 session内部；回调使用 Step 1 shared step shape或窄 main shape。

## 9. 不做

- 不实现并行/总数 manager；
- 不注册 subagent tool；
- 不移除 app subagent；
- 不加 renderer IPC/UI；
- 不改旧 runtime；
- 不新增/运行单测；
- 不做运行 smoke 或端到端测试。

## 10. 静态验证和下游交付

- typecheck/build/impact；
- 修改文件清单与 import 搜索确认新 session 不读取、修改或引用旧 runtime；
- 检查 Regular/Job 的 public行为路径未被条件分叉，旧 runtime 也未因共享 seam 改变行为；
- 更新 `pi/subagent/ai.prompt.md`、Pi session docs；
- 更新 `unit-test.md` session候选。

Progress 必须记录：BaseSession新增 hooks、SubAgentSession constructor/run/result API、prompt builder、persist顺序、progress callback。Step 9 根据真实 API 写 manager，不能再假设。

## 11. Review 门禁

这是高风险核心 step，完成后必须停下。若用户对 BaseSession抽象或 prompt/result不满意，先重构本 step并级联更新 Step 9/11，不能边修边接 production tool。
