import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, Minus, Square, X, Copy, ZoomIn, ZoomOut, PanelRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { APP_NAME } from '@shared/constants/branding';
import { useAppZoomLevel } from '../../../lib/userData/useAppZoomLevel';
import { RightPaneCollapsedAtom } from '@/states/right-pane.atom';
import appIcon from '../../../assets/deskmate/app.svg';
import { appApi } from '@/ipc/app';
import { windowApi, windowEvents } from '@/ipc/window';
import './TitleBar.scss';

type Platform = 'mac' | 'windows' | null;

function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>(() => {
    const p = window.electronAPI?.platform;
    if (p === 'darwin') return 'mac';
    if (p === 'win32') return 'windows';
    return null;
  });

  useEffect(() => {
    if (platform) return;
    appApi.getPlatformInfo().then((info) => {
      if (info.platform === 'darwin') setPlatform('mac');
      else if (info.platform === 'win32') setPlatform('windows');
    }).catch(() => {});
  }, [platform]);

  return platform;
}

function useMacFullScreen(isMac: boolean): boolean {
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    if (!isMac) return;
    windowApi.isFullScreen().then(setFullScreen).catch(() => {});
    const cleanup = windowEvents.fullScreenChanged((_event, fs) => setFullScreen(fs));
    return cleanup;
  }, [isMac]);

  return fullScreen;
}

function HistoryNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const historyRef = useRef<string[]>([location.pathname + location.search]);
  const cursorRef = useRef(0);
  const isNavRef = useRef(false);

  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const updateButtons = useCallback(() => {
    setCanGoBack(cursorRef.current > 0);
    setCanGoForward(cursorRef.current < historyRef.current.length - 1);
  }, []);

  useEffect(() => {
    const path = location.pathname + location.search;
    if (isNavRef.current) {
      isNavRef.current = false;
      updateButtons();
      return;
    }
    const cursor = cursorRef.current;
    historyRef.current = [...historyRef.current.slice(0, cursor + 1), path];
    cursorRef.current = historyRef.current.length - 1;
    updateButtons();
  }, [location, updateButtons]);

  const goBack = useCallback(() => {
    if (cursorRef.current <= 0) return;
    isNavRef.current = true;
    cursorRef.current--;
    navigate(historyRef.current[cursorRef.current]);
  }, [navigate]);

  const goForward = useCallback(() => {
    if (cursorRef.current >= historyRef.current.length - 1) return;
    isNavRef.current = true;
    cursorRef.current++;
    navigate(historyRef.current[cursorRef.current]);
  }, [navigate]);

  return (
    <>
      <Button variant="ghost" size="icon-sm" onClick={goBack} disabled={!canGoBack} title="Back">
        <ChevronLeft size={14} />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={goForward} disabled={!canGoForward} title="Forward">
        <ChevronRight size={14} />
      </Button>
    </>
  );
}

export const TitleBar: React.FC = () => {
  const platform = usePlatform();
  const isMac = platform === 'mac';
  const isWindows = platform === 'windows';
  const isMacFullScreen = useMacFullScreen(isMac);

  const [rightCollapsed, { toggle: toggleRight }] = RightPaneCollapsedAtom.use();

  const [isMaximized, setIsMaximized] = useState(false);
  const zoomLevel = useAppZoomLevel();
  const [showPercent, setShowPercent] = useState(false);
  const percentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomPercent = Math.round(Math.pow(1.2, zoomLevel) * 100);

  const location = useLocation();
  const showTogglePanel = location.pathname.startsWith('/agent');

  const prevZoomRef = useRef(zoomLevel);
  useEffect(() => {
    if (prevZoomRef.current !== zoomLevel) {
      prevZoomRef.current = zoomLevel;
      setShowPercent(true);
      if (percentTimerRef.current) clearTimeout(percentTimerRef.current);
      percentTimerRef.current = setTimeout(() => setShowPercent(false), 1500);
    }
    return () => { if (percentTimerRef.current) clearTimeout(percentTimerRef.current); };
  }, [zoomLevel]);

  useEffect(() => {
    if (!isWindows) return;
    const checkMaximized = async () => {
      const max = await windowApi.isMaximized();
      setIsMaximized(!!max);
    };
    checkMaximized();

    const cleanup = windowEvents.stateChanged((_event, state) => {
      setIsMaximized(state === 'maximized');
    });
    return cleanup;
  }, [isWindows]);

  if (!platform) return null;

  const handleMenuClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    windowApi.showAppMenu(rect.left, rect.bottom);
  };

  return (
    <div className="titlebar" style={isMac && !isMacFullScreen ? { paddingLeft: 80 } : undefined}>
      <div className="titlebar-left">
        {isWindows && (
          <>
            <img src={appIcon} alt={APP_NAME} className="titlebar-app-icon" />
            <div className="titlebar-app-name">{APP_NAME}</div>
          </>
        )}
      </div>

      <div className="titlebar-right">
        <HistoryNav />
        {showTogglePanel && (
          <Button
            variant={rightCollapsed ? 'ghost' : 'secondary'}
            size="icon-sm"
            onClick={toggleRight}
            aria-label={rightCollapsed ? 'Show tasks' : 'Hide tasks'}
            aria-pressed={!rightCollapsed}
            title={rightCollapsed ? 'Show Tasks' : 'Hide Tasks'}
          >
            <PanelRight size={14} />
          </Button>
        )}

        {zoomPercent !== 100 && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => windowApi.resetZoom()}
            title={`Zoom: ${zoomPercent}% (Click to reset)`}
          >
            {showPercent ? (
              <span style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>{zoomPercent}%</span>
            ) : (
              zoomPercent < 100 ? <ZoomIn size={14} /> : <ZoomOut size={14} />
            )}
          </Button>
        )}

        <Button variant="ghost" size="icon-sm"  onClick={handleMenuClick} title="Menu">
          <Menu size={14} />
        </Button>

        {isWindows && (
          <div className="titlebar-window-controls">
            <Button variant="ghost" size="icon-sm"  onClick={() => windowApi.minimize()} title="Minimize">
              <Minus size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => isMaximized ? windowApi.unmaximize() : windowApi.maximize()}
              title={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? <Copy size={14} /> : <Square size={13} />}
            </Button>
            <Button variant="ghost" size="icon-sm" className="hover:bg-red-500 hover:text-white" onClick={() => windowApi.close()} title="Close">
              <X size={14} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
