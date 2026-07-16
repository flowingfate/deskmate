# Step 7 — 实现 delegated-only `submit_result` 与正式结果状态机

> 状态：完成
> 前置：Step 1 persisted result union、Step 5 delegate-only execution context、Step 6 Subrun store
> 下游：Steps 8、9、11、14
> 本步固定显式提交、正式结果归并和未提交决策；不实现 LLM session 或 terminal 持久化。

## 1. 开始前复核结论

- Step 5 已删除早期的 catalog replacement/guard extension seam；正常 Agent 仍经 `buildToolCatalogForAgent()` 构建普通目录，只有 delegate scope 会过滤 `ask`。
- `ToolCatalog` 是 per-turn immutable snapshot；全局 `ToolsRegistry` 是普通 Agent 默认可见的注册表。因此 `submit_result` 不能进入 registry，也不能复活通用替换/guard API。
- Step 6 的 `Subrun.finish(result)` 只接受 `running` Subrun，并检查 `subrunId` 与 `delegateAgentId`；本步只产生经过验证的 formal result，绝不写 `data.json`。
- `local://` 通过调用时的 parent `ToolContext.agentId/sessionId` 解析。deliverable policy 只接受非空、无 traversal segment 的 `local://` URI；不接受 knowledge、skill、absolute path 或任意 URL。
- `ToolCatalog`、其出口以及 `executeToolCall` 有旧 runtime 调用者，但本步只添加新 private route，不修改旧 caller、旧 Sub-Agent 路径或生产注册。

## 2. 私有工具路由

在 `src/main/pi/tool.ts` 为真实 `submit_result` 增加唯一的 catalog-private route：

- `ToolCatalog.withSubmitResult(tool)` 仅接受名字严格为 `submit_result` 的 `LocalTool`，克隆当前 specs/routes 后追加该 tool；它不是通用 `withTool`/replacement/guard API。
- catalog 内所有 local route 都直接持有对应的 `LocalTool` 对象，并经同一 registry 执行 helper 调用；`submit_result` 因此只是一条普通 local route，完全不需要 `kind:'submit_result'` 或第二个 dispatcher 分支。
- 普通 `buildToolCatalogForAgent()` 不调用此方法，所以普通 Agent 永远不会枚举或调用 `submit_result`。
- Step 8 在 delegate scope 内先构建执行 Agent 正常 catalog，再用 controller 生成的 tool 调用该方法；handler 只闭包调用 controller，不回读 manager singleton。

## 3. Submit 输入与 formal result

新增 `src/main/pi/subagent/submitResult.ts`，包含本步唯一的模型输入边界：

- tool schema 只允许 `completed(content)`、`partial(content, incompleteReason)`、`blocked(reason, content?)` 和可选 `warnings` / `deliverables`；模型不能提交 `failed` / `cancelled` 或 metadata。
- 输入在 handler/controller 边界逐字段校验：分支必填文本 trim 后非空，数组只保留 trim 后非空的字符串并稳定去重，deliverables 逐项执行 parent-local URI policy。
- `SubmitResultController` 是每个 run 单独创建的一次性状态：`open → submitted`；第一次有效提交保存已规范化的模型 payload，重复提交返回可见 tool error，不覆盖首份 payload。
- controller 以 runtime 注入的 `{ subrunId, delegateAgentId, usage, toolDeliverables }` 构建 `SubAgentRunResult`；metadata 不信任模型，usage 必须是有限非负整数，tool 与 submit deliverables 合并后稳定去重。
- runtime failed/cancelled、timeout 和持久化失败继续由 Step 8/9 生成 system terminal result；已提交 payload 不能绕过最终 `Subrun.finish()`。

## 4. 未提交的纯决策

导出不依赖 session/manager 的 `decideMissingSubmit()`：

1. 首次模型停止且尚未提交，返回一次固定 reminder，要求调用 `submit_result`；
2. 已提醒后再次停止、到达 max turns，或当前 catalog 没有可用 tools：有 assistant content 则为 `partial`，`incompleteReason='result_not_submitted'`；无 content 则为 `failed`，错误为 `result_not_submitted`；
3. 不用自然语言意图 regex，不把最后 assistant 文本升级为 completed；
4. cancel、timeout、异常不经该函数，由 runtime status 优先决定。

Step 8 把该纯决策转为带 runtime metadata 的 terminal result，并将 reminder 作为 transient reminder 注入下一轮。

## 5. 不做

- 不实现完整 LLM loop、manager、顶层 `subagent` 注册或 renderer；
- 不调用 `Subrun.finish()`、不持久化 terminal data；
- 不修改旧 `lib/subAgent`、旧 app subagent 或其测试；
- 不新增/运行单测，不做 Electron/browser/manual/E2E 验证。

## 6. 静态验证与交接

- 运行影响分析、LSP diagnostics、typecheck、build；
- 静态确认普通 catalog 不调用 `withSubmitResult()`，全局 registry 没有 `submit_result`；
- 更新 `unit-test.md` 的 submit、metadata、URI、重复提交与 fallback 候选；
- 将实际 API 回写 Step 8，并同步模块文档与 progress。完成后停在 `awaiting-review`，不进入 Step 8。
