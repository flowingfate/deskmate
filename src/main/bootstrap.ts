// Bootstrap — userData path 设置必须在任何业务模块求值之前。
//
// 关键约束：bootstrap 和 main 必须是**两个独立的 bundle**，否则 rolldown 会把
// main 的所有静态 import hoist 到 bootstrap 顶部，导致下面的 setPath 反而最后才跑。
// 配置在 electron.vite.config.ts 的 input: { bootstrap, main, ... }。
// 这里用 require('./main.js') 而非 import './main' —— 后者会被打包器视为静态
// 依赖、再次内联 main 的代码图，破坏隔离。
//
// 目录布局（所有平台）：
//   业务数据根（appData） = ~/.deskmate/
//   Electron userData     = ~/.deskmate/chromium/  ← Chromium 自动产物（Cache、Cookies、LocalStorage、Crashpad…）
//
// 业务代码请使用 `getAppDataPath()`（src/main/persist/lib/path.ts），
// 不要直接调 `app.getPath('userData')`，否则会落到 chromium/ 子目录。
//
// E2E：DESKMATE_TEST_USER_DATA_PATH 指定的是业务根，bootstrap 内部追加 /chromium。

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'node:module';
import { USER_DATA_DIRNAME } from '@shared/constants/userDataDir';
import { APP_NAME, APP_ID } from '@shared/constants/branding';

const testUserDataOverride = (() => {
  try {
    // 用 process['env'][...] 访问以躲开 vite define 的字面量替换。
    return process['env']['DESKMATE_TEST_USER_DATA_PATH'];
  } catch {
    return undefined;
  }
})();

function applyAppDataRoot(appDataRoot: string, source: string) {
  const chromiumDir = path.join(appDataRoot, 'chromium');
  console.log(`[Bootstrap] ${source}: app data root = ${appDataRoot}`);
  console.log(`[Bootstrap] ${source}: Chromium userData = ${chromiumDir}`);
  fs.mkdirSync(chromiumDir, { recursive: true });
  app.setPath('userData', chromiumDir);
}

const AppName = APP_NAME;
app.setName(AppName);
console.log(`[Bootstrap] Setting App Name to: ${AppName}`);

if (testUserDataOverride) {
  console.log(`[Bootstrap] E2E Test Mode — app data root override: ${testUserDataOverride}`);
  applyAppDataRoot(testUserDataOverride, 'E2E');
} else {
  const appDataRoot = path.join(app.getPath('home'), USER_DATA_DIRNAME);
  applyAppDataRoot(appDataRoot, 'Default');
}

// Windows: 设置 AUMID 让系统通知显示正确的应用名（默认会是 "electron.app.<productName>"）。
// 必须在创建第一个 BrowserWindow 之前。
if (process.platform === 'win32' && APP_ID) {
  console.log(`[Bootstrap] Setting App User Model ID to: ${APP_ID}`);
  app.setAppUserModelId(APP_ID);
}

// rolldown 仅静态追踪 require('字面量')；createRequire 返回的 require 调用不会被
// 当成静态依赖，从而保持 bootstrap / main 两个 bundle 物理隔离。
//
// 不用 `(0, eval)('require')` —— Electron 41 起 main entry 通过 ESM loader 加载
// CJS 文件，indirect eval 跳到 ESM 全局作用域取不到 require。文件作用域的 require
// 仍可用（CJS wrapper 注入），createRequire(__filename) 是官方拿这个 require 的方式。
const dynamicRequire = createRequire(__filename);
dynamicRequire('./main.js');

