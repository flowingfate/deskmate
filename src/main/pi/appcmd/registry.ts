/**
 * `AppCommandRegistry` —— AppCommand 容器类。每个顶层 router 工具拥有自己的
 * 实例,与其成员命令同住一包,eager 注册:
 *   - `appCommands`(`builtins/app/index.ts`):成员 hello / mcp / agent / skill / ...
 *   - `webCommands`(`builtins/web/index.ts`):成员 search / image / fetch / download
 * `pi/tools/{app,web}.ts` import 对应 index 即拿到填充好的实例。
 *
 * 不变量:
 *   - `register` 重名直接 throw —— 与 LocalTool registry 同纪律,杜绝静默覆盖。
 *   - 命名空间按实例隔离:LLM 提示 / `<tool> --help` 列表 / 错误回显都按 name
 *     直接拼字面,改名 = 用户可见的破坏性变化。
 *
 * 本文件**只**导出类,不持有任何单例。与 LocalTool registry 是两套独立容器,
 * 无依赖;facade 只在 handler 内**调用** `registry.get(name)`,反向不允许。
 */

import type { AppCommand } from './types';

export class AppCommandRegistry {
  private readonly entries = new Map<string, AppCommand>();

  /** 注册命令。重名直接 throw —— 模块加载期就把冲突暴露在 stack trace。 */
  register(cmd: AppCommand): void {
    if (this.entries.has(cmd.name)) {
      throw new Error(`[appcmd] duplicate command name: ${cmd.name}`);
    }
    this.entries.set(cmd.name, cmd);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  get(name: string): AppCommand | undefined {
    return this.entries.get(name);
  }

  /** 按 name 升序返回 —— 让 `app --help` 输出稳定可读。 */
  list(): AppCommand[] {
    return Array.from(this.entries.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  listNames(): string[] {
    return this.list().map((c) => c.name);
  }
}
