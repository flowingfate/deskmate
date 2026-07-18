/**
 * BackgroundProcessManager - Lifecycle wrapper for async background process execution
 * Singleton pattern, wraps TerminalManager for non-blocking command execution
 */

import { terminalManager, type BaseTerminalInstance } from '../terminal'
import { TerminalConfigBase } from '../terminal/types'
import { log } from '@main/log';
import {
  BackgroundSessionData,
  BackgroundSpawnOptions,
  BackgroundSpawnResult,
  BackgroundPollResult,
  BackgroundLogOptions,
  BackgroundLogResult,
  BackgroundKillResult,
  BackgroundSessionSummary,
  BackgroundSessionStatus
} from './types';
import { buildCommandLine } from './commandLineUtils';

const MAX_OUTPUT_LINES = 1000;
const MAX_LINE_LENGTH = 500;
const SESSION_CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export class BackgroundProcessManager {
  private static instance: BackgroundProcessManager | undefined;
  private sessions = new Map<string, BackgroundSessionData>();
  private logger = log;

  private constructor() {
    this.logger.info({ msg: 'BackgroundProcessManager initialized', mod: 'BackgroundProcessManager' });
  }

  public static getInstance(): BackgroundProcessManager {
    return BackgroundProcessManager.instance ??= new BackgroundProcessManager();
  }

  /**
   * Spawn a background process
   * Creates a persistent TerminalInstance and returns immediately
   */
  public async spawn(
    command: string,
    options: BackgroundSpawnOptions
  ): Promise<BackgroundSpawnResult> {
    const sessionId = this.generateSessionId();
    const startTime = Date.now();

    this.logger.info({ msg: 'Spawning background process', mod: 'BackgroundProcessManager', sessionId, command, cwd: options.cwd });

    const terminalConfig: TerminalConfigBase = {
      command,
      args: [],
      cwd: options.cwd,
      shell: options.shell,
      env: options.env,
      persistent: true
    };

    const instance = await terminalManager.createCommand(terminalConfig);

    const sessionData: BackgroundSessionData = {
      sessionId,
      command,
      terminalInstanceId: instance.id,
      startTime,
      status: 'running',
      pid: instance.pid,
      outputLines: [],
      droppedCount: 0
    };

    this.sessions.set(sessionId, sessionData);
    this.setupOutputListeners(instance, sessionData);

    await instance.start();

    this.logger.info({ msg: 'Background process spawned successfully', mod: 'BackgroundProcessManager', sessionId, pid: instance.pid, terminalInstanceId: instance.id });

    return {
      sessionId,
      pid: instance.pid
    };
  }

  /**
   * Poll a session for its current status
   */
  public poll(sessionId: string): BackgroundPollResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn({ msg: 'Session not found for poll', mod: 'BackgroundProcessManager', sessionId });
      return {
        status: 'error',
        durationMs: 0
      };
    }

    const now = Date.now();
    const durationMs = (session.endTime ?? now) - session.startTime;

    return {
      status: session.status,
      exitCode: session.exitCode,
      pid: session.pid,
      durationMs
    };
  }

  /**
   * Read output lines from a session's ring buffer
   */
  public log(sessionId: string, options: BackgroundLogOptions = {}): BackgroundLogResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn({ msg: 'Session not found for log', mod: 'BackgroundProcessManager', sessionId });
      return {
        lines: [],
        nextOffset: 0,
        totalLines: 0,
        droppedCount: 0,
        done: true
      };
    }

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    const totalLines = session.droppedCount + session.outputLines.length;

    // Convert absolute offset to array index
    const arrayIdx = Math.max(0, offset - session.droppedCount);
    const startIdx = Math.min(arrayIdx, session.outputLines.length);
    const endIdx = Math.min(startIdx + limit, session.outputLines.length);
    const lines = session.outputLines.slice(startIdx, endIdx);

    return {
      lines,
      nextOffset: session.droppedCount + endIdx,
      totalLines,
      droppedCount: session.droppedCount,
      done: session.status !== 'running' && endIdx >= session.outputLines.length
    };
  }

  /**
   * Kill a background session
   */
  public async kill(sessionId: string): Promise<BackgroundKillResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        message: `Session not found: ${sessionId}`
      };
    }

    if (session.status !== 'running') {
      return {
        success: true,
        message: `Session already ${session.status}`
      };
    }

    this.logger.info({ msg: 'Killing background session', mod: 'BackgroundProcessManager', sessionId });

    try {
      session.killedByUser = true;
      await terminalManager.stopInstance(session.terminalInstanceId, true);

      session.status = 'exited';
      session.endTime = Date.now();
      session.exitCode = -1;

      this.scheduleSessionCleanup(sessionId);

      return {
        success: true,
        message: 'Process killed successfully'
      };
    } catch (error) {
      // Reset killedByUser so the exit listener can still handle state transitions
      session.killedByUser = false;
      session.status = 'error';
      session.endTime = Date.now();

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ msg: 'Failed to kill background session', mod: 'BackgroundProcessManager', sessionId, err: error });

      this.scheduleSessionCleanup(sessionId);

      return {
        success: false,
        message: `Failed to kill process: ${errorMessage}`
      };
    }
  }

  /**
   * List all active and recently-exited sessions
   */
  public list(): BackgroundSessionSummary[] {
    const summaries: BackgroundSessionSummary[] = [];
    const now = Date.now();

    for (const session of this.sessions.values()) {
      const durationMs = (session.endTime ?? now) - session.startTime;

      summaries.push({
        sessionId: session.sessionId,
        command: session.command,
        status: session.status,
        pid: session.pid,
        startTime: session.startTime,
        durationMs,
        exitCode: session.exitCode
      });
    }

    return summaries;
  }

  /**
   * Dispose: kill all running processes, clear all timers, reset singleton.
   * Call during application shutdown to prevent orphan processes.
   */
  public async dispose(): Promise<void> {
    this.logger.info({ msg: 'Disposing BackgroundProcessManager', mod: 'BackgroundProcessManager', activeSessions: this.sessions.size });

    for (const [sessionId, session] of this.sessions) {
      // Clear cleanup timers
      if (session.cleanupTimerId) {
        clearTimeout(session.cleanupTimerId);
      }

      // Kill running processes
      if (session.status === 'running') {
        try {
          session.killedByUser = true;
          await terminalManager.stopInstance(session.terminalInstanceId, true);
        } catch (error) {
          this.logger.error({ msg: 'Failed to stop instance during dispose', mod: 'BackgroundProcessManager', sessionId, err: error });
        }
      }
    }

    this.sessions.clear();
    BackgroundProcessManager.instance = undefined;

    this.logger.info({ msg: 'BackgroundProcessManager disposed', mod: 'BackgroundProcessManager' });
  }

  private generateSessionId(): string {
    return `bg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private setupOutputListeners(instance: BaseTerminalInstance, session: BackgroundSessionData): void {
    const appendLine = (line: string) => {
      const truncated = line.length > MAX_LINE_LENGTH
        ? line.slice(0, MAX_LINE_LENGTH) + '...'
        : line;

      session.outputLines.push(truncated);

      if (session.outputLines.length > MAX_OUTPUT_LINES) {
        const toRemove = session.outputLines.length - MAX_OUTPUT_LINES;
        session.outputLines.splice(0, toRemove);
        session.droppedCount += toRemove;
      }
    };

    const processChunk = (chunk: string, prefix = '') => {
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          appendLine(prefix ? `${prefix}${line}` : line);
        }
      }
    };

    instance.on('stdout', (chunk: string) => processChunk(chunk));
    instance.on('stderr', (chunk: string) => processChunk(chunk, '[stderr] '));

    instance.on('exit', (code: number | null) => {
      // Skip if kill() already handled the state transition
      if (session.killedByUser) {
        return;
      }

      this.logger.info({ msg: 'Background process exited', mod: 'BackgroundProcessManager', sessionId: session.sessionId, exitCode: code });

      session.status = code === 0 ? 'exited' : 'error';
      session.exitCode = code;
      session.endTime = Date.now();

      this.scheduleSessionCleanup(session.sessionId);
    });

    instance.on('error', (error: Error) => {
      this.logger.error({ msg: 'Background process error', mod: 'BackgroundProcessManager', sessionId: session.sessionId, err: error });

      session.status = 'error';
      session.endTime = Date.now();
      appendLine(`[error] ${error.message}`);

      this.scheduleSessionCleanup(session.sessionId);
    });
  }

  private scheduleSessionCleanup(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.cleanupTimerId) {
      clearTimeout(session.cleanupTimerId);
    }

    session.cleanupTimerId = setTimeout(() => {
      this.logger.info({ msg: 'Cleaning up expired session', mod: 'BackgroundProcessManager', sessionId });

      // Dispose terminal instance to release event listeners and resources
      terminalManager.stopInstance(session.terminalInstanceId, true).catch(err => {
        this.logger.warn({ msg: 'Failed to dispose terminal instance during session cleanup', mod: 'BackgroundProcessManager', sessionId, err: err });
      });

      this.sessions.delete(sessionId);
    }, SESSION_CLEANUP_DELAY_MS);

    session.cleanupTimerId.unref();
  }
}

export function getBackgroundProcessManager(): BackgroundProcessManager {
  return BackgroundProcessManager.getInstance();
}
