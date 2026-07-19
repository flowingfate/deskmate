/**
 * 主窗口瞬时状态（几何、缩放、最大化）。
 *
 * 每个主窗口不可变地绑定一个 Profile，因此状态持久化到
 * `~/.deskmate/profiles/{profileId}/window.json`。`state/current-run.json` 仍是
 * 整个应用进程的崩溃恢复标记，不属于任何 Profile。
 *
 * `state/windows/{profileId}.json` 与更早的 `state/window.json` 都只作为迁移
 * 回退；下一次对应状态写入会落到 Profile 目录。
 */

import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow, screen, type Rectangle } from 'electron';
import { z } from 'zod';
import { getAppDataPath, getStateDir } from '@main/persist/lib/path';
import { PERSIST_PATH } from '@shared/persist/path';

const boundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

const windowStateSchema = z.object({
  version: z.literal(1).optional(),
  bounds: boundsSchema.optional(),
  zoomLevel: z.number().finite().optional(),
  maximized: z.boolean().optional(),
});

type PersistedWindowState = z.infer<typeof windowStateSchema>;

const states = new Map<string, PersistedWindowState>();
const writes = new Map<string, Promise<void>>();

const stateFile = (profileId: string) => PERSIST_PATH.windowStateFile(getAppDataPath(), profileId);
const transitionalStateFile = (profileId: string) =>
  path.join(getStateDir(), 'windows', `${encodeURIComponent(profileId)}.json`);
const legacyBoundsFile = () => path.join(getStateDir(), 'window.json');

// 至少要有这么大的可见交集，才认为窗口"还在某块屏幕上"（保证标题栏可被拖动）。
const MIN_VISIBLE_W = 120;
const MIN_VISIBLE_H = 80;

function readStateFile(file: string): PersistedWindowState {
  try {
    const parsed = windowStateSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function readLegacyBounds(): Rectangle | undefined {
  try {
    const parsed = boundsSchema.safeParse(JSON.parse(fs.readFileSync(legacyBoundsFile(), 'utf-8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function readState(profileId: string): PersistedWindowState {
  const cached = states.get(profileId);
  if (cached) return cached;

  const state: PersistedWindowState = {
    ...readStateFile(transitionalStateFile(profileId)),
    ...readStateFile(stateFile(profileId)),
  };
  if (state.bounds === undefined) state.bounds = readLegacyBounds();
  states.set(profileId, state);
  return state;
}

function persistState(profileId: string): Promise<void> {
  const previous = writes.get(profileId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const state = readState(profileId);
      state.version = 1;
      await fs.promises.mkdir(path.dirname(stateFile(profileId)), { recursive: true });
      await fs.promises.writeFile(stateFile(profileId), JSON.stringify(state));
    });

  writes.set(profileId, next);
  return next.finally(() => {
    if (writes.get(profileId) === next) writes.delete(profileId);
  });
}

function updateState(profileId: string, update: PersistedWindowState): Promise<void> {
  Object.assign(readState(profileId), update);
  return persistState(profileId);
}

/**
 * 读取指定 Profile 上次几何，作为 BrowserWindow 构造选项展开。
 * - 区域仍落在某块已连接显示器上 → 返回完整 {x, y, width, height}。
 * - 区域已不可见（如外接屏拔出）→ 只返回尺寸，由系统居中。
 * - 无记录 / 读取失败 → 返回 {}，沿用调用方默认值。
 */
export function restoreBounds(profileId: string): Partial<Rectangle> {
  const bounds = readState(profileId).bounds;
  if (!bounds) return {};

  const visible = screen.getAllDisplays().some((display) => {
    const workArea = display.workArea;
    const width = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const height = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return width >= MIN_VISIBLE_W && height >= MIN_VISIBLE_H;
  });
  return visible ? bounds : { width: bounds.width, height: bounds.height };
}

/** 挂载 move / resize 监听，防抖保存指定 Profile 的还原态几何。 */
export function trackBounds(win: BrowserWindow, profileId: string): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void updateState(profileId, { bounds }).catch(() => {});
    }, 400);
  };
  win.on('move', save);
  win.on('resize', save);
}

export function restoreZoomLevel(profileId: string, legacyZoomLevel: number): number {
  return readState(profileId).zoomLevel ?? legacyZoomLevel;
}

export function persistZoomLevel(profileId: string, zoomLevel: number): Promise<void> {
  return updateState(profileId, { zoomLevel });
}

export function restoreMaximized(profileId: string, legacyMaximized: boolean): boolean {
  return readState(profileId).maximized ?? legacyMaximized;
}

export function persistMaximized(profileId: string, maximized: boolean): Promise<void> {
  return updateState(profileId, { maximized });
}
