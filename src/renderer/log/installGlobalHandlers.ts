// 渲染进程未捕获的 JavaScript 错误统一写入 SQLite 日志。
// 真正的进程崩溃、native crash 和异常退出由 main 的 Crash Recorder 捕获。
// 主窗口与截图窗口入口各安装一次；模块级守卫避免同一 renderer 重复注册。

import { log } from './index';


let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    log.error({
      mod: 'window.onerror',
      msg: event.message || 'Unknown renderer error',
      err: event.error instanceof Error ? event.error : undefined,
      error: event.error instanceof Error ? undefined : event.error,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      href: window.location.href,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    let message = 'Unhandled promise rejection';
    if (reason instanceof Error) {
      message = reason.message;
    } else if (typeof reason === 'string' && reason) {
      message = reason;
    }

    log.error({
      mod: 'unhandledrejection',
      msg: message,
      err: reason instanceof Error ? reason : undefined,
      reason: reason instanceof Error ? undefined : reason,
      href: window.location.href,
    });
  });
}
