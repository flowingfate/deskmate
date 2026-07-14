import React from 'react';
import { Outlet } from 'react-router-dom';
import ApplySubAgentToAgentsDialog from './ApplySubAgentToAgentsDialog';

const SubAgentsSettingsLayout: React.FC = () => {
  return (
    <>
      <Outlet />
      <ApplySubAgentToAgentsDialog />
    </>
  );
};

export default SubAgentsSettingsLayout;
