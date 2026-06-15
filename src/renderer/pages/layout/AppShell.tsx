import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './sidebar';
import { StatusBar } from './statusbar';
import { TitleBar } from './titlebar';

export const AppShell: React.FC = () => {
  return (
    <div className="app-shell">
      <TitleBar />

      <div className="app-shell-body">
        <Sidebar />
        <div className="app-shell-content">
          <Outlet />
        </div>
      </div>

      <StatusBar />
    </div>
  );
};
