import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './entries/main'
import './styles/tokens/_index.scss'
import './styles/globals.css'
import './styles/biz/_index.scss';
import { log as logger } from '@/log';
import { installGlobalErrorHandlers } from '@/log/installGlobalHandlers';

import { WithStore } from './atom';

installGlobalErrorHandlers();




class RootErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean }> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logger.fatal({
      mod: 'react.root-error-boundary',
      msg: 'Root error boundary caught renderer error',
      err: error,
      componentStack: info.componentStack || undefined,
      href: window.location.href,
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

document.addEventListener('DOMContentLoaded', () => {
  logger.debug({ msg: "DOM content loaded" });
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
