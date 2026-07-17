/**
 * `local://` —— 当前 session 私有 sandbox。
 *
 * URL 形态:
 * - `local://<path>` —— 解析为 `${session.filesDir()}/<path>`
 *
 * 设计取舍:
 * - **session id 由 ResolveContext 注入,不进 URL** —— LLM 视角下 session 是
 *   隐式 "current",看不见 ULID。
 * - **immutable: false** —— session sandbox 是可写工作区。
 *
 * owning runtime Profile 由 ResolveContext 注入；handler 只沿上下文读取 store，
 * 不反查进程级 registry。
 * `findSessionAcrossKinds` 同时覆盖 RegularSession 与 JobRun(调度任务运行期);两条
 * 物理布局(`agents/{a}/sessions/{ym}/{s}/files/` vs
 * `agents/{a}/schedules/{j}/runs/{ym}/{s}/files/`)互不干扰,由各自子类的
 * `filesDir()` 返回。
 *
 * 通用部分(stat / 1MB cap / NUL byte / utf-8 / atomic write / 边界检查)在
 * {@link SandboxProtocolHandler} 基类。
 */

import type { ResolveContext } from '../types';
import { SandboxProtocolHandler } from './sandbox-base';

export class LocalProtocolHandler extends SandboxProtocolHandler {
  public readonly scheme = 'local';

  protected async resolveBaseDir(ctx: ResolveContext): Promise<string> {
    const agent = await ctx.profile.store.getAgent(ctx.agentId);
    if (!agent) throw new Error(`Agent not found: ${ctx.agentId}`);
    const session = await agent.findSessionAcrossKinds(ctx.sessionId);
    if (!session) throw new Error(`Session not found: ${ctx.sessionId}`);
    return session.filesDir();
  }
}
