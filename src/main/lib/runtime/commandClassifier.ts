import * as path from 'path';
import type { InternalToolType } from '@shared/types/runtimeTypes';

/**
 * 命令名 → 所需内置工具的静态映射。
 * JS 系（node/npm/npx/bun）走 bun；Python 系（python/pip/uv/uvx …）走 uv。
 */
const TOOL_BY_COMMAND: Record<string, InternalToolType> = {
  node: 'bun',
  npm: 'bun',
  npx: 'bun',
  bun: 'bun',
  bunx: 'bun',
  python: 'uv',
  python3: 'uv',
  pip: 'uv',
  pip3: 'uv',
  uv: 'uv',
  uvx: 'uv',
};

/** 归一化命令名：去目录、转小写、剥离 Windows 的 .exe/.cmd 后缀。 */
const normalize = (command: string): string =>
  path.basename(command).toLowerCase().replace(/\.(exe|cmd)$/, '');

/**
 * 归一化后查表，命中即返回对应内置工具，否则 null。
 * 例：`/usr/local/bin/NODE.EXE` → `node` → 'bun'。
 */
const toolFor = (command: string): InternalToolType | null =>
  TOOL_BY_COMMAND[normalize(command)] ?? null;

/**
 * 判断一次 spawn（command + args）需要哪个内置运行时，未知则返回 null。
 *
 * - JS / Python 系命令 → 直接查表。
 * - Windows 的 `cmd /c <真实命令> …` → 判断真实命令。
 * - 其它 → null（不为未知命令投机安装）。
 */
export function detectRuntimeNeed(
  command: string,
  args: readonly string[] = [],
): InternalToolType | null {
  const direct = toolFor(command);
  if (direct) return direct;

  // Windows: `cmd /c <real-command> ...`
  if (normalize(command) === 'cmd' && args.length >= 2 && args[0].toLowerCase() === '/c') {
    return toolFor(args[1]);
  }
  return null;
}
