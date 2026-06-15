// 渲染进程全局未捕获异常 → log 系统。
// 与 src/renderer/index.tsx 现有的 appApi.reportRendererError(crash 上报路径) 并行：
//   reportRendererError → 产品反馈包 / 崩溃统计
//   log.error            → 本地 sqlite，给 grep / FTS / log viewer 用
// 两者目的不同，互不替代。
//
// 三个 renderer entry（index.tsx / screenshot.tsx / 未来的 viewer）顶部各 import 一次即可。

import { log } from './index';

let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    log.error({
      mod: 'window.onerror',
      msg: event.message || 'unknown error',
      err: event.error instanceof Error ? event.error : undefined,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    log.error({
      mod: 'unhandledrejection',
      msg: reason instanceof Error ? reason.message : String(reason),
      err: reason instanceof Error ? reason : undefined,
    });
  });
}
