/**
 * AppCommand 中央注册表。模块级单例 `appCommands` 在启动时(由
 * `pi/appcmd/index.ts` 的副作用)填进来。
 *
 * 不变量:
 *   - `register` 重名直接 throw —— 与 LocalTool registry 同纪律,杜绝
 *     静默覆盖。
 *   - 命名空间是全局的:LLM 提示 / `app --help` 列表 / 错误回显都按
 *     name 直接拼字面,改名 = 用户可见的破坏性变化。
 *
 * 与 LocalTool registry 的关系:
 *   - 两套独立的容器,无依赖。`app.ts`(LocalTool)只在 handler 内**调用**
 *     `appCommands.get(name)`;反向不允许。
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

/** 生产单例。启动注册由 `pi/appcmd/index.ts` 的副作用完成。 */
export const appCommands = new AppCommandRegistry();
