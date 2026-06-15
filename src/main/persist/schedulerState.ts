import type { PendingColdStartCatchUp, SchedulerStateFile } from '../../shared/persist/types';
import { PERSIST_PATH } from '../../shared/persist/path';
import { getAppRoot } from './lib/root';
import { PersistBase } from './lib/persistBase';
import { readJsonOrNull, writeJson } from './lib/atomic';

const SCHEDULER_STATE_VERSION = 1 as const;

/**
 * 对应 scheduler-state.json —— scheduler 运行时状态。
 *
 * 承载两类信息：
 *  1) 冷启动 baseline：isActive / lastActivatedAt / lastDeactivatedAt。下一次启动时
 *     SchedulerManager 用这三个字段算出"应用关机期间错过的 cron 触发"。
 *  2) 待补跑队列 pendingColdStartCatchUps：已检测到要补但还没跑（或跑失败）的 occurrence。
 *     失败重试 + 崩溃幸存依赖它。
 *
 * 不 emit IPC —— renderer 无消费方。
 */
export class SchedulerState extends PersistBase {
  constructor(public readonly profileId: string) {
    super();
  }

  public isActive = false;
  public lastActivatedAt?: string;
  public lastDeactivatedAt?: string;
  public pending: Map<string, PendingColdStartCatchUp> = new Map();

  private file(): string {
    return PERSIST_PATH.schedulerStateFile(getAppRoot(), this.profileId);
  }

  public async load(): Promise<void> {
    const f = await readJsonOrNull<SchedulerStateFile>(this.file());
    if (!f) {
      this.isActive = false;
      this.lastActivatedAt = undefined;
      this.lastDeactivatedAt = undefined;
      this.pending = new Map();
      return;
    }
    this.isActive = f.isActive === true;
    this.lastActivatedAt = f.lastActivatedAt;
    this.lastDeactivatedAt = f.lastDeactivatedAt;
    this.pending = new Map(Object.entries(f.pendingColdStartCatchUps ?? {}));
  }

  protected async doPersist(): Promise<void> {
    await writeJson(this.file(), this.toFile());
  }

  /** 标记 scheduler 已启动。冷启动 baseline 用：下次启动时 deactivatedAt 为空则用此为窗口起点（unclean-exit）。 */
  public async markActivated(activatedAt: string): Promise<void> {
    this.isActive = true;
    this.lastActivatedAt = activatedAt;
    await this.persist();
  }

  /** 标记 scheduler 正常停止。下次启动时用 lastDeactivatedAt 为冷启动窗口起点（clean-exit）。 */
  public async markDeactivated(deactivatedAt: string): Promise<void> {
    this.isActive = false;
    this.lastDeactivatedAt = deactivatedAt;
    await this.persist();
  }

  /** 加入待补跑队列。同一 jobId 会被覆盖（只补"最近一次" missed occurrence，不会重复补）。 */
  public async enqueueCatchUp(jobId: string, occurrenceAt: string, recordedAt: string): Promise<void> {
    this.pending.set(jobId, { occurrenceAt, recordedAt });
    await this.persist();
  }

  /** 补跑成功后出队。 */
  public async dequeueCatchUp(jobId: string): Promise<void> {
    if (!this.pending.has(jobId)) return;
    this.pending.delete(jobId);
    await this.persist();
  }

  /** 给 cronRecovery.getColdStartCatchUpBaseline 用的只读快照。 */
  public getBaseline(): { isActive: boolean; lastActivatedAt?: string; lastDeactivatedAt?: string } {
    return {
      isActive: this.isActive,
      lastActivatedAt: this.lastActivatedAt,
      lastDeactivatedAt: this.lastDeactivatedAt,
    };
  }

  /** 给 handleColdStartCatchUp 遍历待补跑队列用的只读快照（一份拷贝）。 */
  public getPending(): Record<string, PendingColdStartCatchUp> {
    return Object.fromEntries(this.pending);
  }

  public toFile(): SchedulerStateFile {
    const file: SchedulerStateFile = {
      version: SCHEDULER_STATE_VERSION,
      isActive: this.isActive,
    };
    if (this.lastActivatedAt) file.lastActivatedAt = this.lastActivatedAt;
    if (this.lastDeactivatedAt) file.lastDeactivatedAt = this.lastDeactivatedAt;
    if (this.pending.size > 0) {
      file.pendingColdStartCatchUps = Object.fromEntries(this.pending);
    }
    return file;
  }
}
