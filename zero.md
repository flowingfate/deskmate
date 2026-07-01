# Zero State 机制清理总结

## 背景

聊天区的 "zero state" 实际是**两套并存**的机制，本次已全部移除（为后续重新设计腾出白纸）：

| 机制 | 数据来源 | 触发 | 原渲染组件 |
|---|---|---|---|
| **A. Quick-Start 卡片** | `agent.zeroStates.quick_starts`（冷配置） | 会话空 + 有配置 | `ChatZeroStates` |
| **B. Greeting 欢迎语** | `session.greetingContent`（运行时会话态） | New Chat 时注入 | `GreetingMessage` |

清理深度：**渲染 → 运行时接线 → 数据模型 → CLI** 全垂直移除（含破坏性 schema 变更，已授权）。

## 删除清单

### 整文件删除（11 个）
- `ChatZeroStates.tsx` + `ChatZeroStates.scss`
- `message/GreetingMessage.tsx`、`SayHiActionItems.tsx`、`SayHiCard.tsx`
- `lib/cache/quickStartImageCacheManager.ts`
- `startup/ipc/quick-start-image-cache.ts`
- `shared/ipc/quickStartImageCache.ts`、`renderer/ipc/quickStartImageCache.ts`、`preload/quickStartImageCache/`

### 编辑清理
- **渲染层**：`ChatViewContent.tsx`（删 prop / isEmpty / showZeroStates / 过时注释表）、`ChatView.tsx`（删 zeroStates 派生）、`ChatContainer.tsx`（删 `<GreetingMessage />`）
- **运行时**：`startNewSessionFor.ts`（重建为纯 sessionId 生成）、`session-manager.ts` + `agentSessionCacheManager.ts`（删 `greetingContent` / `setGreetingContent` / `CurrentSessionGreeting`）、`sendUserMessageOptimistically.ts`（删孤儿 `sendUserPrompt`）
- **CLI**：`_shared.ts`（`parseQuickStartFlag` / `buildZeroStates`）、`add.ts` / `update.ts`（`--greeting` / `--quick-start` flag）、`kernel/createAgent.ts` / `updateAgent.ts`（`zero_states` 入参）
- **数据模型**：`profileTypes.ts`（`ZeroStates` / `QuickStartItem` / `DEFAULT_ZERO_STATES` / `zero_states` 字段）、`shared/persist/types.ts`、`main/persist/agent.ts` / `profile.ts`、`agentOps.ts` 映射、`userData/types/index.ts` 导出
- **常量**：`endpoints.ts`（`QUICK_START_IMAGE_URL`）、`path.ts`（`getQuickStartImageCacheDir`）
- **文档**：6 个 `ai.prompt.md` + `arch-main / arch-render / data-flow / persist.md`
- **测试**：删除 3 个 zero_states / greeting / quick-start 相关用例与断言

## 破坏性变更

磁盘上已配 `zero_states` 的 `AGENT.md`：该字段现无类型、无处理路径，读取时被 YAML 解析器捡起但静默丢弃。数据模型已归零，重新设计时无历史包袱。

## 验证

- `npm run typecheck` → PASS
- `npm run build` → PASS
- 受影响测试（persist + appcmd/agent，5 文件）→ 67 passed
- 全仓 grep 13 个关键词 → 零残留
