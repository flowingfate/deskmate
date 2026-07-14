/**
 * `web` LocalTool —— Web 抓取与搜索能力的一等 shell 入口。
 *
 * web 对 AI agent 是比重最高的能力域之一,因此与 `app` 同级,作为顶层工具:
 * `web("search ...")` / `web("fetch ...")` 直接调用。
 *
 * **与 `app` 工具完全对等**:同一条 `makeCommandFacade(makeRouterCommand(...))`
 * 构建路径,唯一区别是路由的注册表是 `webCommands`(成员 search / image / fetch /
 * download)而非全局 `appCommands`。使用机制 100% 一致 —— 单个 shell-style
 * `cmd` 字符串、`--help` 渐进披露、`--json` 结构化输出、exit code 语义全部共享。
 *
 * 设计文档:[`ai.prompt/tool-system.md`](../../../../ai.prompt/tool-system.md)
 */

import { makeCommandFacade } from '../appcmd/_facade';
import { makeRouterCommand } from '../appcmd/makeRouterCommand';
import { webCommands } from '../appcmd/builtins/web';

export const web = makeCommandFacade(
  makeRouterCommand({
    name: 'web',
    synopsis: 'Search / image-search the web, fetch URLs, download files',
    registry: webCommands,
  }),
);
