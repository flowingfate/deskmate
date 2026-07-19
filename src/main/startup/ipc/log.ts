// Renderer → Main 日志通道（单向 send，无返回）。
//   ipcRenderer.send('log:write', { level, fields })
//   ipcRenderer.send('log:writeBatch', [{ level, fields }, ...])
//
// renderer 不需要 flush —— 它不读 sqlite，等 worker 落盘没有意义。
// main 自己在 exportDebugInfo / 菜单 / before-quit 触发 flushLogs / closeLogs。
//
// processType / windowId 在此覆写：main 是这两个字段的唯一权威 writer，
// renderer 即便传了同名字段也以此为准（数据一致性，非 trust boundary）。
// 注意：必须在 setUpAllIPCHandlers 入口最早注册，避免 startup 阶段 renderer 日志丢失。

import { ipcMain, type IpcMainEvent } from 'electron';
import { log } from '@main/log';
import type { LogFields, LogLevel } from '@shared/log/types';

const LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>([
  'trace', 'debug', 'info', 'warn', 'error', 'fatal',
]);

interface LogWritePayload {
  level: LogLevel;
  fields: LogFields;
}

function isPayload(v: unknown): v is LogWritePayload {
  if (!v || typeof v !== 'object') return false;
  const p = v as { level?: unknown; fields?: unknown };
  if (typeof p.level !== 'string' || !LEVELS.has(p.level as LogLevel)) return false;
  if (!p.fields || typeof p.fields !== 'object') return false;
  return true;
}

export function registerLogIPC(): void {
  ipcMain.on('log:write', (event: IpcMainEvent, payload: unknown) => {
    handleOne(event, payload);
  });
  ipcMain.on('log:writeBatch', (event: IpcMainEvent, payload: unknown) => {
    // 批量逐条校验：避免一条非法把整批丢掉。
    if (!Array.isArray(payload)) return;
    for (const item of payload) handleOne(event, item);
  });
}

function handleOne(event: IpcMainEvent, payload: unknown): void {
  if (!isPayload(payload)) return;
  const { level, fields } = payload;
  log[level]({
    ...fields,
    msg: String(fields.msg ?? ''),
    processType: 'renderer',
    windowId: event.sender.id,
  });
}
