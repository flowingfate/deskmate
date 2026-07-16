# Step 7 — 实现 delegated-only `submit_result` 与正式结果状态机

> 状态：待执行
> 前置：Step 1 `SubAgentRunResult`、Step 5 reduced catalog extension seam
> 下游：Steps 8、9、11、14
> 本步实现提交原语和纯状态归并，不运行完整 session。

## 1. 为什么在 Session 前固定

Session 的停止条件、max-turn fallback、持久化 terminal state 和 renderer result shape都依赖“什么算正式完成”。如果先写 loop，再决定 submit_result，就会保留最后文本提取和 intent regex 的旧包袱。

## 2. 开始前 review

1. 读取 Step 1 实际 result union；
2. 读取 Step 5 ToolCatalog route 扩展方式；
3. 阅读 executeToolCall/LocalTool registry，选择不会让普通 catalog看到 submit_result 的方案；
4. 结果与 deliverables 规则只从 Step 1 正式 union、Step 5 policy 和当前 ToolResult 契约推导，不读取旧提取/follow-up 实现；
5. impact 计划修改的 ToolCatalog/ToolContext/`pi/subagent` 文件，并确认清单不含旧 Sub-Agent 路径。

## 3. Tool 可见性设计

`submit_result`：

- spec/handler 归 `src/main/pi/subagent/submitResult.ts`；
- 不注册进全局 LocalTool registry，否则普通 Agent 默认全开会看到；
- 通过 Step 5 提供的 runtime-only/inline route 追加到 reduced catalog；
- execute dispatcher 使用通用 runtime route机制，避免硬编码一串具体 tool name；
- handler 通过显式 execution context callback 提交，不回读 manager singleton。

若 ToolCatalog 当前无法承载 inline handler，本 step可以做最小通用 route 扩展，但必须保持普通 local/MCP routing 不变。

## 4. Submit schema

模型可提交：

- completed：content；
- partial：content + incompleteReason；
- blocked：reason，可带 content；

共同可带 warnings、deliverables。failed/cancelled 主要由 runtime产生，不鼓励模型伪造系统错误/取消。

所有字段：

- 运行时严格校验；
- trim 非空；
- arrays 去空去重保持顺序；
- deliverable 必须是允许的 parent local URI，由 policy/validator确认；
- 不接受 arbitrary JSON typed output。
- 本步在真实 submit/reducer 边界实现唯一 result normalizer：负责分支必填字段、文本、usage、数组稳定去重和 parent-local deliverable URI policy；Step 1 不再预建通用 normalizer。

## 5. 一次性提交控制器

在 `pi/subagent` 内实现 run-scoped controller/reducer：

- 初态 `open`；
- 首次合法 submit 原子转 `submitted` 并保存 payload；
- 重复 submit 返回明确 tool error，不能覆盖；
- session 可同步读取 submitted result；
- manager cancel/timeout/error 可在未提交时生成 system terminal result；
- 已 submitted 后发生持久化错误时，最终 run 必须 failed，不能向父返回未落盘 completed；具体提交/落盘顺序由 Step 8 落实。

## 6. 未提交 fallback 规则

提供纯决策函数供 Step 8 使用：

1. 首次出现“LLM停止且无 submit”时，追加固定 reminder，明确要求调用 submit_result；
2. 第二次仍无 submit、达到 maxTurns、或模型无工具能力时：
   - 有可用 assistant content → partial，incompleteReason=`result_not_submitted`；
   - 无内容 → failed；
3. timeout/cancel/error 由 runtime status决定；
4. 不使用 `INTENT_PATTERNS` 或其它自然语言 regex；
5. 不把最后文本标 completed。

## 7. Usage/Deliverables 合并

正式 result 的 metadata 由 Step 8/9 填：

- subrunId/delegateAgentId 由 runtime注入，不信任模型 args；
- turns/duration/token usage 由 session/manager注入；
- tool execution 自动登记的 deliverables 与 submit payload 合并、校验、去重；
- warning同样有稳定顺序。

本 step 定义 reducer API，具体工具 hook Step 8 接线。

## 8. 不做

- 不实现完整 LLM loop；
- 不写 manager/tool command；
- 不持久化 terminal data（Step 8 用 Step 6 store）；
- 不改 renderer；
- 不新增/运行测试；
- 不做 E2E。

## 9. 静态验证与交接

- typecheck/build/impact；
- 确认普通 Agent catalog构建路径不会枚举 submit_result；
- 更新 `unit-test.md` submit/fallback候选；
- progress 记录 inline route API、controller API、fallback enum/reasons。

Step 8 必须用该 controller作为唯一 stop truth；Step 9 tool result不得另行解析文本；Step 11 renderer只消费 formal result union。

## 10. Review 门禁

用户 review submit schema/fallback 后停止。任何 status 字段变化要同步 Steps 8、9、11 和 unit-test plan。
