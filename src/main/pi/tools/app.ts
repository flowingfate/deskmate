/**
 * `app` LocalTool —— "应用内能力" 的统一 shell 入口。
 *
 * LLM 视角下,Deskmate 的所有应用能力(MCP 管理、agent 管理、schedule、
 * skill ...)都通过这一个工具调用。args 是一行 shell-style 字符串,宿主解析、
 * 路由到具体成员命令执行。
 *
 * **与 `web` 工具完全对等**(见 `web.ts`):两者都是
 * `makeCommandFacade(makeRouterCommand({ name, synopsis, registry }))`。
 * 唯一区别是各自路由的注册表 —— `app` 路由全局 `appCommands`(mcp / agent /
 * skill / ...),`web` 路由 `webCommands`(search / image / fetch / download)。
 * 路由 / help / 描述索引的逻辑是**同一份**(`makeRouterCommand`),不再有第二套
 * 手写 handler。
 *
 * **为什么是单工具 + 字符串 cmdline,不是 N 个 typed 工具**:
 *   - LLM 已经被训练过 shell 范式(npm/git/docker/kubectl 千万次曝光),
 *     传字符串 cmdline 激活的是它最强的那部分能力。
 *   - 工具列表行数 = O(1),与应用能力数无关,prompt cache 命中率高。
 *   - 渐进披露由 `<cmd> --help` 自然完成,无须 LLM 学习新协议。
 *
 * 设计文档:[`ai.prompt/tool-system.md`](../../../../ai.prompt/tool-system.md)
 */

import { makeCommandFacade } from '../appcmd/_facade';
import { makeRouterCommand } from '../appcmd/makeRouterCommand';
import { appCommands } from '../appcmd/builtins/app';

export const app = makeCommandFacade(
  makeRouterCommand({
    name: 'app',
    synopsis: 'Run any in-app command (mcp / agent / skill / schedule / ...)',
    registry: appCommands,
  }),
);
