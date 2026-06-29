/**
 * `web` 能力域的**子命令注册表** `webCommands`。
 *
 * 与 `app` 完全对等的结构:每个顶层工具拥有**自己的**注册表,与其成员命令
 * 同住一包(`builtins/web/` ←→ `builtins/app/`)。
 * 两个顶层工具都由 `makeCommandFacade(makeRouterCommand({ ..., registry }))` 生成
 * —— 路由 / help / 描述索引逻辑同一份,差异仅在「注册表里装了谁」。
 *
 * 成员命令:`search` / `image` / `fetch`(read-only)+ `download`(唯一**产出型**
 * 命令 —— 写文件,通过 `ctx.addDeliverable` 登记产出)。read-only 三命令无 `--yes`
 * / `--dry-run`;download 也不需 `--yes`(只创建新文件,非 `remove` 那种 destructive
 * op)。`--json` 全员遵守。kernel(`kernel/*`)承载业务,本文件只把它们包成
 * `AppCommand` 装进注册表。
 *
 * 填充时机:模块加载期 eager 注册(web 无 feature flag,不需要延迟 / 条件)。
 * `pi/tools/web.ts` import 本模块即触发,`makeRouterCommand` 在首次被调用时
 * 读 `webCommands.list()`,此刻已注册完毕。
 *
 * 设计文档:[`ai.prompt/tool-system.md`](../../../../ai.prompt/tool-system.md)
 */

import { AppCommandRegistry } from '../../registry';

import { downloadCommand } from './download';
import { fetchCommand } from './fetch';
import { researchCommand } from './research';
import { searchCommand } from './search';

/** web 域专属注册表 —— 与 `appCommands` 同形,只装 web 的子命令。 */
export const webCommands = new AppCommandRegistry();

webCommands.register(searchCommand);
webCommands.register(researchCommand);
webCommands.register(fetchCommand);
webCommands.register(downloadCommand);
