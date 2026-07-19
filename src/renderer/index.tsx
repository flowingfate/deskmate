import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './entries/main'
import './styles/tokens/_index.scss'
import './styles/globals.css'
import './styles/biz/_index.scss';
import { log as logger } from '@/log';
import { installGlobalErrorHandlers } from '@/log/installGlobalHandlers';

import { WithStore } from './atom';
import { appApi } from '@/ipc/app';

installGlobalErrorHandlers();

// 注意：下面的 window.error / unhandledrejection 监听是**有意保留**的双写。
// installGlobalErrorHandlers() 走 log 系统 → 本地 sqlite（grep / FTS / log viewer 用）。
// 下面 reportRendererError 走 crash 上报包（产品反馈 / Sentry 类用途）。
// 二者目的不同、互补不替代。

function serializeUnknown(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeUnknown(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, serializeUnknown(nestedValue)]),
    );
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  return value;
}

async function recordCrashBreadcrumb(message: string, metadata?: Record<string, unknown>): Promise<void> {
  try {
    await appApi.recordCrashBreadcrumb(message, metadata);
  } catch {
    // Intentionally swallow renderer-side crash reporting failures.
  }
}

async function reportRendererError(report: {
  kind: 'error' | 'unhandledrejection' | 'react-error-boundary';
  message: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  url?: string;
  componentStack?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await appApi.reportRendererError(report);
  } catch {
    // Intentionally swallow renderer-side crash reporting failures.
  }
}

window.addEventListener('error', (event) => {
  void reportRendererError({
    kind: 'error',
    message: event.message || 'Unknown renderer error',
    stack: event.error instanceof Error ? event.error.stack : undefined,
    source: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    url: window.location.href,
    metadata: {
      error: serializeUnknown(event.error),
    },
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);

  void reportRendererError({
    kind: 'unhandledrejection',
    message,
    stack: reason instanceof Error ? reason.stack : undefined,
    url: window.location.href,
    metadata: {
      reason: serializeUnknown(reason),
    },
  });
});

class RootErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean }> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logger.error({ msg: "[Startup] Root error boundary caught renderer error:", err: error, data: info });
    void reportRendererError({
      kind: 'react-error-boundary',
      message: error.message,
      stack: error.stack,
      url: window.location.href,
      componentStack: info.componentStack || undefined,
      metadata: {
        errorName: error.name,
      },
    });
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return null;
    }

    return this.props.children;
  }
}

// Global type definitions are automatically loaded from ./types/global.d.ts

// Startup logs - also displayed in production mode
logger.info({ msg: "DESKMATE App renderer process started!" });
logger.info({ msg: "Current time:", data: new Date().toLocaleString() });
logger.info({ msg: "Environment:", data: process.env.NODE_ENV });
logger.debug({ msg: "User agent:", data: navigator.userAgent });
void recordCrashBreadcrumb('renderer-startup', {
  href: window.location.href,
  userAgent: navigator.userAgent,
  nodeEnv: process.env.NODE_ENV,
});

document.addEventListener('DOMContentLoaded', () => {
  logger.debug({ msg: "DOM content loaded" });
  void recordCrashBreadcrumb('renderer-dom-content-loaded', {
    href: window.location.href,
  });
});

const container = document.getElementById('root');
if (!container) {
  logger.error({ msg: "Failed to find the root element" });
  throw new Error('Failed to find the root element');
}

logger.debug({ msg: "Root element found, creating React root" });
const root = createRoot(container);


root.render(
  <RootErrorBoundary>
    <WithStore><App /></WithStore>
  </RootErrorBoundary>
);

logger.info({ msg: "App rendered successfully" });
void recordCrashBreadcrumb('renderer-app-rendered', {
  href: window.location.href,
});
