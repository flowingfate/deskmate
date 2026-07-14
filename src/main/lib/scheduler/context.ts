/**
 * SchedulerContext 持有调度器的活动状态——当前 profile 与 generation——并提供
 * 由这份状态派生的只读视图（generation 守卫、job 投射）。它是这份状态的唯一来源：
 * manager 负责在生命周期切换时写入 profile / generation，taskRuntime / catchUp /
 * execution 只按引用读取，不再各自声明一坨回读闭包。
 */

import type { Profile } from '@main/persist';
import type { SchedulerJob } from '@shared/ipc/scheduler';
import { toSchedulerJob } from './jobAdapter';

export class SchedulerContext {
  /** 当前 active Profile 实例。null 表示未登录 / scheduler 未初始化。 */
  profile: Profile | null = null;

  /** 每次 initialize 递增（切 profile / 重登）；后台补跑用它校验是否仍属当前 profile。 */
  generation = 0;

  /** 当前 active profile id，派生自 profile，不作为独立字段复制。 */
  get profileId(): string | null {
    return this.profile?.id ?? null;
  }

  /** generation 校验：profile 仍在且 generation 未被后续 initialize 覆盖。 */
  isCurrentGeneration(generation: number): boolean {
    return this.profile !== null && this.generation === generation;
  }

  requireProfile(): Profile {
    if (!this.profile) {
      throw new Error('Scheduler is not initialized for the current user.');
    }
    return this.profile;
  }

  async listJobs(agentId?: string): Promise<SchedulerJob[]> {
    if (!this.profile) {
      return [];
    }
    const flat = await this.profile.listJobsFlat(agentId ? { agentId } : undefined);
    return flat.map(({ job }) => toSchedulerJob(job.toFile(), job.config.runState));
  }

  async getJob(jobId: string): Promise<SchedulerJob | null> {
    if (!this.profile) {
      return null;
    }
    const hit = await this.profile.findJob(jobId);
    if (!hit) {
      return null;
    }
    return toSchedulerJob(hit.job.toFile(), hit.job.config.runState);
  }
}
