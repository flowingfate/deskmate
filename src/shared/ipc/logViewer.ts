// Log Viewer 强类型 IPC 契约。
//
// 两个方向：
//   R→M (invoke/handle)：getDbPath / query / stats — viewer 主动拉数据。
//   M→R (send/on)：     appended                  — main poll 到 max(id) 变化，广播新值。
//
// 仅 dev 启用：viewer 是 dev-only 工具，main 注册时会 if (app.isPackaged) return。
// 即便 prod renderer 拿到了 invoke proxy，main 没注册 handler 调用会被 Electron 拒。

import { connectRenderToMain, connectMainToRender } from './base';
import type { LogQueryFilter, LogRow } from '../log/types';

export interface ViewerStats {
  total: number;
  byLevel: Array<{ level: number; c: number }>;
}

/**
 * 单个 life 的概览信息。viewer 用它在 LifePicker 里渲染"Life 28 · 2 分钟前 · 1.2k 行"。
 * - `id`：life_id 值，[1, maxRows]。
 * - `firstTs / lastTs`：该 life 内日志的时间跨度，用来判断"当前 life"与"上次启动"。
 * - `rows`：行数（用 COUNT(id)，life 内行数远小于全表，开销可忽略）。
 * - `current`：是否是 db 里 max(life_id)，对应当前运行中的 app 进程。
 */
export interface LifeInfo {
  id: number;
  firstTs: number;
  lastTs: number;
  rows: number;
  current: boolean;
}

type RenderToMain = {
  getDbPath: { call: []; return: string };
  query: { call: [filter: LogQueryFilter]; return: LogRow[] };
  stats: { call: [filter: LogQueryFilter]; return: ViewerStats };
  /**
   * 返回最近 `limit` 个 life 的概览，按 id DESC（最新先）。
   * 主要用于 LifePicker 下拉；`limit` 缺省 20，足够覆盖日常排查窗口。
   */
  lives: { call: [opts?: { limit?: number }]; return: LifeInfo[] };
};

type MainToRender = {
  // 新落库的最大 id。viewer 用 sinceId 做增量拉取。
  appended: number;
};

export const renderToMain = connectRenderToMain<RenderToMain>('logViewer');
export const mainToRender = connectMainToRender<MainToRender>('logViewer');
