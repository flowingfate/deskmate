# Step 12 — 可选：以 Dialog 查看 Subrun Messages

> 状态：待执行（Step 11 review 后可改为 `deferred`）
> 前置：Step 11 complete，并已完成 go/no-go 复杂度评估
> 下游：Step 13只需要知道本步 implemented 或 deferred
> 本步不阻塞核心统一重构。

## 1. 用户期望

Sub-Agent transcript已经持久化。工具卡片提供详情入口，点击后以 Dialog查看该 subrun的 messages列表。

用户明确允许：好做就做；如果 renderer改动过大，则把经过现状校验的方案留下后续实现，不强求本次完成。

## 2. Go / No-Go 判据

### Go：本次实现

同时满足：

- Step 6 store 可经 parent `Session.getSubrun(subrunId)` 的 found 分支调用 `Subrun.loadDomainMessages()`，不需要独立 files/session list API；
- 新增一个类型化 IPC即可取数据；
- 可用现有 Dialog、MarkdownView和小型只读tool展示组合；
- 不需要修改全局 chat render-items manager；
- 不需要创建新的全局 Context/provider；
- 每个新增组件 <500行；
- 不改变主聊天 messages/cache真相源。

### No-Go：标记 deferred

任一成立：

- 必须把 subrun transcript注入主 SessionManager；
- 必须重构 ChatContainer/render-items pipeline；
- 现有 message组件强绑定编辑/streaming/current-session context，复用会产生大量伪props；
- Dialog需要跨多层全局状态或明显超过本重构UI scope；
- Step 11 review后用户决定后置。

No-Go时不写placeholder代码；只更新本文件为基于实际代码的后续设计，progress标 deferred，继续Step13。

## 3. Go路径实现

### IPC

新增：

```text
getRunMessages(parentAgentId, parentSessionId, subrunId)
```

返回 Domain Message[] 或明确的只读DTO；优先复用事实类型，不制造第二套 message shape。handler按active profile/owner验证，不接绝对路径。

### Dialog状态

- 详情按钮点击后才lazy fetch；
- Dialog local state或就近 atom，按当前聊天UI既有Dialog模式选择；
- loading/error/empty/ready；
- 关闭后是否缓存按数据量决定，默认释放大 transcript；
- 切换另一个 subrun取消/忽略前一个请求结果，避免竞态。

### 展示

Header：Agent identity、`#001`、status、task、expected output、duration/usage。

Body：

- user/assistant按时间顺序；
- assistant Markdown复用 `MarkdownView`；
- thinking默认不展示，除非现有产品明确展示；
- tool calls用简化只读块或可安全复用的 ToolDetailView；
- deliverables可点击；
- transcript只读，无edit/retry/compose/cancel。

### Accessibility

- shadcn Dialog focus trap；
- Esc/close；
- trigger focus restore；
- 标题/描述ARIA关联；
- 长列表只有一个scroll region；
- 状态不只靠颜色。

## 4. 不做

- 不把 subrun加入普通 session list；
- 不允许继续对话；
- 不加入主Chat缓存；
- 不做全文搜索/export；
- 不做 browser/E2E/manual test；
- 不新增/运行新单测。

## 5. 静态验证

Go路径：typecheck/build/impact、IPC四层、component行数、主render pipeline无非必要修改。

No-Go路径：只更新 context/progress/unit-test/本step的verified design，不修改生产代码，并记录具体阻塞文件/依赖，不能写“太复杂”空结论。

## 6. 下游交接

- implemented：Step13保留新IPC/route并更新chat docs；Step14保留Dialog测试候选。
- deferred：Step13确保card没有可点击无效入口；Step14移除本步测试候选；progress记录未来任务入口。

## 7. Review 门禁

无论Go/No-Go都停下让用户review。只有用户确认 implemented或deferred后，Step13才开始。
