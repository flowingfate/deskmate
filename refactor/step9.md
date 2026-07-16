# Step 9 — 实现 Manager、接通顶层工具并切换主进程生产路径

> 状态：待执行
> 前置：Step 3 command seam、Step 6 store、Step 8 single-session API complete
> 下游：Steps 11、13、14
> 这是新后端第一次对 LLM 生效的原子 cutover。

## 1. 为什么集中在一个 step

不能先注册 `subagent` 再补 manager，也不能先移除 `app subagent` 后留下空窗。本步把 manager、command kernel、top-level registration、parent prompt 和旧 command unregister 一次接通，确保任何可见入口都能真实执行。

## 2. 开始前 review

1. 从 progress 读取 Step 3/6/8 的实际 APIs，不按计划中的示例猜；
2. 搜索所有生产注册：tools/index、app commands、feature flag、prompt template；
3. 搜索 parent cancel 路径和 ToolContext callback seam；
4. 写出 manager state key：必须包含 parent identity + 三位 subrunId；
5. impact Pi root exports、tool registration、session regular/job、app command registry；
6. 若 Step 8 尚未用户 review complete，不开始本 cutover。
7. runtime event 使用 Step 1 的 `SubAgentRuntimeState`，terminal result 使用 `SubAgentRunResult`；不得弱化 parent identity 或复制第二套状态 shape。

## 3. `src/main/pi/subagent/manager.ts`

Manager 负责 orchestration，不复制 session逻辑：

- 按 profile/parent Agent/session/request 校验；
- 调 Step 2 resolver确认 parent授权 target、target active、非 self；
- 通过 parent Session创建 Step 6 subrun，取得 `001..999`；
- 创建 per-run AbortController并启动 Step 8 SubAgentSession；
- 同 parent session max parallel=5、max total=20；
- run-many用 `Promise.allSettled`，单个失败不影响 siblings；
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

将 Step 3 `run` / `run-many` 接 manager：

- parser只负责 cmdline → normalized request；
- manager负责授权/limits/store/session；
- output是稳定 JSON envelope，包含 formal result和 parent-scoped subrunId；
- 不输出旧 `<sub_agent_result>` 自由文本包；
- 不按 name lookup；
- command必须透传 signal、tracer、profile/agent/session owner、correlationId。

## 5. 注册新顶层工具

在 `src/main/pi/tools/index.ts` 注册 `subagent` facade：

- 与 app/web并列；
- spec description列出 commands synopsis；
- 普通 Agent catalog是否可见仍受其 tools selection规则，但若 parent想委派且未启用 subagent，应有清楚配置/UI表现；具体默认可见语义在本 step review时对齐现有 tools白名单；
- SubAgentSession reduced catalog强制移除，不受 target tools selection影响。

更新 tool-system文档的顶层工具数和分工。

## 6. 下线旧 `app subagent`

- 从 `appCommands` production registry取消注册；
- 从 app help/synopsis移除；
- parent prompt示例全部改 `subagent("run ...")`；
- 旧 command文件保留只读参考，不修改业务、不运行旧测试；
- 不留 alias或转发 shim。

## 7. Parent prompt 与 context callback

`pi/prompt.ts`：

- 读取 parent delegates IDs；
- join active AgentRecord，展示 ID/name/description/model；
- dangling targets不提供可执行示例，并记录/显示 unavailable；
- 指导 task/expect具体化；
- 不暴露旧 global subAgents registry；
- SubAgentSession自身 prompt不注入 delegation list。

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
- 不删除旧源码；
- 不迁移旧数据；
- 不新增/运行新单测；
- 不做端到端/手工运行。

## 10. 静态验证

- typecheck/build/impact；
- 搜索 production registry确认新 tool registered、旧 app command未注册；
- 搜索新 production imports确认不依赖旧 `lib/subAgent`/persist SubAgents；
- 静态确认 timer/signal/finally cleanup路径完整；
- 若只有真实 LLM运行才能判断，状态改 `blocked-for-user-test`，让用户测试。

## 11. 下游交接

Progress记录：manager API、state subscription、cancel APIs、tool result JSON、prompt格式、生产注册点。更新 Step 11 renderer与IPC计划、Step 13 cleanup清单、unit-test manager候选。

## 12. Review 门禁

本 step完成后必须由用户决定新后端是否可接受。未获 review complete，不进入 renderer runtime UI。任何 tool syntax/result JSON变化要同步 Step 11 parser和 unit-test plan。
