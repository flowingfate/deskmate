/**
 * 主窗口几何记忆（位置 + 尺寸 + 所在屏幕）。
 *
 * 窗口几何属于"瞬时 UI 状态"而非应用配置，故独立持久化到
 * `~/.deskmate/state/window.json`，不掺入 app.json 的配置管道。
 * 整个特性自包含于此模块：`restoreBounds()` 供窗口构造时展开，
 * `trackBounds()` 在创建后挂上防抖保存。最大化状态仍由 app.json 单独管理。
 */

import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow, screen, type Rectangle } from 'electron';
import { getStateDir } from '@main/persist/lib/path';

const stateFile = () => path.join(getStateDir(), 'window.json');

// 至少要有这么大的可见交集，才认为窗口"还在某块屏幕上"（保证标题栏可被拖动）。
const MIN_VISIBLE_W = 120;
const MIN_VISIBLE_H = 80;

/**
 * 读取上次几何，作为 BrowserWindow 构造选项展开。
 * - 区域仍落在某块已连接显示器上 → 返回完整 {x, y, width, height}。
 * - 区域已不可见（如外接屏拔出）→ 只返回尺寸，由系统居中。
 * - 无记录 / 读取失败 → 返回 {}，沿用调用方默认值。
 */
export function restoreBounds(): Partial<Rectangle> {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf-8')) as Rectangle;
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0) {
      return {};
    }
    const visible = screen.getAllDisplays().some((d) => {
      const wa = d.workArea;
      const iw = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x);
      const ih = Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y);
      return iw >= MIN_VISIBLE_W && ih >= MIN_VISIBLE_H;
    });
    return visible ? b : { width: b.width, height: b.height };
  } catch {
    return {};
  }
}

/**
 * 挂载 move / resize 监听，防抖（400ms）保存"还原态"几何。
 * 用 getNormalBounds：最大化/全屏时它返回还原后的位置，正是下次启动要恢复的。
 */
export function trackBounds(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fs.promises
        .mkdir(getStateDir(), { recursive: true })
        .then(() => fs.promises.writeFile(stateFile(), JSON.stringify(bounds)))
        .catch(() => {});
    }, 400);
  };
  win.on('move', save);
  win.on('resize', save);
}
