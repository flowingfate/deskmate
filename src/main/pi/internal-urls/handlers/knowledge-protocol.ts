/**
 * `knowledge://` —— agent 级 Knowledge Base sandbox。
 *
 * URL 形态:
 * - `knowledge://<path>` —— 解析为 `${agentRoot}/knowledge/<path>`
 *
 * Knowledge Base 路径**固定**为 `${agentRoot}/knowledge`,不再支持 AGENT.md
 * 配置覆盖。撤掉这条曾经依赖 `@DESKMATE_AGENT_KNOWLEDGE` 占位符 + agent
 * front-matter `knowledge.knowledgeBase` 的可调路径,改成固定布局后:
 * - 调用方 / 用户都看不到 KB 路径选择,UI 上 "Knowledge Folder" tab 仅做
 *   文件浏览,不再设路径。
 * - sub-agent 的 KB 继承也随之失效(parent 没有 KB 字段可继承)。
 *
 * 设计取舍:
 * - **immutable: false** —— Knowledge Base 是 LLM 可写的跨 session 持久区。
 *
 * 通用 read/write/边界检查/错误消息形态在 {@link SandboxProtocolHandler} 基类。
 */
import { PERSIST_PATH } from '@shared/persist/path';
import { getAppRoot } from '@main/persist/lib/root';
import { getDelegateExecution } from '@main/lib/delegateExecutionScope';

import type { ResolveContext } from '../types';
import { SandboxProtocolHandler } from './sandbox-base';

export class KnowledgeProtocolHandler extends SandboxProtocolHandler {
  public readonly scheme = 'knowledge';

  protected async resolveBaseDir(ctx: ResolveContext): Promise<string> {
    const delegate = getDelegateExecution();
    return PERSIST_PATH.agentKnowledge(
      getAppRoot(),
      ctx.profileId,
      delegate?.delegateId ?? ctx.agentId,
    );
  }
}
