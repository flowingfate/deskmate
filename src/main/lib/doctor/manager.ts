/**
 * DoctorManager — public-facing entry point.
 * Receives user-submitted diagnostic requests (DoctorInquiryPayload), launches the
 * DoctorAgentRunner, manages status notifications, and coordinates agent ↔ user Q&A.
 */

import { randomUUID } from 'node:crypto';
import type {
  DoctorTaskStatus,
  DoctorInquiryPayload,
  AgentQuestion,
  AgentQuestionPayload,
  AgentAnswerValue,
} from '@shared/ipc/doctor';
import { mainToRender, type MainToRender, type MapMainInvoke } from '@shared/ipc/doctor';
import { log } from '@main/log';
import { DoctorAgentRunner } from './agentRunner';
import { eachWebContent } from '@main/startup/wins';

const logger = log;

const QUESTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function useSender(
  taskId: string,
  methods: string,
  handle: (s: MapMainInvoke<MainToRender>) => void
) {
  try {
    eachWebContent((wc) => {
      const sender = mainToRender.bindWebContents(wc);
      handle(sender);
    });
  } catch (err) {
    logger.warn({ msg: '[DoctorManager] Failed to notify renderer', mod: methods, taskId, err: err });
  }
}

export class DoctorManager {
  private questionResolvers = new Map<string, (answers: Record<string, AgentAnswerValue>) => void>();
  private _isRunning = false;

  async submitInquiry(payload: DoctorInquiryPayload): Promise<{ taskId: string }> {
    if (this._isRunning) {
      throw new Error('A doctor task is already running. Please wait for it to finish.');
    }

    const taskId = randomUUID();
    this._isRunning = true;
    this.updateStatus({ taskId, state: 'pending' });

    // Run in background
    this.runAgent(taskId, payload).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ msg: '[DoctorManager] Doctor agent failed', mod: 'submitInquiry', taskId, err: msg });
      this.updateStatus({ taskId, state: 'error', error: msg });
    }).finally(() => {
      this._isRunning = false;
    });

    return { taskId };
  }


  /**
   * Called by ask_user_question tool — pauses agent until user responds
   */
  async askUserQuestion(taskId: string, questions: AgentQuestion[]): Promise<Record<string, AgentAnswerValue>> {
    this.updateStatus({ taskId, state: 'waiting_for_user' });

    const payload: AgentQuestionPayload = { taskId, questions };

    // Broadcast question to all renderer windows
    try {
      eachWebContent((wc) => {
        const sender = mainToRender.bindWebContents(wc);
        sender.doctorAgentQuestion(payload);
      });
    } catch (err) {
      logger.warn({ msg: '[DoctorManager] Failed to send question to renderer', mod: 'askUserQuestion', taskId, err: err });
    }

    // Wait for user response with timeout
    return new Promise<Record<string, AgentAnswerValue>>((resolve) => {
      const timer = setTimeout(() => {
        this.questionResolvers.delete(taskId);
        this.updateStatus({ taskId, state: 'analyzing' });
        logger.warn({ msg: '[DoctorManager] Question timed out, resuming with empty answers', mod: 'askUserQuestion', taskId });
        resolve({});
      }, QUESTION_TIMEOUT_MS);

      this.questionResolvers.set(taskId, (answers) => {
        clearTimeout(timer);
        resolve(answers);
      });
    });
  }

  /**
   * Called when renderer submits answers to agent questions
   */
  receiveAnswer(taskId: string, answers: Record<string, AgentAnswerValue>): void {
    const resolver = this.questionResolvers.get(taskId);
    if (resolver) {
      this.questionResolvers.delete(taskId);
      this.updateStatus({ taskId, state: 'analyzing' });
      resolver(answers);
    } else {
      logger.warn({ msg: '[DoctorManager] Received answer but no pending question', mod: 'receiveAnswer', taskId });
    }
  }

  private async runAgent(taskId: string, payload: DoctorInquiryPayload): Promise<void> {
    this.updateStatus({ taskId, state: 'analyzing' });

    const runner = new DoctorAgentRunner((stepInfo) => this.pushStepInfo(taskId, stepInfo));
    const result = await runner.run(payload, taskId);

    if (result.success) {
      this.updateStatus({ taskId, state: 'done', issueUrl: result.issueUrl });
    } else {
      this.updateStatus({ taskId, state: 'error', error: result.error });
    }
  }

  private updateStatus(status: DoctorTaskStatus): void {
    useSender(status.taskId, 'updateStatus', (sender) => sender.doctorTaskStatusChanged(status));
  }

  private pushStepInfo(taskId: string, stepInfo: string): void {
    useSender(taskId, 'pushStepInfo', (sender) => sender.doctorStepInfo({ taskId, stepInfo }));
  }
}

export const doctorManager = new DoctorManager();
