# Step 10 — 将 Agent 编辑器切换为 Delegation 配置 UI

> 状态：待执行
> 前置：Step 2 Agent graph complete；执行顺序上等待 Step 9 review，确保 UI 文案对应真实工具
> 下游：Step 13 入口收口、Step 14 renderer data tests
> 本步只改配置管理，不改运行卡片。

## 1. 目标

用户只管理普通 Agents：在 Basic 编辑 description，在 Delegation tab选择允许委派的其它 Agents。删除独立 Sub-Agent 产品入口，但旧源码文件暂留参考。

## 2. 开始前 review

1. 阅读 renderer架构 §8、chat agent-editor文档、AgentEditingView dirty/save-all流程；
2. 检查组件行数，`AgentEditingView` 已接近/超过限制时先按真实状态拆分，不继续堆逻辑；
3. 阅读 agents.atom/agentDetail.atom和 persist patch API；
4. 只读旧 AgentSubAgentsTab与独立 CRUD UI看交互信息，不复用旧 SubAgentConfig；
5. impact routes、settings sidepanel、ProfileDataProvider/snapshot；
6. 不启动浏览器或应用；视觉/行为验证留给用户。

Step 2 已具备输入：`AgentFrontPatch` 字段为 `description` / `delegates`；`CreateAgentInput` 可直接带 `description`；`AgentRecord.description` 是 hot 数据；`AgentDetail.delegates` 是 cold 数据。现有 `AgentPersona` compat bridge 已映射两字段，本 step 不得另造 snake_case `delegate_agents` alias。

## 3. Basic description

在 `AgentBasicTab` 增加：

- visible label；
- helper文本说明用于 Agent介绍与委派选择；
- maxlength与 main validation一致；
- inline error；
- dirty tracker/save-all；
- locked/readOnly语义明确。

Agent editor local `AgentConfig`、compat `AgentPersona` bridge、patch mapping同步字段。若可直接移除一段过时 compat mapping而不扩大 scope，优先直连 persist type；否则记录 Step 13清理。

## 4. Delegation tab

新增 `AgentDelegationTab.tsx`，替代生产使用的 `AgentSubAgentsTab.tsx`：

### 数据源

- candidates来自 `agents.atom` 的 active AgentRecord；
- 当前 Agent排除；
- selected IDs来自 current AgentDetail.delegates；
- 不读取 subAgents.atom，不调用 subAgent CRUD IPC；
- description已在 hot record，无需 map中循环调 detail hook。

### 展示

每项显示：

- Agent avatar/name；
- description（缺失有中性 fallback）；
- model；
- ID作为次要诊断文本/tooltip；
- selected checkbox。

### Dangling

已配置但不在 active registry的 ID仍显示 unavailable row：

- 有 warning icon + 文本，不只用颜色；
- 允许取消选择；
- 不伪造 name；
- restore后自然显示完整 Agent。

### 导航

- “Open Agent settings”通过真实 Agent ID深链；
- “Create Agent”走现有 Agent creation route；
- 不导航到 `/settings/sub-agents`。

### 可访问性/状态

- keyboard可操作 checkbox/link；
- visible focus；
- loading/empty/error/readOnly；
- 使用现有 shadcn/Lucide/semantic tokens；
- 不引入新视觉配色或全局 Context；
- 单组件 <500行，数据与纯展示按需要拆分。

## 5. Agent editor路由/状态

- tab key从 `sub_agents`改 `delegation`；
- route段使用 `delegation`；
- nav label改 `Delegation`；
- pendingChanges/tab cache/save-all全部改 delegates；
- feature flag不再控制新 Delegation tab；统一 Agent能力应稳定可见；
- 旧 agent settings sub-agents URL是否 redirect由当前 router能力决定：可做单向 redirect，但不能保留旧数据字段alias。

## 6. 删除独立产品入口

从 production routes/settings sidepanel/import graph移除：

- `/settings/sub-agents`；
- Create/Edit/List SubAgent pages；
- sidepanel项；
- ProfileDataProvider/useSubAgents生产消费；
- snapshot hydration对subAgents的依赖（shared/main snapshot实际移除可在本步或Step13，选择后需保持编译原子性）。

旧组件/atom/IPC文件可留在磁盘，Step13确认无 production imports。不要修它们、不加测试。

## 7. 不做

- 不做 runtime tool card/Dialog；
- 不改 manager；
- 不删除旧源码文件；
- 不做浏览器/E2E/手工 smoke；
- 不新增/运行新单测。

## 8. 静态验证

- typecheck/build/impact；
- 搜索 production route/nav/provider不再使用旧 Sub-Agent入口；
- 检查 component行数；
- 如需要确认 UX，停止请用户实际操作并反馈。


## 9. 下游交接

Progress记录最终 tab key/route、patch字段、candidate/dangling datasource、已取消的入口。Step13据此清理 snapshot/legacy registrations/docs；unit-test.md更新 editor data candidates。

## 10. 用户 review建议清单（由用户执行）

本 step不自行测试，但交付时列出给用户：description保存、A选择B、自身排除、archive/restore dangling、Save All/tab切换、键盘/暗色/窄窗、旧settings route。用户反馈若改变交互，Step13/14同步更新。

## 11. Review 门禁

交付静态编译结果和上述用户检查清单后，状态改为 `awaiting-review` 并停止。用户反馈若改变字段、tab route、dangling 展示或旧入口处置，必须先更新 Step 13、Step 14 和 `unit-test.md`。

