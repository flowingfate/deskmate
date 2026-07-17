import { log } from '@main/log';
import { JobRun } from '@main/pi';
import { showSessionCompletionNotification } from '@main/lib/notification/sessionCompletion';
import type { SchedulerJob } from '@shared/ipc/scheduler';
import { createUserMessage } from '@shared/utils/messageFactory';
import type { SchedulerContext } from './context';
import type { SchedulerTaskRuntime } from './taskRuntime';
import type { SchedulerExecutionResult, SchedulerTriggerSource } from './types';

const logger = log.child({ mod: 'SchedulerExecution' });

type ExecuteSchedulerJobParams = {
  job: SchedulerJob;
  triggerSource: SchedulerTriggerSource;
  context: SchedulerContext;
  taskRuntime: SchedulerTaskRuntime;
  onReady?: (payload: { chatSessionId: string }) => void;
  /** 补跑路径传入注册时的 generation；执行前校验仍属当前 profile，否则放弃。 */
  expectedGeneration?: number;
  onRunCreated?: (run: JobRun) => void;
};

/**
 * 执行一次任务：创建 run session、跑静默 JobRun、写回结果并按需发完成通知。
 * runtime meta（执行开始/结束/结果）落在 taskRuntime；一次性任务执行后注销 timer。
 */
export async function executeSchedulerJob({
  job,
  triggerSource,
  context,
  taskRuntime,
  onReady,
  expectedGeneration,
  onRunCreated,
}: ExecuteSchedulerJobParams): Promise<SchedulerExecutionResult> {
  if (expectedGeneration !== undefined && !context.isCurrentGeneration(expectedGeneration)) {
    return { success: false, error: 'Scheduler generation is no longer active.' };
  }

  const startedAt = new Date().toISOString();
  const runtimeMeta = taskRuntime.getTaskRuntimeMeta(job.id);
  if (runtimeMeta) {
    taskRuntime.setTaskRuntimeMeta(job.id, {
      ...runtimeMeta,
      lastExecuteStartAt: startedAt,
    });
  }

  logger.info({ msg: 'Started job execution', jobId: job.id, name: job.name, agentId: job.agentId, scheduleType: job.scheduleType, triggerSource, profileId: context.profileId, schedulerGeneration: runtimeMeta?.schedulerGeneration ?? context.generation, taskSequence: runtimeMeta?.taskSequence });

  const markFinish = (outcome: 'success' | 'failed', endedAt: string): void => {
    const meta = taskRuntime.getTaskRuntimeMeta(job.id);
    if (meta) {
      taskRuntime.setTaskRuntimeMeta(job.id, {
        ...meta,
        lastExecuteEndAt: endedAt,
        lastExecuteOutcome: outcome,
      });
    }
  };

  const store = context.store

  let agent;
  let persistJob;
  try {
    agent = await store.getAgent(job.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${job.agentId}`);
    }
    persistJob = await agent.getJob(job.id);
    if (!persistJob) {
      throw new Error(`Schedule job not found in persist: ${job.id}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markFinish('failed', new Date().toISOString());
    logger.error({ msg: 'Job execution failed', jobId: job.id, triggerSource, err: message, success: false });
    return { success: false, error: message };
  }

  let runSession;
  try {
    runSession = await persistJob.startRun({ startedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markFinish('failed', new Date().toISOString());
    logger.error({ msg: 'Failed to create scheduled run', jobId: job.id, triggerSource, err: message });
    return { success: false, error: message };
  }

  onReady?.({ chatSessionId: runSession.id });

  const userMessage = createUserMessage({ content: job.message });
  const piJobRun = new JobRun(runSession.id, store.id, job.agentId, runSession);
  onRunCreated?.(piJobRun);

  let messageCount = 0;
  let runError: string | null = null;
  try {
    const result = await piJobRun.run(userMessage, undefined);
    messageCount = result.messageCount;
  } catch (error) {
    runError = error instanceof Error ? (error.message || 'unknown error') : String(error);
  }

  const completedAt = new Date().toISOString();
  let finishError: string | null = null;
  try {
    if (runError == null) {
      await persistJob.finishRun(runSession.id, { status: 'completed', completedAt });
    } else {
      await persistJob.finishRun(runSession.id, { status: 'failed', completedAt, error: runError });
    }
  } catch (error) {
    finishError = error instanceof Error ? error.message : String(error);
    logger.warn({ msg: 'Failed to finish scheduled run', jobId: job.id, runId: runSession.id, err: error });
  }

  if (context.isStarted && finishError == null && job.notifyOnCompletion) {
    showSessionCompletionNotification({
      profileId: context.profileId,
      agentId: job.agentId,
      jobId: job.id,
      sessionId: runSession.id,
      sessionTitle: runSession.title,
      outcome: runError == null ? 'completed' : 'failed',
    });
  }

  const error = runError ?? finishError;
  if (job.scheduleType === 'once') {
    taskRuntime.unregisterTask(job.id, error == null ? 'once-job-completed' : 'once-job-failed');
  }
  if (error == null) {
    markFinish('success', completedAt);
    logger.info({ msg: 'Finished job execution', jobId: job.id, name: job.name, triggerSource, chatSessionId: runSession.id, messagesCount: messageCount, success: true });
    return { success: true, chatSessionId: runSession.id, messagesCount: messageCount };
  }

  markFinish('failed', completedAt);
  logger.error({ msg: 'Job execution failed', jobId: job.id, name: job.name, triggerSource, chatSessionId: runSession.id, err: error, success: false });
  return { success: false, chatSessionId: runSession.id, error };
}
