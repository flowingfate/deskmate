import React, { useEffect } from 'react';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  useNavigate,
  useLocation,
  type RouteObject,
} from 'react-router-dom';
import { SignInPage } from '../pages/SignInPage';
import { AgentPage } from '../pages/AgentPage';
import SettingsPage from '../pages/SettingsPage';

import ChatView from '../components/chat/ChatView';
import McpView from '../components/mcp/McpView';
import ToolsView from '../components/tools/ToolsView';
import AddNewMcpServerView from '../components/mcp/AddNewMcpServerView';
import SkillsView from '../components/skills/SkillsView';
import SubAgentsView from '../components/subAgents/SubAgentsView';
import CreateSubAgentView from '../components/subAgents/CreateSubAgentView';
import EditSubAgentView from '../components/subAgents/EditSubAgentView';
import SubAgentsSettingsLayout from '../components/subAgents/SubAgentsSettingsLayout';
import RuntimeSettingsView from '../components/settings/runtime/RuntimeSettingsView';
import { navigateEvents } from '@/ipc/navigate';
import { useSessionCompletionToast } from '../lib/scheduler/useSessionCompletionToast';
import ScreenshotSettingsView from '../components/settings/screenshot/ScreenshotSettingsView';
import AboutAppView from '../components/settings/about/AboutAppView';
import ArchivedAgentsView from '../components/settings/ArchivedAgentsView';
import ProviderList from '../components/settings/auth/ProviderList';
import PersistSettingsView from '../components/settings/persist/PersistSettingsView';
import AgentEditingView from '../components/chat/agent-area/AgentEditingView';
import AgentCreationView from '../components/chat/agent-area/AgentCreationView';
import CreateCustomAgentView from '../components/chat/agent-area/CreateCustomAgentView';
import { useFeatureFlag } from '../lib/featureFlags';
import type { FeatureFlagName } from '@shared/types/featureFlagTypes';
import { log } from '@/log';
import { appApi } from '@/ipc/app';
import { AppShell } from '@renderer/pages/layout/AppShell';
import { TitleBar } from '../pages/layout/titlebar';
import WindowZoomHotkeys from '../pages/layout/WindowZoomHotkeys';
import McpAuthConsentDialog from '../components/mcp/McpAuthConsentDialog';
import RequestOAuthClientIdDialog from '../components/mcp/RequestOAuthClientIdDialog';
import { useMcpConnectionFailureToast } from '../lib/mcp/useMcpConnectionFailureToast';
import { settingsEntryLoader } from '@renderer/lib/navigation/settingsEntry';
import { ConfirmationDialogHost } from '../components/ui/ConfirmationDialog';

const logger = log.child({ mod: 'AppRoutes' });

const McpConnectionFailureToastListener: React.FC = () => {
  return useMcpConnectionFailureToast();
};

/**
 * Feature-flag guard for data-router static routes.
 *
 * 数据路由的路由表是静态对象，无法像旧的 `<Routes>` 那样用 `useFeatureFlag`
 * 在构建期条件注册。改为始终注册路由、在元素层用本 guard 做 reactive 门控：
 * flag 关闭时重定向到 "/"，复现旧实现下路由未注册、fall-through 到 `*` 的行为。
 */
const FeatureGate: React.FC<{ flag: FeatureFlagName; children: React.ReactNode }> = ({ flag, children }) => {
  const enabled = useFeatureFlag(flag);
  if (!enabled) return <Navigate to="/" replace />;
  return <>{children}</>;
};

/**
 * 根布局路由。
 *
 * 数据路由的 `RouterProvider` 不接受 children，原先挂在 `<BrowserRouter>` 下、
 * 依赖路由 context 的全局节点（MCP 失败提示、缩放热键、MCP dialog）与全局 effect
 * （主进程导航事件、crash 面包屑）全部迁入此处。非 shell 路由（/login、/）的独立
 * TitleBar 也在此按 `isAppShellRoute` 条件渲染；shell 路由由 `AppShell` 自带 TitleBar。
 */
const RootLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Listen for navigation events from main process
  useEffect(() => {
    const cleanup = navigateEvents.to((_event, data) => {
      logger.debug({ msg: "Received navigate:to event", data: data });
      if (data && data.route) {
        navigate(data.route, { state: data.state });
      }
    });
    return cleanup;
  }, [navigate]);

  useEffect(() => {
    void appApi.recordCrashBreadcrumb('route-change', {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    });
  }, [location.hash, location.pathname, location.search]);

  // Hook to listen for session completion events and show toast notifications
  useSessionCompletionToast();

  const isAppShellRoute =
    location.pathname.startsWith('/agent') || location.pathname.startsWith('/settings');

  return (
    <>
      {/* 这些全局节点使用 useNavigate，必须位于路由 context 内 */}
      <McpConnectionFailureToastListener />
      <WindowZoomHotkeys />
      <McpAuthConsentDialog />
      <RequestOAuthClientIdDialog />
      <ConfirmationDialogHost />
      <div className="h-screen flex flex-col overflow-hidden">
        {!isAppShellRoute && <TitleBar />}
        <div className="flex-1 min-h-0">
          <Outlet />
        </div>
      </div>
    </>
  );
};

const routes: RouteObject[] = [
  {
    Component: RootLayout,
    children: [
      // Public Routes
      { path: '/', element: <Navigate to="/agent" replace /> },
      { path: '/login', Component: SignInPage },

      // Protected Routes
      {
        Component: AppShell,
        children: [
          {
            path: '/agent',
            Component: AgentPage,
            children: [
              { index: true, Component: ChatView },
              { path: 'creation', Component: AgentCreationView },
              { path: 'creation/custom-agent', Component: CreateCustomAgentView },
              { path: ':agentId', Component: ChatView },
              { path: ':agentId/job', element: <ChatView kind="job-run" /> },
              { path: ':agentId/job/:jobId', element: <ChatView kind="job-run" /> },
              { path: ':agentId/job/:jobId/:sessionId', element: <ChatView kind="job-run" /> },
              { path: ':agentId/:sessionId', Component: ChatView },
              { path: ':agentId/settings', Component: AgentEditingView },
              { path: ':agentId/settings/*', Component: AgentEditingView },
            ],
          },

          // Settings Routes - separate from agent
          {
            path: '/settings',
            loader: settingsEntryLoader,
            Component: SettingsPage,
            children: [
              { index: true, element: <Navigate to="tools" replace /> },
              { path: 'screenshot', Component: ScreenshotSettingsView },
              { path: 'mcp', Component: McpView },
              { path: 'mcp/new', Component: AddNewMcpServerView },
              { path: 'mcp/edit/:editServerName', Component: AddNewMcpServerView },
              { path: 'runtime', Component: RuntimeSettingsView },
              { path: 'skills', Component: SkillsView },
              { path: 'tools', Component: ToolsView },
              {
                path: 'sub-agents',
                element: (
                  <FeatureGate flag="deskmateFeatureSubAgent">
                    <SubAgentsSettingsLayout />
                  </FeatureGate>
                ),
                children: [
                  { index: true, Component: SubAgentsView },
                  { path: 'new', Component: CreateSubAgentView },
                  { path: 'edit/:subAgentName', Component: EditSubAgentView },
                ],
              },
              { path: 'about', Component: AboutAppView },
              { path: 'provider', Component: ProviderList },
              { path: 'archived-agents', Component: ArchivedAgentsView },
              { path: 'persist', Component: PersistSettingsView },
            ],
          },
        ],
      },

      // Fallback
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
