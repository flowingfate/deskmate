import React from 'react';
import DoctorStatusIndicator from '@/components/doctor/DoctorStatusIndicator';
import DoctorInquiry from '@/components/doctor/DoctorInquiry';
import { appApi } from '@renderer/ipc/app';

function useVersion() {
  const [v, set] = React.useState<string>('Unknown');
  React.useEffect(() => {
    appApi.getVersion().then(set);
  }, []);
  return v;
}

export const StatusBar: React.FC = () => {
  const version = useVersion();
  return (
    <div className="app-status-bar">
      <div className="app-status-bar-left">
        <div> V{version}</div>
        <div className="mx-1 flex items-center gap-1">
          <DoctorStatusIndicator />
          <DoctorInquiry />
        </div>
      </div>
      <div className="app-status-bar-right" />
    </div>
  );
};
