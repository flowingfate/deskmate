import React from 'react';
import { SidebarTop } from './SidebarTop';
import { SidebarBottom } from './SidebarBottom';
import './sidebar.scss';

export const Sidebar: React.FC = () => {
  return (
    <nav className="app-sidebar" role="navigation" aria-label="Main sidebar">
      <SidebarTop />
      <SidebarBottom />
    </nav>
  );
};
