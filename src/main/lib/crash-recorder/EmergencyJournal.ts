import * as fs from 'node:fs';
import type { DiagnosticLogEntry, EmergencyMainFatalRecord } from './types';
import { safeStderr } from './safeStderr';

const MAX_JOURNAL_BYTES = 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 2 * 1024;
const MAX_STACK_CHARS = 24 * 1024;

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

function isEmergencyRecord(value: EmergencyMainFatalRecord): boolean {
  return value.schemaVersion === 1 && value.type === 'main_fatal' && Number.isInteger(value.lifeId);
}

export class EmergencyJournal {
  private fd: number | null = null;
  private usedBytes = 0;
  private lifeId = 0;
  private fatalHandlerInstalled = false;
  private tailProvider: () => string = () => '[]';

  public open(filePath: string): void {
    try {
      this.fd = fs.openSync(filePath, fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_WRONLY, 0o600);
      this.usedBytes = Math.min(fs.fstatSync(this.fd).size, MAX_JOURNAL_BYTES);
    } catch (error) {
      this.fd = null;
      safeStderr('journal-open', `Emergency journal unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public bindLife(lifeId: number): void {
    this.lifeId = lifeId;
  }

  public setTailProvider(provider: () => string): void {
    this.tailProvider = provider;
  }

  public installFatalMonitor(): void {
    if (this.fatalHandlerInstalled) return;
    this.fatalHandlerInstalled = true;
    process.on('uncaughtExceptionMonitor', (error, origin) => {
      this.recordFatal(error, origin === 'unhandledRejection' ? 'unhandledRejection' : 'uncaughtException');
    });
  }

  public importRecords(filePath: string): EmergencyMainFatalRecord[] {
    try {
      if (!fs.existsSync(filePath)) return [];
      const raw = fs.readFileSync(filePath, 'utf8');
      const records: EmergencyMainFatalRecord[] = [];
      const completeLineCount = raw.endsWith('\n') ? raw.split('\n').length - 1 : Math.max(0, raw.split('\n').length - 1);
      const lines = raw.split('\n').slice(0, completeLineCount);
      for (const line of lines) {
        if (!line) continue;
        try {
          const parsed: EmergencyMainFatalRecord = JSON.parse(line);
          if (isEmergencyRecord(parsed)) records.push(parsed);
        } catch {
          // 掉电可能截断最后一行；坏行不阻塞其它完整记录。
        }
      }
      return records;
    } catch (error) {
      safeStderr('journal-import', `Emergency journal import failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  public truncateAfterImport(filePath: string): void {
    try {
      fs.truncateSync(filePath, 0);
      this.usedBytes = 0;
    } catch (error) {
      safeStderr('journal-truncate', `Emergency journal truncate failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public close(): void {
    if (this.fd === null) return;
    try {
      fs.closeSync(this.fd);
    } catch {
      // 退出阶段不继续抛错。
    }
    this.fd = null;
  }

  public recordFatal(error: Error, origin: 'uncaughtException' | 'unhandledRejection'): void {
    const fd = this.fd;
    if (fd === null || this.usedBytes >= MAX_JOURNAL_BYTES) return;
    let logTail: DiagnosticLogEntry[] = [];
    try {
      logTail = JSON.parse(this.tailProvider());
    } catch {
      logTail = [];
    }
    const fullRecord: EmergencyMainFatalRecord = {
      schemaVersion: 1,
      lifeId: this.lifeId,
      occurredAt: Date.now(),
      type: 'main_fatal',
      errorName: truncate(error.name || 'Error', 256),
      errorMessage: truncate(error.message || String(error), MAX_MESSAGE_CHARS),
      stack: truncate(error.stack || '', MAX_STACK_CHARS),
      origin,
      logTail,
    };
    const minimalRecord: EmergencyMainFatalRecord = {
      ...fullRecord,
      errorMessage: truncate(fullRecord.errorMessage, 512),
      stack: truncate(fullRecord.stack, 2048),
      logTail: [],
    };
    let line = `${JSON.stringify(fullRecord)}\n`;
    let bytes = Buffer.byteLength(line);
    if (bytes > MAX_RECORD_BYTES || bytes > MAX_JOURNAL_BYTES - this.usedBytes) {
      line = `${JSON.stringify(minimalRecord)}\n`;
      bytes = Buffer.byteLength(line);
    }
    if (bytes > MAX_RECORD_BYTES || bytes > MAX_JOURNAL_BYTES - this.usedBytes) return;
    try {
      fs.writeSync(fd, line);
      fs.fdatasyncSync(fd);
      this.usedBytes += bytes;
    } catch {
      // fatal path 禁止调用 logger 或继续抛错。
    }
  }
}
