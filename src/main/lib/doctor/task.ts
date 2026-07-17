import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import {
  mainToRender,
  type AgentAnswerValue,
  type AgentQuestion,
  type DoctorInquiryPayload,
  type DoctorTaskStatus,
} from '@shared/ipc/doctor';
import { log } from '@main/log';
import type { ProfileStore } from '@main/persist';
import { DoctorAgentRunner } from './agentRunner';

const QUESTION_TIMEOUT_MS = 5 * 60 * 1000;

export class DoctorTask {
  public readonly id = randomUUID();
  public readonly controller = new AbortController();
  private completion = Promise.withResolvers<void>();
  private pendingQuestion: PendingQuestion | undefined;

  public constructor(
    private readonly owner: WebContents,
    private readonly store: ProfileStore,
  ) {}

  public get isCancelled(): boolean {
    return this.controller.signal.aborted;
  }

  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public get waitForCompletion() {
    return this.completion.promise;
  }

  public isOwnedBy(owner: WebContents): boolean {
    return this.owner === owner;
  }

  public async start(payload: DoctorInquiryPayload): Promise<void> {
    this.updateStatus({ taskId: this.id, state: 'pending' });

    try {
      this.updateStatus({ taskId: this.id, state: 'analyzing' });
      const result = await new DoctorAgentRunner(this.store).run(payload, this);
      if (this.isCancelled) return;

      if (result.success) {
        this.updateStatus({ taskId: this.id, state: 'done', issueUrl: result.issueUrl });
      } else {
        this.updateStatus({ taskId: this.id, state: 'error', error: result.error });
      }
    } catch (error) {
      if (this.isCancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      log.error({ msg: '[DoctorTask] Doctor agent failed', mod: 'start', taskId: this.id, err: message });
      this.updateStatus({ taskId: this.id, state: 'error', error: message });
    } finally {
      this.completion.resolve();
    }
  }

  public updateStatus(status: DoctorTaskStatus): void {
    if (status.taskId !== this.id || this.owner.isDestroyed()) return;

    try {
      mainToRender.bindWebContents(this.owner).doctorTaskStatusChanged(status);
    } catch (error) {
      this.logNotificationFailure('updateStatus', error);
    }
  }

  public pushStepInfo(stepInfo: string): void {
    if (this.owner.isDestroyed()) return;
    try {
      mainToRender.bindWebContents(this.owner).doctorStepInfo({ taskId: this.id, stepInfo });
    } catch (error) {
      this.logNotificationFailure('pushStepInfo', error);
    }
  }

  public async askUserQuestion(questions: AgentQuestion[]): Promise<Record<string, AgentAnswerValue>> {
    this.updateStatus({ taskId: this.id, state: 'waiting_for_user' });
    this.sendQuestion(questions);

    if (this.isCancelled) return {};

    return new Promise<Record<string, AgentAnswerValue>>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.receiveAnswer({})) return;
        log.warn({ msg: '[DoctorTask] Question timed out, resuming with empty answers', mod: 'askUserQuestion', taskId: this.id });
      }, QUESTION_TIMEOUT_MS);

      this.pendingQuestion = { resolve, timer };
    });
  }

  public cancel(): void {
    this.controller.abort();
    this.receiveAnswer({});
  }

  private sendQuestion(questions: AgentQuestion[]): void {
    if (this.owner.isDestroyed()) return;
    try {
      mainToRender.bindWebContents(this.owner).doctorAgentQuestion({ taskId: this.id, questions });
    } catch (error) {
      this.logNotificationFailure('askUserQuestion', error);
    }
  }

  public receiveAnswer(answers: Record<string, AgentAnswerValue>): boolean {
    const question = this.pendingQuestion;
    if (!question) return false;
    clearTimeout(question.timer);
    this.pendingQuestion = undefined;
    this.updateStatus({ taskId: this.id, state: 'analyzing' });
    question.resolve(answers);
    return true;
  }

  private logNotificationFailure(method: string, error: unknown): void {
    log.warn({ msg: '[DoctorTask] Failed to notify renderer', mod: method, taskId: this.id, err: error });
  }
}

interface PendingQuestion {
  resolve: (answers: Record<string, AgentAnswerValue>) => void;
  timer: ReturnType<typeof setTimeout>;
}
