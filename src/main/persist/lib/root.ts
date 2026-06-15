/**
 * Persist 模块的根目录解析器。
 *
 * 业务数据根 = ~/.deskmate/，是 persist 模块（含 `./path.ts::getAppDataPath()`）唯一的根派生入口。
 * 单独包一层是为了：
 *  1. 让 persist store 不直接耦合 electron API；
 *  2. 测试时可通过 setRootForTesting() 覆盖到 tmp 目录；
 *  3. 在非 electron 上下文（demo 脚本 / CLI）跑通——延迟 require('electron')。
 */

import * as path from 'node:path';

let overrideRoot: string | null = null;

export function setRootForTesting(root: string | null): void {
  overrideRoot = root;
}

let appRoot = '';
export function getAppRoot(): string {
  if (overrideRoot) return overrideRoot;
  if (appRoot) return appRoot;
  // 延迟 require：当 overrideRoot 设了，永远不会触达 electron import。
  const { app } = require('electron') as typeof import('electron');
  const userData = app.getPath('userData');
  if (path.basename(userData) === 'chromium') {
    return appRoot = path.dirname(userData);
  }
  return userData;
}
