/**
 * `app` 能力域的**子命令注册表** `appCommands`。
 *
 * 与 `web` 完全对等的结构:每个顶层工具拥有**自己的**注册表,与其成员命令
 * 同住一包(`builtins/app/` ←→ `builtins/web/`)。两个顶层工具都由
 * `makeCommandFacade(makeRouterCommand({ ..., registry }))` 生成 —— 路由 /
 * help / 描述索引逻辑同一份(`makeRouterCommand`),差异仅在「注册表里装了谁」。
 *   - `appCommands`:成员 hello / mcp / agent / skill / schedule / subagent
 *   - `webCommands`:成员 search / image / fetch / download
 *
 * kernel(`<domain>/kernel/*`)一字不改,业务由各 subcommand 的 `runXxx`
 * 承载,本文件只把各域导出的 `AppCommand` 装进注册表。
 *
 * 填充时机:模块加载期 eager 注册。`pi/tools/app.ts` import 本模块即触发,
 * `makeRouterCommand` 在首次被调用时读 `appCommands.list()`,此刻已注册完毕。
 * **feature-gated 成员**(schedule / subagent)按 flag 决定是否注册 —— 关掉时
 * 绝不注册,避免「列表里有但 execute 拒绝」(与 `web` 的无条件注册唯一的差别,
 * 纯因 app 域存在受控能力,不是结构上的特殊)。
 *
 * 设计文档:[`ai.prompt/tool-system.md`](../../../../ai.prompt/tool-system.md)
 */

import { isFeatureEnabled } from '@main/lib/featureFlags';

import { AppCommandRegistry } from '../../registry';

import { agentCommand } from './agent';
import { mcpCommand } from './mcp';
import { scheduleCommand } from './schedule';
import { skillCommand } from './skill';
import { subagentCommand } from './subagent';

/** app 域专属注册表 —— 与 `webCommands` 同形,只装 app 的子命令。 */
export const appCommands = new AppCommandRegistry();

// 批 Capability:真实能力(无 feature flag,默认全员可用)
appCommands.register(agentCommand);
appCommands.register(mcpCommand);
appCommands.register(skillCommand);

// 批 Capability(feature-gated):scheduler 默认开,关掉时绝不注册。
if (isFeatureEnabled('deskmateFeatureScheduler')) {
  appCommands.register(scheduleCommand);
}

// 批 Capability(feature-gated):subagent —— dev 默认开,生产默认关。
if (isFeatureEnabled('deskmateFeatureSubAgent')) {
  appCommands.register(subagentCommand);
}
