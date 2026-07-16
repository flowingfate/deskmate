// src/renderer/components/chat/tool/registerBuiltins.ts
// 集中注册所有内置 ToolRenderer。模块 import 副作用触发注册;由 barrel
// (`./index.ts`)在自身被 import 时连带执行,确保 ToolCallsSection 渲染前
// 注册表已就绪。
//
// 一个 toolName 一个坑;子命令分派(如 `app` 内部分到 `subagent` /
// `mcp` / `skill`)是各 renderer 自身的实现细节,在 `renderers/<tool>/`
// 子目录里完成,本表不感知。

import { registerToolRenderer } from './toolRendererRegistry';
import { appRenderer } from './renderers/app';
import { shellRenderer } from './renderers/shell';
import { writeRenderer } from './renderers/write';
import { webRenderer } from './renderers/web';
import { subagentRenderer } from './renderers/subagent';

let registered = false;

export function registerBuiltinToolRenderers(): void {
  if (registered) return;
  registered = true;

  registerToolRenderer('app', appRenderer);
  registerToolRenderer('shell', shellRenderer);
  registerToolRenderer('write', writeRenderer);
  registerToolRenderer('web', webRenderer);
  registerToolRenderer('subagent', subagentRenderer);
}
