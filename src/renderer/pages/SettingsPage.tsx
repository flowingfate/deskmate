import React from 'react';
import { Outlet } from 'react-router-dom';
import SettingsSidepanel from '@renderer/components/settings/sidepanel';
import ResizableDivider from '@/components/ui/ResizableDivider';

const SettingsPage: React.FC = () => {

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex min-h-0">
        <SettingsSidepanel />
        <ResizableDivider />
        <div className="flex-1 flex flex-col min-w-0 mr-2 mb-2 overflow-hidden rounded-lg border border-black/7 shadow-[0px_2px_6px_rgba(0,0,0,0.05)]">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
