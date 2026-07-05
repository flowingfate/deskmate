import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './sidebar';
import { StatusBar } from './statusbar';
import { TitleBar } from './titlebar';

export const AppShell: React.FC = () => {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <TitleBar />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>

      <StatusBar />
    </div>
  );
};
