# Step 13 — 收口生产入口、隔离旧参考代码、更新全局文档

> 状态：待执行
> 前置：Step 9后端、Step 10配置UI、Step 11卡片完成；Step 12已明确 implemented/deferred
> 下游：Step 14只对稳定后的最终生产结构写单测
> 本步是业务代码cleanup，不物理删除用户数据，也不强制删除旧源码。

## 1. 目标

确保新 `src/main/pi/subagent` 是唯一生产运行路径；旧 Sub-Agent代码即使留在仓库，也不被启动、注册、IPC、prompt、UI或新代码引用。同步所有 ai.prompt文档，使下一 session不会误读旧模块为生产架构。

## 2. 开始前 review

1. 读取 progress中Steps 9–12的真实文件/API；
2. 全仓搜索旧符号和入口；
3. 区分：production reachable、legacy internal self-reference、docs/history；
4. 不因为搜索命中旧文件就机械删除；用户允许其留档；
5. 运行所有实际修改文件的 impact，列出必须刷新文档；
6. 如果旧源码阻碍build/typecheck，先向用户说明并决定“最小修到可编译”还是“移动到非编译archive”，不能擅自大删。

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

旧文件之间互相import可以存在，但不能从production root可达。

## 4. 旧代码保留政策

默认：文件留在原路径作为reference，不修、不测试、不协变。通过以下方式降低误用：

- `arch-main.md`、persist/Pi docs从生产模块表移除旧系统；
- 旧模块 `ai.prompt.md` 顶部改成明确的 LEGACY / NOT PRODUCTION（只改文档，不重写代码）；
- 新 `pi/subagent/ai.prompt.md` 明确禁止import旧模块；
- 如旧代码在编译期持续造成类型耦合，提出把整套旧目录移动到 `tmp/legacy-subagent-reference/` 的选项，等待用户决定；本 step默认不移动。

旧本地 `sub-agents/` 数据完全不碰。

## 5. Shared/persist清理

从新生产 contract删除旧数据暴露：

- PersistSnapshot不再含subAgents；
- storage overview不再把旧sub-agents作为可管理产品分类；旧目录字节可落profileConfig兜底；
- production Agent detail只读 delegates；旧subAgents字段可因legacy源码编译暂留类型，但需标deprecated/reference且新代码零引用；
- old CRUD IPC不注册；
- no migration code/journal/path。

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

每个被修改的 ai.prompt更新 Last verified日期。文档必须区分已实现与deferred Dialog。

## 8. 静态验证

- 全部实际文件 impact；
- typecheck/build；
- production import/registration grep；
- 顶层tool/help/docs一致性；
- 不做E2E/浏览器/manual smoke；
- 不新增单测。

如果用户需要实际行为确认，提供手工检查清单并停下，不自行执行。

## 9. `unit-test.md`冻结准备

- 根据最终实现删除已失效候选；
- Step 12 deferred则移除Dialog候选到future区；
- 给每条P0/P1标实际目标文件/API；
- 记录不测试旧reference代码；
- 不创建测试文件。

## 10. 下游交接

Progress必须列出最终production roots和所有仍保留legacy目录，证明它们不可达。将Steps 1–13标记为业务逻辑已稳定、等待用户review。用户确认后才进入Step14。

## 11. Review 门禁

这是单测前最后一次架构review。任何用户反馈都先级联更新context、对应业务step和unit-test plan；不得因为“只剩测试”而跳过设计修正。
