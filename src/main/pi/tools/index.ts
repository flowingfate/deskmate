/**
 * 本地工具启动注册。被 `pi/index.ts` 顶层 import 触发的 side-effect 副作用,
 * 把全部本地工具按"批"灌进 `tools` 单例。
 *
 * 这里**不放任何 LLM 看见的工具实现** —— 实现各自落在 `pi/tools/<name>.ts`
 * (轻量,模块加载期 import)或 `pi/tools/impl/<name>.ts`(重依赖,经
 * `lazy(spec, () => import(...))` 或 backend 内部 `await import()` 推迟到首调)。
 *
 * 注册顺序对 LLM 看到的工具列表顺序没有语义,但保持稳定有助于 prompt cache
 * 命中率;按"逻辑分组 + feature flag"排,新加工具往对应组里塞,不要散落。
 */

import { tools } from './registry';

// —— office 走 backend 内部 lazy import,首调时才解析 mammoth/jszip/pdfreader)。
import { read } from './read';
import { write } from './write';
import { find } from './find';
import { search } from './search';
import { ask } from './ask';

// Internal URL router 启动期注册全部 ProtocolHandler(skill / ...)—— 必须
// 在 `./read` 的 dispatch 真正被调用之前完成。side-effect import 保证。
import '@main/pi/internal-urls';
import { app } from './app';
import { web } from './web';
import { shell } from './shell';

let registered = false;
export function registerAllTools(): void {
  // 模块多次 import(测试环境常见)只走一次 ——`registry.register` 重名会抛,
  // 第二次进来会炸,这里用 flag 保护。
  if (registered) return;
  registered = true;

  tools.register(read);
  tools.register(write);
  tools.register(find);
  tools.register(search);
  tools.register(ask);

  tools.register(app);
  tools.register(web);
  tools.register(shell);
}

registerAllTools();

// Re-export 给上层 quick access。
export { tools } from './registry';
export type { LocalTool, ToolContext, ToolResult } from './types';
