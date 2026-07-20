// pino 初始化。延迟到第一次取 logger 时才执行，避免 import 链顶层触发 app.getPath。

import pino, { type Logger, type TransportTargetOptions } from 'pino';
import type ThreadStream from 'thread-stream';
import path from 'path';
import fs from 'fs';
import { getLogsDir } from '@main/persist/lib/path';
import { app } from 'electron';
import { assertLogLifeId } from './lifeId';

export interface PinoInitOptions {
  lifeId: number;
  dbPath?: string;
  isDev?: boolean;
}

export interface PinoInitResult {
  logger: Logger;
  // 退出时调用 transport.end() 并 await 'close' 才能保证 worker 把缓冲 INSERT 落盘。
  // pino.flush() 只 fsync 主线程到 worker 的 pipe，不等 worker 写 sqlite。
  // 测试环境 transport 为 null（直接 silent，无 worker）。
  transport: ThreadStream | null;
}

export function resolveDbPath(isDev: boolean): string {
  return path.join(getLogsDir(), isDev ? 'dev.db' : 'app.db');
}

export function createPinoLogger(opts: PinoInitOptions): PinoInitResult {
  assertLogLifeId(opts.lifeId);
  // 测试环境（vitest）：不开 worker transport（无 electron app、无 better-sqlite3 worker 兼容），
  // 直接走 pino destination 到 /dev/null，保留 API 不报错。
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return {
      logger: pino({ level: 'silent', base: { pid: process.pid, processType: 'main' } }),
      transport: null,
    };
  }

  const isDev = opts.isDev ?? !app.isPackaged;
  const dbPath = opts.dbPath ?? resolveDbPath(isDev);
  const lifeId = opts.lifeId;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const transportPath = path.join(__dirname, 'sqlite-transport.cjs');
  if (!fs.existsSync(transportPath)) {
    throw new Error(
      `[log] sqlite-transport.cjs missing at ${transportPath} — check asarUnpack / build output`
    );
  }

  const targets: TransportTargetOptions[] = [
    {
      target: transportPath,
      level: isDev ? 'debug' : 'info',
      options: { dbPath, lifeId },
    },
  ];

  if (isDev) {
    targets.unshift({
      target: 'pino-pretty',
      level: 'warn',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
    });
  }

  const transport = pino.transport({ targets });

  const logger = pino(
    {
      base: { pid: process.pid, processType: 'main' },
      timestamp: pino.stdTimeFunctions.epochTime,
      level: isDev ? 'debug' : 'info',
    },
    transport
  );

  return { logger, transport };
}
