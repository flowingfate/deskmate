import { powerMonitor } from 'electron';
import { log } from '@main/log';
import { ProfileRegistry } from '../profileRegistry'
import { crashRecorder } from '@main/lib/crash-recorder';


let powerMonitorLoggingRegistered = false;
let lastSuspendAt: number | null = null;

export function listenPowerEvents(): void {
  if (powerMonitorLoggingRegistered) {
    return;
  }

  powerMonitorLoggingRegistered = true;

  const logger = log.child({ mod: 'main:powerMonitor' });

  const logPowerEvent = (event: string, data?: Record<string, unknown>) => {
    logger.info({ msg: `[PowerMonitor] ${event}`, platform: process.platform, arch: process.arch, pid: process.pid, ...data });
  };

  powerMonitor.on('suspend', () => {
    const suspendedAt = Date.now();
    lastSuspendAt = suspendedAt;
    log.info({ msg: 'scheduler.lifecycle.power-suspend', schedulerStates: ProfileRegistry.getSchedulerDiagnostics(), suspendedAt: new Date(suspendedAt).toISOString() });

    logPowerEvent('System suspend detected', {
      appUptimeSeconds: Math.round(process.uptime()),
    });

    if (process.platform === 'win32') {
      logger.warn({ msg: '[PowerMonitor] Windows suspend detected. Node/Electron timers and in-flight IPC may pause until resume; if startup is waiting on an unresolved promise, UI can appear stuck after wake.', arch: process.arch, appUptimeSeconds: Math.round(process.uptime()) });
    }
  });

  powerMonitor.on('resume', () => {
    const resumedAt = Date.now();
    const suspendedForMs = lastSuspendAt ? resumedAt - lastSuspendAt : undefined;
    const suspendedAt = lastSuspendAt;
    lastSuspendAt = null;
    log.info({ msg: 'scheduler.lifecycle.power-resume', schedulerStates: ProfileRegistry.getSchedulerDiagnostics(), suspendedAt: suspendedAt ? new Date(suspendedAt).toISOString() : undefined, resumedAt: new Date(resumedAt).toISOString(), suspendedForMs });


    logPowerEvent('System resume detected', {
      suspendedForMs,
      suspendedForSeconds: suspendedForMs !== undefined ? Math.round(suspendedForMs / 1000) : undefined,
      appUptimeSeconds: Math.round(process.uptime()),
    });

    if (process.platform === 'win32') {
      logger.warn({ msg: '[PowerMonitor] Windows resume detected. If startup or profile initialization was pending before suspend, review the preceding 1-2 minutes of logs for unresolved IPC/fetch operations and consider power policy / connected-standby interference.', arch: process.arch, suspendedForMs });
    }

    if (suspendedAt && suspendedForMs && suspendedForMs > 0) {
      Promise.resolve()
        .then(() => ProfileRegistry.handleSystemResume(suspendedAt, resumedAt))
        .catch((schedulerError) => {
          logger.warn({ msg: '[PowerMonitor] Scheduler resume catch-up failed', suspendedForMs, err: schedulerError });
        });
    }
  });

  powerMonitor.on('on-battery', () => {
    logPowerEvent('Power source changed: battery');
  });

  powerMonitor.on('on-ac', () => {
    logPowerEvent('Power source changed: AC');
  });

  powerMonitor.on('lock-screen', () => {
    log.info({ msg: 'scheduler.lifecycle.power-lock-screen', schedulerStates: ProfileRegistry.getSchedulerDiagnostics() });
    logPowerEvent('Screen locked');
  });

  powerMonitor.on('unlock-screen', () => {
    log.info({ msg: 'scheduler.lifecycle.power-unlock-screen', schedulerStates: ProfileRegistry.getSchedulerDiagnostics() });
    logPowerEvent('Screen unlocked');
  });

  powerMonitor.on('shutdown', () => {
    crashRecorder.beginShutdown('os-session-end');
    logPowerEvent('System shutdown detected');
  });

  logPowerEvent('Power monitor diagnostics registered');
}
