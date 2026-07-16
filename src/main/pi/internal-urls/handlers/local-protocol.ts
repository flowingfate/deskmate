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
 * `Profile.getOrLoad → getAgent(owner) → findSessionAcrossKinds` 在 main 进程是进程级
 * 单例 + Map cache,首次后是几次 map.get,**不是"加载实体"**。
 * `findSessionAcrossKinds` 同时覆盖 RegularSession 与 JobRun(调度任务运行期);两条
 * 物理布局(`agents/{a}/sessions/{ym}/{s}/files/` vs
 * `agents/{a}/schedules/{j}/runs/{ym}/{s}/files/`)互不干扰,由各自子类的
 * `filesDir()` 返回。
 *
 * 通用部分(stat / 1MB cap / NUL byte / utf-8 / atomic write / 边界检查)在
 * {@link SandboxProtocolHandler} 基类。
 */
import { Profile } from '@main/persist/profile';

import type { ResolveContext } from '../types';
import { SandboxProtocolHandler } from './sandbox-base';

export class LocalProtocolHandler extends SandboxProtocolHandler {
  public readonly scheme = 'local';

  protected async resolveBaseDir(ctx: ResolveContext): Promise<string> {
    const profile = await Profile.getOrLoad(ctx.profileId);
    const agent = await profile.getAgent(ctx.agentId);
    if (!agent) throw new Error(`Agent not found: ${ctx.agentId}`);
    // findSessionAcrossKinds 同时覆盖 RegularSession 与 JobRun(调度任务的 turn loop
    // 注入的 ToolContext.sessionId 是 JobRun id)。两条物理布局各自独立，filesDir()
    // 由具体子类返回正确路径,handler 自身保持纯路径解析。
    const session = await agent.findSessionAcrossKinds(ctx.sessionId);
    if (!session) throw new Error(`Session not found: ${ctx.sessionId}`);
    return session.filesDir();
  }
}
