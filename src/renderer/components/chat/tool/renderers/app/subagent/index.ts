// src/renderer/components/chat/tool/renderers/app/subagent/index.ts
// `app subagent` 子命令域的路由 —— 根据第二个非 flag token 选 spawn /
// spawn-many 各自的 renderer 形态返回。
//
// 不直接 register 到全局 registry —— `app/index.ts` 拿到本路由后,在自己的
// chip / input / output slot 内部转接。

import type { ToolRenderer } from '../../../types';
import { subagentSpawnRenderer } from './spawn';
import { subagentSpawnManyRenderer } from './spawnMany';

/**
 * 给定 `app` cmdline 的非 flag token 切片(通常是 `firstNonFlagTokens(cmd, 2)`),
 * 当 sub === 'subagent' 时返回对应 sub-sub 的 renderer 形态;否则返回 null。
 */
export function resolveSubagentRenderer(tokens: string[]): ToolRenderer | null {
  if (tokens[0] !== 'subagent') return null;
  switch (tokens[1]) {
    case 'spawn':
      return subagentSpawnRenderer;
    case 'spawn-many':
      return subagentSpawnManyRenderer;
    default:
      return null;
  }
}
