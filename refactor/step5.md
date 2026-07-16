# Step 5 — 建立 Delegate Execution Context 与能力边界

> 状态：complete（delegate-only scope、静态验证、文档已完成，用户 review 通过）
> 前置：Step 1 run contract、Step 2 Agent graph、Step 3 command seam、Step 4 parent/session context
> 下游：Steps 6、7、8、9、14
> 本步只建立 delegate-only AsyncLocalStorage 和在真实能力边界的判断。不改变 normal execution 的上下文模型，不预建 submit_result route。

## 1. 决策

正常 Agent execution **没有** delegate context：`getDelegateExecution()` 返回 undefined。未来 `SubAgentSession` 真正运行 delegate 时，最外层唯一调用：

```ts
runWithDelegateExecution({ delegateId }, () => session.run())
```

`AsyncLocalStorage` 只存 delegate ID。parent profile/agent/session 继续来自现有 ToolContext / ResolveContext，不重复塞入 store。

禁止在 RegularSession、JobRun、executeToolCall、InternalUrlRouter 建 normal scope 或 fallback scope；禁止 `enterWith()`、全局 mutable flag、eventSender 或 IPC 角色推断。

## 2. Scope 契约

新文件 `src/main/lib/delegateExecutionScope.ts`：

```ts
interface DelegateExecutionContext {
  readonly delegateId: string;
}
```

- `runWithDelegateExecution(context, action)`：仅 Step 8 delegated run root 使用；
- `getDelegateExecution()`：其它能力边界读取；undefined = existing normal path；
- 不导出 agent scope、require helper、executionAgentId helper 或其它角色抽象。

## 3. 能力边界

在 `getDelegateExecution()` 有值时：

- ToolCatalog 按 LocalTool 对象黑名单过滤；当前只隐藏交互式 `ask`。`subagent` 尚未构造，Step 9 注册真实对象时再加入黑名单以禁止嵌套；
- read/write/find/search、shell、download 与其它 app/web 子命令保持普通 Agent 行为；Local 仍用 parent context，Knowledge/Skill 用 `delegateId ?? ctx.agentId`；
- `web research` 拒绝；已知 shell device-auth 命令在启动前拒绝，不能创建 human-loop 卡片；
- MCP Auth 保持普通全局 consent/client-id/browser 流程；
- 无 delegate context 时，所有上述能力保持 Step 5 前的正常行为。

## 4. Catalog

本步不创建 runtime-only route、inline ToolRoute 或 `withTool()`。Step 7 在真实 `submit_result` handler 出现时，再在其步骤内实现满足“普通 catalog 不可见”的最小私有 route。

删除当前的 agent/delegate general scope、RegularSession/JobRun wrappers、dispatcher/router scope fallback，以及提前增加的 inline route API。

## 5. 不做

- 不实现 session/manager/store；
- 不注册顶层 subagent；
- 不修改旧 `lib/subAgent`、旧 app command、旧 persist/UI；
- 不迁移或读取旧 sub-agents 数据；
- 不新增/运行单测、不开应用、不做 E2E。

## 6. 验证与交接

- LSP diagnostics、impact、typecheck、build；
- normal execution 不创建 scope，RegularSession/JobRun 回到原始行为；
- 搜索无 scope fallback、agent scope、inline route 或提前 submit extension；
- 更新 context、progress、unit-test、Steps 6–9、14 与模块文档；
- Step 8 必须建立唯一 delegate scope root；Step 7 不再依赖预建 extension seam。

## 7. 实际交付（2026-07-16）

- 新建 `src/main/lib/delegateExecutionScope.ts`，只含 `delegateId`、`runWithDelegateExecution`、`getDelegateExecution`、`isDelegatedExecution`。
- 删除 normal scope、RegularSession/JobRun wrapper、executeToolCall/InternalUrlRouter fallback、inline ToolRoute 与提前 submit route API。
- Local 保持既有 parent ToolContext；Knowledge/Skill 在 delegate context 存在时取 delegateId。
- catalog 只排除 `ask`；read/write/find/search、shell、app/web、download 与 MCP Auth 回到普通行为。`web research` 与已知 shell device-auth 命令在执行边界拒绝。
- 删除上一轮 `agentExecutionScope.ts` general scope；未修改旧 backend/app command/persist/UI。
- 更新 context、Steps 4/6/7/8/9、unit-test 与模块架构文档。

## 8. Review 门禁

用户 review 已通过；Step 6 仅在用户另行开始后执行。
