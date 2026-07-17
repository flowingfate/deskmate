/**
 * DoctorManager — public-facing entry point.
 * Receives user-submitted diagnostic requests and owns the active task registry.
 * DoctorTask owns the run, renderer notifications, and agent ↔ user Q&A.
 */

import type {
  DoctorInquiryPayload,
  AgentAnswerValue,
} from '@shared/ipc/doctor';
import type { ProfileStore } from '@main/persist';
import { DoctorTask } from './task';
import { log } from '@main/log';
import type { WebContents } from 'electron';

const logger = log;

export class DoctorManager {
  private activeTask: DoctorTask | undefined;

  public constructor(private readonly store: ProfileStore) {}

  public async submitInquiry(
    payload: DoctorInquiryPayload,
    owner: WebContents,
  ): Promise<{ taskId: string }> {
    if (this.activeTask) {
      throw new Error('A doctor task is already running for this profile. Please wait for it to finish.');
    }

    const task = new DoctorTask(owner, this.store);
    this.activeTask = task;
    task.start(payload).finally(() => {
      this.activeTask = undefined;
    });

    return { taskId: task.id };
  }

  public cancel(): void {
    this.activeTask?.cancel();
  }

  public async dispose(): Promise<void> {
    const task = this.activeTask;
    if (!task) return;
    task.cancel();
    await task.waitForCompletion;
  }

  /** Called when the owner renderer submits answers to agent questions. */
  public receiveAnswer(
    taskId: string,
    answers: Record<string, AgentAnswerValue>,
    owner: WebContents,
  ): void {
    const task = this.activeTask;
    if (!task || task.id !== taskId || !task.isOwnedBy(owner)) {
      logger.warn({ msg: '[DoctorManager] Rejected answer from a non-owner window', mod: 'receiveAnswer', taskId });
      return;
    }
    task.receiveAnswer(answers);
  }
}


