# Step 3 — 建立独立顶层 `subagent` cmdline facade（暂不注册）

> 状态：待执行
> 前置：Step 1 complete，request 字段/normalization 已固定
> 下游：Step 9 将 command kernel 接到 manager 并原子注册
> 本步不能向 LLM 暴露不可执行的空壳工具。

## 1. 为什么与 runtime 分开

`subagent` 与 `app`/`web` 并列是新的产品/API 边界。先独立 review cmdline grammar、help、parsing 和目录位置，可以防止 Step 9 manager 实现时顺手把 name lookup、旧 share-context 或 app command 形态带回来。

但 facade 若提前注册而 handler 未完成，会交付一个会失败的工具。因此本步只完成可复用 command object/parser/kernel interface，不修改 `tools/index.ts` 的生产注册。

## 2. 开始前 review

1. 阅读 `ai.prompt/tool-system.md`、`src/main/pi/appcmd/ai.prompt.md`（如存在）、`makeRouterCommand.ts`、`_facade.ts`；
2. 对比 `tools/app.ts` 与 `tools/web.ts`，只复用稳定通用基础设施；
3. 只读参考旧 `appcmd/builtins/app/subagent` 的参数痛点，不复制实现或测试；
4. impact 计划新增的 `pi/subagent/commands` 和 `tools/subagent.ts`；
5. 确认 Step 1 最终 request 字段名。

## 3. 目标目录

```text
src/main/pi/subagent/
  commands/
    index.ts
    run.ts
    runMany.ts
    parse.ts（只有真实共享解析逻辑时）

src/main/pi/tools/subagent.ts
```

- registry 与 commands 位于 `pi/subagent`，不是 `appcmd/builtins/app`；
- `tools/subagent.ts` 与 app/web 一样仅做 facade 装配；
- generic tokenizer/flags/router/facade 仍从 appcmd infrastructure 复用；
- 不创建第二套 tokenizer/flag parser。

## 4. Cmdline 契约

### 单任务

```text
subagent("run <agent-id> --task \"...\" --expect \"...\"")
```

可选：

- `--with-parent-summary`；
- `--max-turns <n>`；
- `--timeout-seconds <n>`；
- `--json` 只在与 facade 通用语义一致且确有用途时保留。

要求：agent-id/task/expect 缺失均是 usage error；不接受旧 name 主键、`inherit`、`context_access`、`share-context` 拼写或 full history。

### 并行任务

```text
subagent("run-many --config-json '[{...}]'")
```

只支持一个清晰的 JSON 数组入口，避免同时维护旧 `--task name:task` 与 config-json 两种语法。每项直接对应 Step 1 request 所需字段；错误必须指出数组 index。

### Help

- 顶层 help 列 run/run-many、两层限制、Agent ID 来源、expected output；
- 明确 sub-agent 不能调用 subagent tool；
- 不在 help 中承诺 async handle/join、full history、shell。

## 5. Kernel seam

commands 不 import 尚不存在的 concrete manager。定义最小 injected runner interface 或让 Step 9 填入真实 kernel，但不能交付 no-op：

- parser/command object 可以被静态构造；
- `run` 被实际调用时若 runner 未装配应属于不可注册状态，而不是返回 fake success；
- Step 9 production registration 必须同时提供 runner。

实现时优先让 command functions 接显式 `SubAgentCommandContext`/runner，避免全局 singleton 回读。

## 6. 生产注册门禁

本 step 明确不得：

- 修改 `src/main/pi/tools/index.ts` 注册 `subagent`；
- 修改 prompt 宣称工具可用；
- 删除旧 app command 注册（Step 9 原子切换）；
- 新增 feature flag。

## 7. 静态验证

- parser/command types 编译；
- facade 与 app/web generic infrastructure 类型对齐；
- build/impact；
- 不新增/运行新单测，不执行命令 smoke，不做端到端测试。

## 8. 下游交付

在 `progress.md` 记录：

- 最终 tool name、subcommands、flags；
- registry/facade/runner seam 文件；
- 生产未注册的证据（具体注册点未修改）；
- Step 9 需要实现的 manager call signature。

更新 Step 9 与 Step 11 renderer parser；更新 `unit-test.md` 的 parser/help 候选。

## 9. Review 门禁

用户 review command grammar 后才能进入依赖它的 Step 9。若语法变化，Step 11 的 renderer 解析计划必须同 session 更新。
