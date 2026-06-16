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

// 批 A:纯本地轻量。`read` 是统一读入口(取代了 read_file + read_office_file
// —— office 走 backend 内部 lazy import,首调时才解析 mammoth/jszip/pdfreader)。
import { read } from './read';
import { write } from './write';
import { find } from './find';
import { search } from './search';
import { ask } from './ask';

// Internal URL router 启动期注册全部 ProtocolHandler(skill / ...)—— 必须
// 在 `./read` 的 dispatch 真正被调用之前完成。side-effect import 保证。
import '@main/pi/internal-urls';

// 批 G:`app` shell 风格 facade(详见 ai.prompt/tool-system.md)。
// `../appcmd` side-effect import 必须在 `./app` 之前 —— `./app` 的
// `spec.description` getter 在首次被 pi 读取时会列举 `appCommands`,
// 此刻命令必须全部注册完毕。
import '../appcmd';
import { app } from './app';

// 批 B:依赖 main 子系统
import { shell } from './shell';

// 批 C:已下线(mcp / agent / skill → app shell)
// 批 D:已下线(schedule → app shell;feature flag 守卫挪到 `appcmd/index.ts`)
// 批 E:已下线(spawn / spawn-many → `app subagent` shell;feature flag 守卫挪到 `appcmd/index.ts`)
// 批 F 中 manage_process / move_file / coding_agent / get_current_datetime
// 已下线(Phase 8):前两者直接用 shell 自带能力(`&` job control + `mv`),
// `coding_agent` 整体移除(Phase 8c 把 `deskmateFeatureCodingAgent` flag
// 本身也从 `featureFlagDefinitions.ts` + `FeatureFlagName` union 一并删除,
// 不留 dead flag),`get_current_datetime` 改由 system prompt 直接注入当前时间。
// 批 F 中 read_file / read_office_file 也已下线(合并进 `read`;office impl 仍
// 是独立 lazy chunk,由 `read/backends/office.ts` 内部 `await
// import('../../impl/readOfficeFile')` 推迟到首调,bundle 行为完全一致)。

// 批 F:heavy / lazy(剩 download)
import { downloadFile } from './download';

let registered = false;
export function registerAllTools(): void {
  // 模块多次 import(测试环境常见)只走一次 ——`registry.register` 重名会抛,
  // 第二次进来会炸,这里用 flag 保护。
  if (registered) return;
  registered = true;

  // 批 A
  tools.register(read);
  tools.register(write);
  tools.register(find);
  tools.register(search);
  tools.register(ask);

  // 批 G:app shell facade。注册顺序对外部语义无影响,但需在 import 顺序
  // 之后(`../appcmd` side-effect 已经把 helloCommand 等灌进 appCommands)。
  tools.register(app);
  // 批 B
  tools.register(shell);

  // 批 F:heavy / lazy
  tools.register(downloadFile);
}

registerAllTools();

// Re-export 给上层 quick access。
export { tools } from './registry';
export type { LocalTool, ToolContext, ToolResult } from './types';
