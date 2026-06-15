import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { SignInPage } from '../pages/SignInPage';
import { AgentPage } from '../pages/AgentPage';
import SettingsPage from '../pages/SettingsPage';

import ChatView from '../components/chat/ChatView';
import McpView from '../components/mcp/McpView';
import ToolsView from '../components/tools/ToolsView';
import AddNewMcpServerView from '../components/mcp/AddNewMcpServerView';
import ImportMcpServerView from '../components/mcp/ImportMcpServerView';
import SkillsView from '../components/skills/SkillsView';
import SubAgentsView from '../components/subAgents/SubAgentsView';
import CreateSubAgentView from '../components/subAgents/CreateSubAgentView';
import EditSubAgentView from '../components/subAgents/EditSubAgentView';
import RuntimeSettingsView from '../components/settings/runtime/RuntimeSettingsView';
import ToolbarSettingsView from '../components/settings/toolbar/ToolbarSettingsView';
import { navigateEvents } from '@/ipc/navigate';
import ScreenshotSettingsView from '../components/settings/screenshot/ScreenshotSettingsView';
import AboutAppView from '../components/settings/about/AboutAppView';
import ArchivedAgentsView from '../components/settings/ArchivedAgentsView';
import ProviderList from '../components/settings/auth/ProviderList';
import AgentEditingView from '../components/chat/agent-area/AgentEditingView';
import AgentCreationView from '../components/chat/agent-area/AgentCreationView';
import CreateCustomAgentView from '../components/chat/agent-area/CreateCustomAgentView';
import { useFeatureFlag } from '../lib/featureFlags';
import { log } from '@/log';
import { appApi } from '@/ipc/app';
import { AppShell } from '@renderer/pages/layout/AppShell';

const logger = log.child({ mod: 'AppRoutes' });

export const AppRoutes: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Sub-Agent route (controlled by feature flag)
  const subAgentEnabled = useFeatureFlag('deskmateFeatureSubAgent');

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

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/" element={<Navigate to="/agent" replace />} />
      <Route path="/login" element={<SignInPage />} />

      {/* Protected Routes */}
      <Route element={<AppShell />}>
        <Route path="/agent" element={<AgentPage />}>
          <Route index element={<ChatView />} />
          <Route path="creation" element={<AgentCreationView />} />
          <Route path="creation/custom-agent" element={<CreateCustomAgentView />} />
          <Route path=":agentId" element={<ChatView />} />
          <Route path=":agentId/job" element={<ChatView kind="job-run" />} />
          <Route path=":agentId/job/:jobId" element={<ChatView kind="job-run" />} />
          <Route path=":agentId/job/:jobId/:sessionId" element={<ChatView kind="job-run" />} />
          <Route path=":agentId/:sessionId" element={<ChatView />} />
          <Route path=":agentId/settings" element={<AgentEditingView />} />
          <Route path=":agentId/settings/*" element={<AgentEditingView />} />
        </Route>

        {/* Settings Routes - separate from agent */}
        <Route path="/settings" element={<SettingsPage />}>
          <Route index element={<Navigate to="mcp" replace />} />
          <Route path="toolbar" element={<ToolbarSettingsView />} />
          <Route path="screenshot" element={<ScreenshotSettingsView />} />
          <Route path="mcp" element={<McpView />} />
          <Route path="mcp/new" element={<AddNewMcpServerView />} />
          <Route path="mcp/edit/:editServerName" element={<AddNewMcpServerView />} />
          <Route path="mcp/import-config" element={<ImportMcpServerView />} />
          <Route path="runtime" element={<RuntimeSettingsView />} />
          <Route path="skills" element={<SkillsView />} />
          <Route path="tools" element={<ToolsView />} />
          {subAgentEnabled && (
            <>
              <Route path="sub-agents" element={<SubAgentsView />} />
              <Route path="sub-agents/new" element={<CreateSubAgentView />} />
              <Route path="sub-agents/edit/:subAgentName" element={<EditSubAgentView />} />
            </>
          )}
          <Route path="about" element={<AboutAppView />} />
          <Route path="provider" element={<ProviderList />} />
          <Route path="archived-agents" element={<ArchivedAgentsView />} />
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
