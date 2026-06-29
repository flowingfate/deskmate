import brandConfig from '../../../brands/deskmate/config.json';

export const BRAND_NAME = 'deskmate';
export const BRAND_CONFIG = brandConfig;
export const APP_NAME: string = brandConfig.productName;
export const APP_ID: string = brandConfig.appId;

// 构建期由 scripts/vite/defines.ts 注入 root package.json 的 version。
// app.getVersion() 在 dev（entry 为 out/main/bootstrap.js，appPath 无 package.json）
// 会回退成 Electron bundle 版本，故展示用版本号统一走此常量。
declare const __APP_VERSION__: string | undefined;
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

export const getWindowTitle = () =>
  brandConfig.windowTitle || `${APP_NAME} AI Studio`;
