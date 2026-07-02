// 构建产物路径常量。
//
// 构建布局（dev 与 prod 一致）：
//   out/main/        main / bootstrap / chunks / sqlite-transport.cjs
//   out/preload/     preload.js / preload.screenshot.js / preload.log-viewer.js / preload.research.js
//   out/renderer/    React SPA
//
// 打包时 scripts/vite/pack.mts 把整个 out/ 复制为 vite-pack/out/，
// electron-builder.config.js 的 files glob 与 asarUnpack 与之对齐。
//
// 调用方一律走这里取路径，避免散落的 path.join(__dirname, '...') 在后续目录调整时漏改其中一处。

import path from 'node:path';

// __dirname === out/main/（main 段所有 chunk 都 flat 落在这里）。
// 任何 main bundle 内的代码都能用 __dirname 作锚点。
const MAIN_DIR = __dirname;
const PRELOAD_DIR = path.join(MAIN_DIR, '..', 'preload');

export const PRELOAD_PATH = {
  main: path.join(PRELOAD_DIR, 'preload.js'),
  screenshot: path.join(PRELOAD_DIR, 'preload.screenshot.js'),
  logViewer: path.join(PRELOAD_DIR, 'preload.log-viewer.js'),
  research: path.join(PRELOAD_DIR, 'preload.research.js'),
} as const;

// 注入脚本产物（extractor IIFE 子构建落在 preload 目录）。
export const INJECT_PATH = {
  extractor: path.join(PRELOAD_DIR, 'extractor.js'),
} as const;
