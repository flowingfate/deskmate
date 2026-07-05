import React from 'react';
import { SidebarTop } from './SidebarTop';
import { SidebarBottom } from './SidebarBottom';

export const Sidebar: React.FC = () => {
  return (
    <nav className="relative flex flex-col w-10.5 shrink-0 py-1 after:content-[''] after:absolute after:top-0 after:right-0 after:w-px after:h-full after:bg-linear-to-b after:from-transparent after:to-black/6 after:pointer-events-none" role="navigation" aria-label="Main sidebar">
      <SidebarTop />
      <SidebarBottom />
    </nav>
  );
};
