import React, { useEffect, useState } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { ToastHost } from '../components/ui/ToastProvider';
import { UpdateHost } from '../components/autoUpdate/UpdateProvider';
import { AppRoutes } from './main.routes';
import { TitleBar } from '../pages/layout/titlebar';
import WindowZoomHotkeys from '../pages/layout/WindowZoomHotkeys';
import McpAuthConsentDialog from '../components/mcp/McpAuthConsentDialog';
import RequestOAuthClientIdDialog from '../components/mcp/RequestOAuthClientIdDialog';
import { useMcpConnectionFailureToast } from '../lib/mcp/useMcpConnectionFailureToast';
import { log } from '@/log';
import { appApi, appEvents } from '@/ipc/app';
import { APP_NAME } from '@shared/constants/branding';

const logger = log.child({ mod: 'App' });

logger.debug({ msg: "App component loaded" });

const McpConnectionFailureToastListener: React.FC = () => {
  const dialog = useMcpConnectionFailureToast();
  return dialog;
};

const AppContent: React.FC = () => {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {/* McpConnectionFailureToastListener must be inside HashRouter because it uses useNavigate */}
      <McpConnectionFailureToastListener />
      <WindowZoomHotkeys />
      <McpAuthConsentDialog />
      <RequestOAuthClientIdDialog />
      <AppRoutesWithTitleBar />
    </BrowserRouter>
  );
};

const AppRoutesWithTitleBar: React.FC = () => {
  const location = useLocation();
  const isAppShellRoute = location.pathname.startsWith('/agent') || location.pathname.startsWith('/settings');

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {!isAppShellRoute && <TitleBar />}
      <div className="flex-1 min-h-0">
        <AppRoutes />
      </div>
    </div>
  );
};

const App: React.FC = () => {
  logger.debug({ msg: "Main App component rendering" });

  // 🚀 State to track app readiness (backend services)
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => {
    // Check initial readiness
    const checkReadiness = async () => {
      try {
        const result = await appApi.isReady();
        if (result.success && result.data) {
          setIsAppReady(true);
        }
      } catch (e) {
        logger.error({ msg: "Readiness check failed", err: e });
        setIsAppReady(true); // Fail open
      }
    };
    checkReadiness();

    // Listen for ready event
    return appEvents.ready((_event, ready) => {
      if (ready) setIsAppReady(true);
    });
  }, []);


  // 🚀 Loading Screen (Wait for Backend Services)
  // We check isAppReady for everyone to ensure backend is ready
  if (!isAppReady) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#1c1c1c] text-white gap-6 select-none app-drag-region">
        {/* Logo/Icon Area */}
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-blue-500 to-purple-600 animate-pulse flex items-center justify-center shadow-lg shadow-purple-500/20">
             <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
             </svg>
          </div>
        </div>

        {/* Loading Text */}
        <div className="flex flex-col items-center gap-2">
          <div className="text-neutral-200 font-medium text-lg tracking-wide">{APP_NAME}</div>
          <div className="flex items-center gap-2 text-neutral-500 text-sm">
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Initializing Core Services...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <AppContent />
      <ToastHost />
      <UpdateHost />
    </>
  );
};

export default App;
