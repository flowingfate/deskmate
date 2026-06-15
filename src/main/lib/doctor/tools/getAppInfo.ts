/**
 * get_app_info — return runtime environment info for the application.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getLogDbPath } from '@main/log';
import { getAppDataPath, getChromiumDataPath } from '@main/persist/lib/path';

export const getAppInfoToolDef = {
  type: 'function' as const,
  function: {
    name: 'get_app_info',
    description: `Get current application environment information: version, platform, architecture, memory usage, uptime, and the active sqlite log database (so read_app_logs results can be interpreted in context).`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export async function executeGetAppInfo(): Promise<string> {
  const memUsage = process.memoryUsage();
  const dbPath = getLogDbPath();
  const isDev = !app.isPackaged;

  let dbBytes: number | null = null;
  let walBytes: number | null = null;
  let dbCreatedAt: string | null = null;
  try {
    const stat = fs.statSync(dbPath);
    dbBytes = stat.size;
    const start = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime;
    dbCreatedAt = start.toISOString();
  } catch {
    // db not yet created — leave nulls so the LLM knows the worker hasn't flushed
  }
  try {
    walBytes = fs.statSync(`${dbPath}-wal`).size;
  } catch {
    // wal missing (no live writers / checkpointed) — fine
  }

  const info = {
    app: {
      name: app.getName(),
      version: app.getVersion(),
    },
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    memory: {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
    },
    uptime: `${Math.round(process.uptime())} seconds`,
    appData: getAppDataPath(),
    chromiumData: getChromiumDataPath(),
    userData: getAppDataPath(),
    logs: {
      mode: isDev ? 'dev (truncated at every launch)' : 'prod (accumulating)',
      dbPath,
      dbDir: path.dirname(dbPath),
      dbSizeBytes: dbBytes,
      walSizeBytes: walBytes,
      dbCreatedAt,
    },
  };

  return JSON.stringify(info, null, 2);
}
