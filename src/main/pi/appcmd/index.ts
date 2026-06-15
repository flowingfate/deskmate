/**
 * AppCommand 启动注册。**只**通过 side-effect 注册到 `appCommands` 单例
 * —— 与 `pi/tools/index.ts` 同模式。
 *
 * 调用时机:`pi/tools/index.ts` 在 `import { app } from './app'` 时,
 * `app.ts` 反向 `import '../appcmd/registry'` 拿单例;那一刻 `appCommands`
 * 还是空的。**真正**触发本文件注册的,是 `pi/tools/index.ts` 顶层显式
 * `import './../appcmd'`(side-effect import)。
 *
 * 为什么本文件不被 `app.ts` 直接 import:
 *   - 循环风险:`app.ts` ← `appcmd/index.ts` ← `appcmd/builtins/hello/` →
 *     潜在业务模块。`app.ts` 只依赖 `appcmd/registry.ts`(无副作用)和
 *     `appcmd/dispatcher.ts`,本文件由顶层 wiring 显式负责。
 *   - 测试隔离:单测构造独立 `AppCommandRegistry` 实例时不会被本文件
 *     的副作用污染。
 *
 * 注册顺序在 LLM 看到的工具描述里**不**影响语义(`registry.list()` 总按
 * name 排序),但保持稳定有助于 prompt cache 命中率;新加命令往对应分组
 *塞,不要散落。
 */

import { appCommands } from './registry';

// ---- 骨架示范命令 ----
import { helloCommand } from './builtins/hello';

// ---- 真实命令 ----
import { isFeatureEnabled } from '@main/lib/featureFlags';

import { agentCommand } from './builtins/agent';
import { mcpCommand } from './builtins/mcp';
import { scheduleCommand } from './builtins/schedule';
import { skillCommand } from './builtins/skill';
import { subagentCommand } from './builtins/subagent';
import { webCommand } from './builtins/web';

let registered = false;

/**
 * 注册全部内置 AppCommand。重复调用幂等 —— 与 `registerAllTools` 同纪律,
 * 兼容测试环境多次 import。
 */
export function registerAllAppCommands(): void {
  if (registered) return;
  registered = true;

  // 批 Skeleton:demo / 模板
  appCommands.register(helloCommand);

  // 批 Capability:真实能力(无 feature flag,默认全员可用)
  appCommands.register(agentCommand);
  appCommands.register(mcpCommand);
  appCommands.register(skillCommand);
  appCommands.register(webCommand);

  // 批 Capability(feature-gated):scheduler 默认开,关掉时绝不注册 ——
  // 与老 `pi/tools/index.ts` 批 D 同纪律,避免"列表里有但 execute 拒绝"。
  if (isFeatureEnabled('deskmateFeatureScheduler')) {
    appCommands.register(scheduleCommand);
  }

  // 批 Capability(feature-gated):subagent —— `deskmateFeatureSubAgent`
  // dev 默认开,生产默认关。关掉时绝不注册,与 scheduler 同纪律;`app`
  // 工具描述里的 synopsis 自然不出现 `subagent`,prompt cache 也不会被
  // 误导。
  if (isFeatureEnabled('deskmateFeatureSubAgent')) {
    appCommands.register(subagentCommand);
  }
}

registerAllAppCommands();

// Re-export 给上层 quick access
export { appCommands } from './registry';
export type { AppCommand, AppCmdContext, AppCmdInternalResult } from './types';
