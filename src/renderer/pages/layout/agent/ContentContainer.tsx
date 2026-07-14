import React, { memo } from 'react';
import { Outlet } from 'react-router-dom';


const ContentContainer: React.FC = () => {

  return (
    <main className="flex-1 flex flex-col overflow-hidden relative pl-0.5" role="main" aria-live="polite">
      <Outlet />
    </main>
  );
};

export default memo(ContentContainer);
