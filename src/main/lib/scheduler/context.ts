/**
 * SchedulerContext 固定持有一个 ProfileStore，并提供由其生命周期状态派生的
 * 只读视图（generation 守卫、job 投射）。manager 只更新 started / generation，
 * taskRuntime / catchUp / execution 共享同一个 context 引用。
 */

import type { ProfileStore } from '@main/persist';
import type { SchedulerJob } from '@shared/ipc/scheduler';
import { toSchedulerJob } from './jobAdapter';

export class SchedulerContext {
  private started = false;
  generation = 0;

  public constructor(public readonly store: ProfileStore) {}

  get profileId(): string {
    return this.store.id;
  }

  get isStarted(): boolean {
    return this.started;
  }

  activate(): number {
    this.generation += 1;
    this.started = true;
    return this.generation;
  }

  deactivate(): void {
    this.generation += 1;
    this.started = false;
  }

  isCurrentGeneration(generation: number): boolean {
    return this.started && this.generation === generation;
  }


  async listJobs(agentId?: string): Promise<SchedulerJob[]> {
    if (!this.started) return [];
    const flat = await this.store.listJobsFlat(agentId ? { agentId } : undefined);
    return flat.map(({ job }) => toSchedulerJob(job.toFile(), job.config.runState));
  }

  async getJob(jobId: string): Promise<SchedulerJob | null> {
    if (!this.started) return null;
    const hit = await this.store.findJob(jobId);
    if (!hit) return null;
    return toSchedulerJob(hit.job.toFile(), hit.job.config.runState);
  }
}
