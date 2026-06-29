/**
 * `web` 命令的内部小 helper。**只放跨 subcommand 复用的纯函数**;
 * subcommand 自己用一次的辅助逻辑留在那个 subcommand 文件里。
 *
 * 命名约定:带 `_` 前缀,与 `mcp/_shared.ts` 等同纪律。
 */

/** 把 `parseFlags` 出来的 string|true|string[]|undefined 收成 `string[]`。 */
export function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

/** 把 string 当 number 解,失败回 undefined(让 caller 走默认值或报错)。 */
export function parseNumberFlag(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : NaN;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return NaN;
}
