// Log Viewer 主进程：BrowserWindow 单例 + 实时增量通知。
//
// 设计要点：
//   - 单例：重复触发菜单只 focus，不重复开。
//   - dev-only：菜单项 visible:!app.isPackaged 已守住，这里再 assert 一次防误调。
//   - 实时通知：viewer 打开时启动 250ms poll，对比 max(id) 变化通过 logViewer.appended 广播；
//     viewer 全部关闭即停 poll，避免无 viewer 时白白每秒查 4 次。
//   - poll 用 better-sqlite3 readonly 连接（与 doctor tools 一致），lazy 单例避免模块顶层就打开 db。
//   - 故意不用 fs.watch / pino worker postMessage —— 前者粒度太粗，后者要侵入 transport.cjs，
//     收益不抵复杂度。step9 切 WASM SQLite 后这一段会被替换，先求最简。

import { ipcMain, app } from 'electron';
import { createWindow, logWindow } from '../startup/wins';
import path from 'path';
import Database from 'better-sqlite3';
import { buildQuery, buildWhere } from '@shared/log/query';
import type { LogQueryFilter, LogRow } from '@shared/log/types';
import { renderToMain, mainToRender, type ViewerStats, type LifeInfo } from '@shared/ipc/logViewer';
import { getLogDbPath, isDevLogDb, log } from './index';
import { PRELOAD_PATH } from '@main/lib/buildPaths';

let viewerCount = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastId = 0;
let db: Database.Database | null = null;
let maxIdStmt: Database.Statement<unknown[], { m: number | null }> | null = null;

const POLL_INTERVAL_MS = 250;
const DEV_SERVER_PORT = process.env.DEV_SERVER_PORT || '39017';
const DEV_SERVER_URL =
  process.env['ELECTRON_RENDERER_URL'] || `http://localhost:${DEV_SERVER_PORT}`;

function ensureDb(): Database.Database | null {
  if (db) return db;
  const dbPath = getLogDbPath();
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return db;
  } catch (err) {
    log.warn({ mod: 'log.viewer', msg: 'open db failed', err, dbPath });
    return null;
  }
}

function ensureMaxIdStmt(): Database.Statement<unknown[], { m: number | null }> | null {
  if (maxIdStmt) return maxIdStmt;
  const conn = ensureDb();
  if (!conn) return null;
  maxIdStmt = conn.prepare<unknown[], { m: number | null }>(
    'SELECT max(id) AS m FROM app_logs',
  );
  return maxIdStmt;
}

function closeDb(): void {
  maxIdStmt = null;
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
  }
}

function tick(): void {
  const stmt = ensureMaxIdStmt();
  if (!stmt) return;
  const row = stmt.get();
  const m = row?.m ?? 0;
  if (m > lastId) {
    lastId = m;
    const win = logWindow();
    if (win && !win.isDestroyed()) {
      mainToRender.bindWebContents(win.webContents).appended(m);
    }
  }
}

function startPoll(): void {
  if (pollTimer) return;
  // 初始化 lastId 为当前最大，避免首次广播刷出一大批历史。
  const stmt = ensureMaxIdStmt();
  if (stmt) {
    const row = stmt.get();
    lastId = row?.m ?? 0;
  }
  pollTimer = setInterval(tick, POLL_INTERVAL_MS);
}

function stopPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  closeDb();
}

export function openLogViewerWindow(): void {
  if (app.isPackaged) {
    // 守第二道：菜单项已 visible:false，但若被外部误调，直接 no-op。
    return;
  }
  const existing = logWindow();
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const win = createWindow({
    width: 1280,
    height: 800,
    title: 'Deskmate · Log Viewer',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: PRELOAD_PATH.logViewer,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  }, { role: 'log' });

  viewerCount += 1;
  if (viewerCount === 1) startPoll();

  win.on('closed', () => {
    viewerCount -= 1;
    if (viewerCount === 0) stopPoll();
  });

  if (isDevLogDb()) {
    void win.loadURL(`${DEV_SERVER_URL}/log-viewer.html`);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/log-viewer.html'));
  }
}

let ipcRegistered = false;
export function registerLogViewerIPC(): void {
  if (ipcRegistered) return;
  // Viewer 是 dev-only 功能；prod 包不暴露 IPC 通道，减少 attack surface。
  if (app.isPackaged) return;
  ipcRegistered = true;

  const handle = renderToMain.bindMain(ipcMain);

  handle.getDbPath(() => getLogDbPath());

  // query：把 LogQueryFilter 翻成 SQL 跑一次，原样返回 LogRow[]。
  // viewer 是 dev-only，input 来自我们自己的 renderer，不做强校验；
  // 仅 clamp limit 避免误传一个超大数把主进程拖死。
  handle.query((_e, filter: LogQueryFilter): LogRow[] => {
    const conn = ensureDb();
    if (!conn) return [];
    const safeFilter: LogQueryFilter = {
      ...filter,
      limit: Math.min(Math.max(filter.limit ?? 500, 1), 5000),
    };
    const { sql, params } = buildQuery(safeFilter);
    return conn.prepare<unknown[], LogRow>(sql).all(...params);
  });

  // stats：总行数 + 按 level 计数。可选 filter 限定范围（默认全表）。
  handle.stats((_e, filter: LogQueryFilter): ViewerStats => {
    const conn = ensureDb();
    if (!conn) return { total: 0, byLevel: [] };
    const { where, params } = buildWhere(filter);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = conn
      .prepare<unknown[], { c: number }>(`SELECT count(*) AS c FROM app_logs ${whereSql}`)
      .get(...params)?.c ?? 0;
    const byLevel = conn
      .prepare<unknown[], { level: number; c: number }>(
        `SELECT level, count(*) AS c FROM app_logs ${whereSql} GROUP BY level ORDER BY level`,
      )
      .all(...params);
    return { total, byLevel };
  });

  // lives：返回最近 N 个 life 的概览（id / 行数 / 时间跨度 / 是否当前 life）。
  // 一次性把 LifePicker 需要的元数据全拿回去，避免下拉里逐项再发 IPC。
  // life_id 有 idx_logs_life 索引，GROUP BY life_id 走得通；行数远小于全表 → COUNT 开销可忽略。
  handle.lives((_e, opts): LifeInfo[] => {
    const conn = ensureDb();
    if (!conn) return [];
    const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 200);
    const rows = conn
      .prepare<unknown[], { life_id: number; rows: number; first_ts: number; last_ts: number }>(
        // 注意 ORDER BY life_id DESC：拿"最近"的 life；max(life_id) = 当前 life。
        // life_id 不严格单调（mod maxRows），但实际 dev 远远撞不到回环，按 id DESC 排序等同于"按启动倒序"。
        `SELECT life_id, COUNT(id) AS rows, MIN(ts) AS first_ts, MAX(ts) AS last_ts
           FROM app_logs
          GROUP BY life_id
          ORDER BY life_id DESC
          LIMIT ?`,
      )
      .all(limit);
    if (rows.length === 0) return [];
    const currentId = rows[0].life_id;
    return rows.map((r) => ({
      id: r.life_id,
      firstTs: r.first_ts,
      lastTs: r.last_ts,
      rows: r.rows,
      current: r.life_id === currentId,
    }));
  });
}
