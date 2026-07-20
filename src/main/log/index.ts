// Main 进程统一 logger 入口。
//   import { log } from '@main/log';
//   log.info({ mod: 'chat.streaming', msg: 'start' });
//
// 用 Proxy 延迟初始化：取属性时才触发 createPinoLogger，避免 bootstrap 前调用崩溃。

import type { Logger as PinoLogger } from 'pino';
import type ThreadStream from 'thread-stream';
import type { Logger, LogFields, LogLevel } from '@shared/log/types';
import { createPinoLogger, resolveDbPath } from './pino';
import { requireLogLifeId } from './lifeId';
import { diagnosticLogRing } from '@main/lib/crash-recorder';

let rootPino: PinoLogger | null = null;
let rootLogger: Logger | null = null;
let rootTransport: ThreadStream | null = null;
let closed = false;

function ensureRoot(): Logger {
  if (rootLogger) return rootLogger;
  const init = createPinoLogger({ lifeId: IS_TEST ? 0 : requireLogLifeId() });
  rootPino = init.logger;
  rootTransport = init.transport;
  // thread-stream 是 EventEmitter：关闭竞态下（app 退出 / Ctrl+C 杀进程组时，MCP 子进程
  // exit 回调仍在 log.debug）向已 end/ending 的 worker 写入会 emit 'error'。无监听器时
  // Node 直接把它升级为 Uncaught Exception（见 thread-stream index.js write→error）。
  // 挂一个吞掉「worker 正在结束/已退出」的守卫，避免退出期日志把进程带崩。
  rootTransport?.on('error', (err: Error) => {
    const m = err?.message ?? '';
    if (m.includes('worker is ending') || m.includes('worker has exited')) return;
    // 其它 transport 错误退化到 stderr（此时 sqlite 日志链本身已不可信）。
    try {
      console.error('[log] transport error:', m);
    } catch {
      // ignore
    }
  });
  return rootLogger = wrap(rootPino);
}

function normalize(f: Partial<LogFields>): Record<string, unknown> {
  const { msg: _msg, err, ...rest } = f;
  if (err === undefined || err === null) return rest;
  if (typeof err === 'string') return { ...rest, err: { message: err } };
  if (err instanceof Error) {
    // name / code 抽到顶层 fields（sqlite 没专列，落到 fields JSON）；
    // message / stack 仍在 err 对象里，由 sqlite-transport 抽到独立列。
    const e = err as Error & { code?: unknown };
    const extra: Record<string, unknown> = {};
    if (e.name && e.name !== 'Error') extra.errName = e.name;
    if (e.code !== undefined) extra.errCode = e.code;
    return { ...rest, ...extra, err: { message: e.message, stack: e.stack } };
  }
  if (typeof err === 'object') {
    const e = err as { message?: unknown; stack?: unknown; name?: unknown; code?: unknown };
    const extra: Record<string, unknown> = {};
    if (typeof e.name === 'string' && e.name !== 'Error') extra.errName = e.name;
    if (e.code !== undefined) extra.errCode = e.code;
    return { ...rest, ...extra, err: { message: String(e.message ?? ''), stack: typeof e.stack === 'string' ? e.stack : undefined } };
  }
  return { ...rest, err: { message: String(err) } };
}

function emit(
  child: PinoLogger,
  level: LogLevel,
  fields: LogFields,
  bindings: Partial<LogFields>,
): void {
  // 退出序列里 closeLogs() 之后仍可能有迟到的日志调用（如 MCP 子进程 exit 回调）。
  // worker 已 end，再写会触发 thread-stream 'error'；直接 no-op，别喂正在关闭的 worker。
  if (closed) return;
  try {
    diagnosticLogRing.append(level, fields, bindings);
  } catch {
    // Ring 是辅助诊断 sink，失败不能影响主日志路径。
  }
  child[level](normalize(fields), fields.msg);
}
function wrap(p: PinoLogger, bindings: Partial<LogFields> = {}): Logger {
  return {
    trace: (fields) => emit(p, 'trace', fields, bindings),
    debug: (fields) => emit(p, 'debug', fields, bindings),
    info: (fields) => emit(p, 'info', fields, bindings),
    warn: (fields) => emit(p, 'warn', fields, bindings),
    error: (fields) => emit(p, 'error', fields, bindings),
    fatal: (fields) => emit(p, 'fatal', fields, bindings),
    child: (nextBindings) => wrap(p.child(normalize(nextBindings)), { ...bindings, ...nextBindings }),
    flush: () =>
      // 真等到 worker 把缓冲落盘（pino 的 p.flush 只 fsync 到 worker pipe，不等 worker ack）。
      // thread-stream.flush(cb): "callback invoked once data has been consumed by the worker
      //   and the worker destination has acknowledged the flush"。
      // 测试环境 / 未启 worker：直接 resolve。
      new Promise<void>((res, rej) => {
        if (!rootTransport) {
          res();
          return;
        }
        try {
          rootTransport.flush((err) => (err ? rej(err) : res()));
        } catch (e) {
          rej(e);
        }
      }),
  };
}

// 测试环境直接 eager 初始化为普通对象，便于 vi.spyOn。
// 生产/开发用 Proxy 懒加载，避免 bootstrap 前调用崩溃。
const IS_TEST = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

export const log: Logger = IS_TEST
  ? ensureRoot()
  : new Proxy({} as Logger, {
      get(_t, key: keyof Logger) {
        const root = ensureRoot();
        const v = root[key];
        return typeof v === 'function' ? v.bind(root) : v;
      },
    });

// 返回当前进程对应的 sqlite db 路径。dev / prod 自动区分；与 pino transport 落库一致。
// 给 doctor agent / log viewer / 任何需要直接读 db 的代码用。
export function getLogDbPath(): string {
  return resolveDbPath(isDevLogDb());
}

// 当前 logger 是否在用 dev db（dev.db）。dev 与 prod db 都跨启动累积，
// 仅写入 level 与文件名不同（dev 写 debug，prod 写 info）。
// 与 createPinoLogger 内部判断同源；任何需要"dev 模式特殊处理"的 reader 用这个，
// 而不是各自再 import electron 判 app.isPackaged，避免漂移。
export function isDevLogDb(): boolean {
  const { app } = require('electron') as typeof import('electron');
  return !app.isPackaged;
}


// 用于导出 debug 包 / 手动 "Log to Disk" 菜单 / 任何需要"读盘前确保已写"的场景。
// 实现委托给 log.flush()（已基于 thread-stream.flush 实现 worker ack 语义）。
export async function flushLogs(): Promise<void> {
  if (!rootLogger) return;
  await rootLogger.flush();
}

// 退出场景：先 flush，再 end transport。end 后 logger 不应再被使用。
// 反复调用 no-op。带超时避免卡死退出。
export async function closeLogs(timeoutMs = 5000): Promise<void> {
  if (closed) return;
  if (!rootLogger || !rootTransport) {
    closed = true;
    return;
  }
  closed = true;

  try {
    await rootLogger.flush();
  } catch {
    // flush 失败也要继续 end，避免阻塞退出。
  }

  const transport = rootTransport;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    transport.once('close', () => {
      clearTimeout(timer);
      finish();
    });
    transport.once('error', () => {
      clearTimeout(timer);
      finish();
    });
    transport.end();
  });
}
