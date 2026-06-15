import type { CronWatchdogTaskRuntimeMeta } from '../cronWatchdog';

vi.mock('node-cron', async () => ({
  schedule: vi.fn(() => ({
    stop: vi.fn(),
  })),
}));


// persist 重构 step5 PR3+PR4：CRUD + executeJob 全走 persist。
// 这里 mock Profiles 顶层 + JobRun + sessionCompletion，避免真触盘/真跑 LLM。
const persistFindJobMock = vi.fn(async (_jobId: string): Promise<unknown> => undefined);
const persistListJobsFlatMock = vi.fn(async (_filter?: { agentId?: string }) => [] as unknown[]);
const persistGetAgentMock = vi.fn(async (_agentId: string): Promise<unknown> => undefined);
const fakePersistProfile = {
  id: 'p_test',
  findJob: persistFindJobMock,
  listJobsFlat: persistListJobsFlatMock,
  getAgent: persistGetAgentMock,
};
vi.mock('@main/persist', async () => ({
  Profiles: {
    get: () => ({
      active: vi.fn(async () => fakePersistProfile),
    }),
  },
}));

// JobRun 是 turn loop —— 测试里不真跑模型，默认 success。
const jobRunMock = vi.fn(async () => ({ messageCount: 1 }));
vi.mock('@main/pi', async () => {
  const actual = await vi.importActual<typeof import('@main/pi')>('@main/pi');
  return {
    ...actual,
    JobRun: class {
      run = jobRunMock;
      async abort() {}
    },
  };
});

const showSessionCompletionNotificationMock = vi.fn();
vi.mock('@main/lib/notification/sessionCompletion', async () => ({
  showSessionCompletionNotification: showSessionCompletionNotificationMock,
}));

/**
 * 构造一个 mock ScheduleJob 实例 + 关联 Agent + 注入 persist mock 链。
 * 让 SchedulerManager.executeJob 内部 listJobsFlat / findJob / getAgent / getJob /
 * startRun / finishRun 都命中本组桩。
 *
 * runFinish 控制 JobRun.run 的 resolve 时机（用于"onReady 时序"测试）。
 */
function setupSchedulableJob(opts: {
  id: string;
  agentId: string;
  cron?: string;
  runAt?: string;
  enabled?: boolean;
  lastRunAt?: string; // 投到 toSchedulerJob → SchedulerJob.lastRunAt（cold-start lastRunAt skip 用）
}) {
  // lastRunAt 通过 toSchedulerJob 从 runState.startedAt 投出来；用 completed 状态确保
  // lastRunAt 是 startedAt（status='completed' 时 startedAt + finishedAt 都会暴露）。
  const runState: { status: string; startedAt?: string; finishedAt?: string; error?: string } = opts.lastRunAt
    ? { status: 'completed', startedAt: opts.lastRunAt, finishedAt: opts.lastRunAt }
    : { status: 'pending' };
  const file = opts.cron
    ? { version: 1 as const, id: opts.id, agentId: opts.agentId, name: opts.id, message: 'hi', enabled: opts.enabled ?? true, createdAt: 'x', updatedAt: 'y', scheduleType: 'cron' as const, cron: opts.cron }
    : { version: 1 as const, id: opts.id, agentId: opts.agentId, name: opts.id, message: 'hi', enabled: opts.enabled ?? true, createdAt: 'x', updatedAt: 'y', scheduleType: 'once' as const, runAt: opts.runAt! };

  const startRunMock = vi.fn(async (_input: { startedAt: string }) => ({
    id: `run_${opts.id}_${Date.now()}`,
    title: 'run',
  }));
  const finishRunMock = vi.fn(async () => undefined);
  const listRunsOnDiskMock = vi.fn(async () => []);
  const applyUpdateMock = vi.fn();
  const persistMock = vi.fn(async () => undefined);

  const fakeJob = {
    id: opts.id,
    toFile: () => file,
    config: { enabled: opts.enabled ?? true, runState },
    startRun: startRunMock,
    finishRun: finishRunMock,
    listRunsOnDisk: listRunsOnDiskMock,
    applyUpdate: applyUpdateMock,
    persist: persistMock,
  };
  const fakeAgent = {
    id: opts.agentId,
    getJob: vi.fn(async (jobId: string) => (jobId === opts.id ? fakeJob : undefined)),
  };
  // 让 currentProfile.getAgent(agentId) 命中 fakeAgent。
  persistGetAgentMock.mockImplementation(async (id: string) => (id === opts.agentId ? fakeAgent : undefined));
  return { file, fakeJob, fakeAgent, startRunMock, finishRunMock, listRunsOnDiskMock };
}


describe('SchedulerManager cold-start catch-up', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  afterEach(async () => {
    try {
      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.dispose('manual-debug');
    } catch {
      // Ignore cleanup failures in tests that never loaded the module.
    }

    vi.useRealTimers();
  });

  it('returns a manual run chatSessionId only after the scheduled session is ready', async () => {
    const { schedulerManager } = await import('../SchedulerManager');

    const { fakeJob, fakeAgent, startRunMock } = setupSchedulableJob({
      id: 'job-manual-1',
      agentId: 'agent-1',
      cron: '0 * * * *',
    });
    persistListJobsFlatMock.mockResolvedValue([{ agent: fakeAgent, job: fakeJob, entry: {} } as never]);
    persistFindJobMock.mockResolvedValue({ agent: fakeAgent, job: fakeJob } as never);
    // startRun 解 resolve 后 onReady 即触发；这里立即返回，验证调用链通畅。
    startRunMock.mockResolvedValue({ id: 'run-manual-1', title: 'r' } as never);

    await schedulerManager.initialize('alice');

    const result = await schedulerManager.runJobNow('job-manual-1');

    expect(result).toEqual({
      success: true,
      chatSessionId: 'run-manual-1',
    });
    expect(startRunMock).toHaveBeenCalledTimes(1);
    expect(jobRunMock).toHaveBeenCalledTimes(1);
  });

  it('runs a watchdog catch-up when node-cron misses an occurrence while the app stays alive', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-04-07T03:00:00.000Z'));

    const { runCronWatchdog } = await import('../cronWatchdog');

    const job = {
      id: 'sched_20260401000000_abcd1234',
      name: 'Hourly briefing',
      description: '',
      scheduleType: 'cron' as const,
      cronExpression: '* * * * *',
      enabled: true,
      agentId: 'agent-1',
      message: 'hello',
      status: 'pending' as const,
    };

    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        job.id,
        {
          jobId: job.id,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: job.cronExpression,
        },
      ],
    ]);
    const executeJob = vi.fn(async () => undefined);
    const getJob = vi.fn(async () => job);

    await runCronWatchdog({
      profileId: 'p_test_alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [job.id],
      getRuntimeMeta: (jobId) => runtimeMeta.get(jobId),
      setRuntimeMeta: (jobId, meta) => runtimeMeta.set(jobId, meta),
      getJob,
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(executeJob).toHaveBeenCalledTimes(1);
    expect(executeJob).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    expect(runtimeMeta.get(job.id)?.lastCronWatchdogCatchUpAt).toBe('2026-04-07T03:01:00.000Z');
  });

  it('does not run a watchdog catch-up when the missed occurrence is already started', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-04-07T03:00:00.000Z'));

    const { runCronWatchdog } = await import('../cronWatchdog');

    const job = {
      id: 'sched_20260401000000_abcd1234',
      name: 'Hourly briefing',
      description: '',
      scheduleType: 'cron' as const,
      cronExpression: '* * * * *',
      enabled: true,
      agentId: 'agent-1',
      message: 'hello',
      status: 'pending' as const,
      lastRunAt: '2026-04-07T03:02:30.000Z',
    };

    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        job.id,
        {
          jobId: job.id,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: job.cronExpression,
        },
      ],
    ]);
    const executeJob = vi.fn(async () => undefined);
    const getJob = vi.fn(async () => job);

    await runCronWatchdog({
      profileId: 'p_test_alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [job.id],
      getRuntimeMeta: (jobId) => runtimeMeta.get(jobId),
      setRuntimeMeta: (jobId, meta) => runtimeMeta.set(jobId, meta),
      getJob,
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(executeJob).not.toHaveBeenCalled();
  });

  it('allows watchdog catch-up for a later occurrence while an earlier run is still active', async () => {
    const { runCronWatchdog } = await import('../cronWatchdog');

    const job = {
      id: 'sched_20260401000000_abcd1234',
      name: 'Hourly briefing',
      description: '',
      scheduleType: 'cron' as const,
      cronExpression: '* * * * *',
      enabled: true,
      agentId: 'agent-1',
      message: 'hello',
      status: 'pending' as const,
      lastRunAt: '2026-04-07T03:01:30.000Z',
    };
    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        job.id,
        {
          jobId: job.id,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: job.cronExpression,
          lastCronWatchdogCheckedAt: '2026-04-07T03:01:00.000Z',
        },
      ],
    ]);
    const executeJob = vi.fn(async () => undefined);
    const getJob = vi.fn(async () => job);

    await runCronWatchdog({
      profileId: 'p_test_alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [job.id],
      getRuntimeMeta: (jobId) => runtimeMeta.get(jobId),
      setRuntimeMeta: (jobId, meta) => runtimeMeta.set(jobId, meta),
      getJob,
      executeJob,
      nowMs: Date.parse('2026-04-07T03:04:00.000Z'),
    });

    expect(executeJob).toHaveBeenCalledTimes(1);
    expect(executeJob).toHaveBeenCalledWith(job);
    expect(runtimeMeta.get(job.id)?.lastCronWatchdogCatchUpAt).toBe('2026-04-07T03:02:00.000Z');
  });

  it('does not run a watchdog catch-up when no cron occurrence was missed', async () => {
    const { runCronWatchdog } = await import('../cronWatchdog');
    const jobId = 'sched_20260401000000_abcd1234';
    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        jobId,
        {
          jobId,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: '* * * * *',
          lastCronWatchdogCheckedAt: '2026-04-07T03:02:00.000Z',
        },
      ],
    ]);
    const executeJob = vi.fn(async () => undefined);
    const getJob = vi.fn(async () => null);

    await runCronWatchdog({
      profileId: 'p_test_alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [jobId],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      getJob,
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(getJob).not.toHaveBeenCalled();
    expect(executeJob).not.toHaveBeenCalled();
    expect(runtimeMeta.get(jobId)?.lastCronWatchdogCheckedAt).toBe('2026-04-07T03:02:00.000Z');
  });

  it('does not run a watchdog catch-up when the latest job is inactive', async () => {
    const { runCronWatchdog } = await import('../cronWatchdog');
    const jobId = 'sched_20260401000000_abcd1234';
    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        jobId,
        {
          jobId,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: '* * * * *',
        },
      ],
    ]);
    const executeJob = vi.fn(async () => undefined);
    const getJob = vi.fn(async () => ({
      id: jobId,
      name: 'Hourly briefing',
      description: '',
      scheduleType: 'cron' as const,
      cronExpression: '* * * * *',
      enabled: false,
      agentId: 'agent-1',
      message: 'hello',
      status: 'pending' as const,
    }));

    await runCronWatchdog({
      profileId: 'p_test_alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [jobId],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      getJob,
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(getJob).toHaveBeenCalledWith(jobId);
    expect(executeJob).not.toHaveBeenCalled();
  });

  it('continues watchdog catch-up when one cron job fails', async () => {
    const { runCronWatchdog } = await import('../cronWatchdog');
    const failingJobId = 'sched_20260401000000_abcd1234';
    const successfulJobId = 'sched_20260401000000_efgh5678';
    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        failingJobId,
        {
          jobId: failingJobId,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: '* * * * *',
        },
      ],
      [
        successfulJobId,
        {
          jobId: successfulJobId,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: '* * * * *',
        },
      ],
    ]);
    const successfulJob = {
      id: successfulJobId,
      name: 'Hourly briefing',
      description: '',
      scheduleType: 'cron' as const,
      cronExpression: '* * * * *',
      enabled: true,
      agentId: 'agent-1',
      message: 'hello',
      status: 'pending' as const,
    };
    const executeJob = vi.fn(async () => undefined);
    const getJob = vi.fn(async (jobId: string) => {
      if (jobId === failingJobId) {
        throw new Error('read failed');
      }
      return successfulJob;
    });

    await runCronWatchdog({
      profileId: 'p_test_alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [failingJobId, successfulJobId],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      getJob,
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(getJob).toHaveBeenCalledTimes(2);
    expect(executeJob).toHaveBeenCalledTimes(1);
    expect(executeJob).toHaveBeenCalledWith(successfulJob);
  });
});

describe('SchedulerManager resume-catchup dedup', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();

  });

  afterEach(async () => {
    try {
      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.dispose('manual-debug');
    } catch {
      // Ignore cleanup failures
    }
    vi.useRealTimers();
  });

  it('skips resume-catchup for a job that already ran via normal cron', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-05-11T01:25:00.000Z'));


    // Job already ran at 22:00 via normal cron
    const { fakeJob, fakeAgent, startRunMock } = setupSchedulableJob({
      id: 'sched_job1',
      agentId: 'agent-1',
      cron: '0 22 * * *',
      lastRunAt: '2026-05-10T22:00:00.450Z',
    });
    persistListJobsFlatMock.mockResolvedValue([{ agent: fakeAgent, job: fakeJob, entry: {} } as never]);
    persistFindJobMock.mockResolvedValue({ agent: fakeAgent, job: fakeJob } as never);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    await schedulerManager.handleSystemResume(
      Date.parse('2026-05-09T08:26:27.338Z'),
      Date.parse('2026-05-11T01:25:00.000Z'),
    );

    expect(startRunMock).not.toHaveBeenCalled();
  });

  it('runs resume-catchup for a job that has not run since before suspension', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-05-11T01:25:00.000Z'));


    const { fakeJob, fakeAgent, startRunMock } = setupSchedulableJob({
      id: 'sched_job2',
      agentId: 'agent-1',
      cron: '0 * * * *',
      lastRunAt: '2026-05-09T08:00:00.000Z',
    });
    persistListJobsFlatMock.mockResolvedValue([{ agent: fakeAgent, job: fakeJob, entry: {} } as never]);
    persistFindJobMock.mockResolvedValue({ agent: fakeAgent, job: fakeJob } as never);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // Clear any calls from cold-start-catchup during initialize
    startRunMock.mockClear();

    await schedulerManager.handleSystemResume(
      Date.parse('2026-05-11T00:55:00.000Z'),
      Date.parse('2026-05-11T01:25:00.000Z'),
    );

    expect(startRunMock).toHaveBeenCalledTimes(1);
  });
});

describe('SchedulerManager toggleJobsByAgent', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();

  });

  afterEach(async () => {
    try {
      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.dispose('manual-debug');
    } catch {
      // Ignore cleanup failures
    }
    vi.useRealTimers();
  });

  it('toggleJobsByAgent(false) only disables enabled jobs, skips already disabled', async () => {
    const baseFile = (id: string, enabled: boolean) => ({
      version: 1 as const,
      id,
      agentId: 'agent-x',
      name: id,
      message: 'hi',
      enabled,
      createdAt: 'x', updatedAt: 'y',
      scheduleType: 'cron' as const,
      cron: '0 9 * * *',
    });
    function mkJob(id: string, enabled: boolean) {
      let curEnabled = enabled;
      return {
        id,
        toFile: () => baseFile(id, curEnabled),
        config: {
          get enabled() { return curEnabled; },
          runState: { status: 'pending' as const },
        },
        applyUpdate: vi.fn((p: { enabled?: boolean }) => { if (p.enabled !== undefined) curEnabled = p.enabled; }),
        persist: vi.fn(async () => undefined),
      };
    }

    const j1 = mkJob('job-1', true);
    const j2 = mkJob('job-2', false);
    const j3 = mkJob('job-3', true);
    persistListJobsFlatMock.mockResolvedValue([
      { agent: {}, job: j1, entry: {} },
      { agent: {}, job: j2, entry: {} },
      { agent: {}, job: j3, entry: {} },
    ] as never);
    persistFindJobMock.mockImplementation(async (id: string) => {
      const found = [j1, j2, j3].find((x) => x.id === id);
      return found ? { agent: {} as never, job: found as never } : undefined;
    });

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const count = await schedulerManager.toggleJobsByAgent('agent-x', false);

    expect(count).toBe(2);
    expect(j1.applyUpdate).toHaveBeenCalledWith({ enabled: false });
    expect(j3.applyUpdate).toHaveBeenCalledWith({ enabled: false });
    expect(j2.applyUpdate).not.toHaveBeenCalled();
  });

  it('toggleJobsByAgent(true) only enables disabled jobs, skips already enabled', async () => {
    function mkJob(id: string, enabled: boolean) {
      let curEnabled = enabled;
      return {
        id,
        toFile: () => ({
          version: 1 as const, id, agentId: 'agent-x', name: id, message: 'hi',
          enabled: curEnabled, createdAt: 'x', updatedAt: 'y',
          scheduleType: 'cron' as const, cron: '0 9 * * *',
        }),
        config: {
          get enabled() { return curEnabled; },
          runState: { status: 'pending' as const },
        },
        applyUpdate: vi.fn((p: { enabled?: boolean }) => { if (p.enabled !== undefined) curEnabled = p.enabled; }),
        persist: vi.fn(async () => undefined),
      };
    }
    const j1 = mkJob('job-1', false);
    const j2 = mkJob('job-2', true);
    const j3 = mkJob('job-3', false);
    persistListJobsFlatMock.mockResolvedValue([
      { agent: {}, job: j1, entry: {} },
      { agent: {}, job: j2, entry: {} },
      { agent: {}, job: j3, entry: {} },
    ] as never);
    persistFindJobMock.mockImplementation(async (id: string) => {
      const found = [j1, j2, j3].find((x) => x.id === id);
      return found ? { agent: {} as never, job: found as never } : undefined;
    });

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const count = await schedulerManager.toggleJobsByAgent('agent-x', true);

    expect(count).toBe(2);
    expect(j1.applyUpdate).toHaveBeenCalledWith({ enabled: true });
    expect(j3.applyUpdate).toHaveBeenCalledWith({ enabled: true });
    expect(j2.applyUpdate).not.toHaveBeenCalled();
  });
});
