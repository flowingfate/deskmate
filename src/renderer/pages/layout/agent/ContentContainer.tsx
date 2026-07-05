import React, { memo } from 'react';
import { Outlet } from 'react-router-dom';
import { AgentContextType } from '@/types/agentContextTypes';

interface ContentContainerProps {
  sidebarVisible?: boolean;
}

const ContentContainer: React.FC<ContentContainerProps> = () => {
  const agentContext: AgentContextType = {};

  return (
    <main className="flex-1 flex flex-col overflow-hidden relative pl-0.5" role="main" aria-live="polite">
      <Outlet context={agentContext} />
    </main>
  );
};

export default memo(ContentContainer);
