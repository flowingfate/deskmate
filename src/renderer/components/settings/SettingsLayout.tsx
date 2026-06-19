import React from 'react';

interface SettingsLayoutProps {
  icon: React.ReactNode;
  title: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const SettingsLayout: React.FC<SettingsLayoutProps> = ({
  icon,
  title,
  badges,
  actions,
  children,
  className,
}) => {
  className = 'flex-1 min-h-0 overflow-y-auto ' + (className || '');
  return (
    <div
      className="flex flex-col h-full"
      data-dbg="settings-layout"
    >
      <div
        className="flex justify-between items-center px-6 h-[45px] shrink-0 border-b border-black/7"
        data-dbg="settings-layout-header"
      >
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-5 h-5 shrink-0">{icon}</span>
          <span className="text-base font-semibold leading-[22px] text-black">{title}</span>
          {badges && <div className="flex items-center gap-1.5 flex-wrap">{badges}</div>}
        </div>
        {actions && <div className="flex items-center shrink-0">{actions}</div>}
      </div>
      <div className={className} data-dbg="settings-layout-content">
        {children}
      </div>
    </div>
  );
};

export default SettingsLayout;
