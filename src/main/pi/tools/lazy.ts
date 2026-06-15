/**
 * Lazy tool wrapper:首次执行时再 `import()` 实现模块。
 *
 * - spec 在模块加载期就有 —— LLM 列表 / settings UI / registry 都能立刻列举。
 * - handler 首次被 invoke 时才解析 loader,之后缓存 resolved handler;主
 *   bundle 体积不被 playwright / mammoth / pdfreader 等重模块拖累。
 *
 * loader 抛出的错误透传给 caller;不在这里 swallow —— registry.execute 的
 * try/catch 已经把 handler throw 落成 `{ ok: false }`,语义一致。
 */

import type { Static, Tool as PiTool, TSchema } from '@earendil-works/pi-ai';

import type { LazyHandlerLoader, LocalTool, ToolContext, ToolResult } from './types';

export function lazy<TParams extends TSchema>(
  spec: PiTool<TParams>,
  loader: LazyHandlerLoader<TParams>,
): LocalTool<TParams> {
  type Resolved = (args: Static<TParams>, ctx: ToolContext) => Promise<ToolResult>;
  let resolved: Resolved | null = null;
  let inflight: Promise<Resolved> | null = null;

  return {
    spec,
    async handler(args, ctx) {
      if (!resolved) {
        // 并发首调时复用同一个 import,避免重复 evaluate 重模块。
        if (!inflight) {
          inflight = loader().then((h) => {
            resolved = h;
            return h;
          });
        }
        await inflight;
      }
      if (!resolved) throw new Error(`Lazy handler for "${spec.name}" failed to load`);
      return resolved(args, ctx);
    },
  };
}
