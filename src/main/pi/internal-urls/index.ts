/**
 * Internal URL routing 入口。
 *
 * Side-effect import 这个文件 → 把全部 ProtocolHandler 注册到 process-global
 * {@link InternalUrlRouter}。同 `pi/tools/index.ts` 模式:
 *
 * - `registerAllInternalUrlHandlers()` 幂等(双 import / 测试热重载安全)
 * - 注册顺序与 LLM 体验无关,但保持稳定 / 按域分组 / 加新 handler 往对应组里塞
 * - 重名 throw —— 由 {@link InternalUrlRouter.register} 强制
 *
 * 文档:`ai.prompt/tool-system.md`(Internal URL Router 章节)
 */
import { KnowledgeProtocolHandler } from './handlers/knowledge-protocol';
import { LocalProtocolHandler } from './handlers/local-protocol';
import { SkillProtocolHandler } from './handlers/skill-protocol';
import { InternalUrlRouter } from './router';

let registered = false;

export function registerAllInternalUrlHandlers(): void {
  if (registered) return;
  registered = true;

  const router = InternalUrlRouter.get();
  // 批 A:profile-scoped 静态资产(skill / agent / sub-agent / rule / memory)
  router.register(new SkillProtocolHandler());
  // 批 B:agent / session 级可写 sandbox(local / knowledge)
  router.register(new LocalProtocolHandler());
  router.register(new KnowledgeProtocolHandler());
  // 批 C:跨进程 / 网络(mcp / issue / pr)—— 后续
}

registerAllInternalUrlHandlers();

// Re-export 给上层 quick access
export { InternalUrlRouter } from './router';
export { parseInternalUrl, isInternalUrlInput } from './parse';
export { toResolveContext, toWriteContext, ResourceNotFoundError } from './types';
export type {
  ProtocolHandler,
  InternalResource,
  ResolveContext,
  WriteContext,
  ParsedInternalUrl,
} from './types';
