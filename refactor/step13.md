# Step 13 — 证明新路径唯一、删除残留旧源码、更新全局文档

> 状态：complete
> 前置：Step 9后端、Step 10配置UI、Step 11卡片、Step 12 Dialog 均已获用户确认完成
> 下游：Step 14只对稳定后的最终生产结构写单测
> 本步是最终源码 cleanup；不读取、迁移或删除用户磁盘上的旧数据。

## 1. 目标

确保新 `src/main/pi/subagent` 是唯一生产运行路径；证明旧 Sub-Agent 源码均已不可达并删除任何残留文件/测试。同步所有 ai.prompt文档，使下一 session不可能把旧模块误读为生产架构。

## 2. 开始前 review

1. 读取 progress中Steps 9–12的真实文件/API；
2. 全仓搜索旧符号、路径和入口；
3. 从 production roots 证明旧代码不可达；
4. 对仍有引用的残留先删除引用并验证新路径覆盖，再整体删除对应旧子树；
5. 运行所有实际修改文件的 impact，列出必须刷新文档；
6. 旧源码若阻碍 build/typecheck，直接定位并删除其最后生产引用及 orphan 源码，不修旧实现、不移动到 archive。

## 3. Production reachability检查

从真实入口向下检查：

- `tools/index.ts`只注册新顶层subagent；
- app registry不注册旧 app subagent；
- parent prompt只描述新tool；
- Regular/Job只调用新manager；
- startup IPC只注册新run/audit channels；
- preload/main ElectronAPI不暴露旧CRUD namespace；
- renderer routes/sidepanel/provider不加载旧CRUD UI/atom；
- persist snapshot/bootstrap不load/list旧SubAgents store；
- feature flag不控制新delegation能力。

旧文件之间的 self-import 不能作为保留理由；production root 不可达后整体删除。

## 4. 旧源码删除政策

- 不逐文件修旧签名、补兼容 shim或更新旧测试；
- `lib/subAgent` 与旧 app command 已由 Step 9 删除；Step 10 已删除旧 CRUD IPC/UI/atom、persist SubAgents store、旧 app renderer 和 shared contract。Step 13 只做最终全仓 reachability 证明，不恢复或修补这些路径。
- 本次全仓复核发现 `src/main/lib/evalHarness/` 仍在解析已删除的 `spawn_subagent` 返回格式，并通过 `RunTestResponse.sub_agent_messages` 暴露它；计划删除该解析、响应字段及专属旧测试，同时保留普通扁平 `messages` 工具结果。该字段属于外部 AgenticEval HTTP 协议，执行前须确认 clean cutover 可移除该兼容字段。
- 引用归零的子树连同测试和模块文档一起删除，不移动到 `tmp/` 或 archive；
- 新 `pi/subagent/ai.prompt.md` 明确禁止旧依赖方向；
- 旧本地 `sub-agents/` 数据目录完全不碰。

## 5. Shared/persist清理

确认生产 contract 不再暴露旧数据：

- PersistSnapshot不含subAgents；
- storage overview不把旧sub-agents作为可管理产品分类；
- production Agent detail只读 delegates，不保留旧 subAgents 字段/alias；
- old CRUD IPC/channel/type/source仍不存在；
- 无 migration code/journal/path。

不做破坏性磁盘schema修改；旧字段/文件被忽略。

## 6. 命名与工具文档

生产术语：

- Agent：配置实体；
- Sub-Agent：运行角色；
- subagent：顶层cmdline tool；
- subrun：父session下的`001`目录。

更新工具数、help examples和数据流：

```text
parent LLM → subagent tool → pi/subagent manager → SubAgentSession
→ parent-scoped subrun → formal result → parent tool result
```

## 7. 必须更新的文档

按实际impact为准，至少review：

- `ai.prompt/arch-main.md`；
- `ai.prompt/arch-render.md`；
- `ai.prompt/persist.md`；
- `ai.prompt/data-flow.md`；
- `ai.prompt/tool-system.md`；
- `src/main/pi/ai.prompt.md`；
- `src/main/pi/tools/ai.prompt.md`；
- `src/main/pi/subagent/ai.prompt.md`；
- `src/main/persist/ai.prompt.md`；
- `src/renderer/components/chat/ai.prompt.md`；
- `src/shared/ipc/ai.prompt.md`。
- 同步清理旧实现遗留的评测/trace 文档与 bootstrap 注释；保留“Sub-Agent”作为新运行角色的产品术语，不把新 `SubAgentRun*` / `SubAgentSession` 类型误删。

每个被修改的 ai.prompt更新 Last verified日期。文档必须区分已实现与deferred Dialog。

## 8. 静态验证

- 全部实际文件 impact；
- typecheck/build；
- production import/registration grep；
- 旧源码路径不存在，旧符号只允许出现在 refactor历史记录；
- 顶层tool/help/docs一致性；
- 不做E2E/浏览器/manual smoke；不新增单测。

如果用户需要实际行为确认，提供手工检查清单并停下，不自行执行。

## 9. `unit-test.md`冻结准备

- 根据最终实现删除已失效候选；
- Step 12 deferred则移除Dialog候选到future区；
- 给每条P0/P1标实际目标文件/API；
- 确认 `unit-test.md` 不含已删除旧源码/旧测试候选；
- 不创建测试文件。

## 10. 下游交接

Progress必须列出最终production roots和已删除的legacy源码闭包，证明旧实现不再存在。将Steps 1–13标记为业务逻辑已稳定、等待用户review。用户确认后才进入Step14。

## 11. Review 门禁

这是单测前最后一次架构review。任何用户反馈都先级联更新context、对应业务step和unit-test plan；不得因为“只剩测试”而跳过设计修正。
