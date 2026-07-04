import React from 'react';
import DoctorStatusIndicator from '@/components/doctor/DoctorStatusIndicator';
import DoctorInquiry from '@/components/doctor/DoctorInquiry';
import { appApi } from '@renderer/ipc/app';
import { APP_NAME } from '@shared/constants/branding';
import { useNavigate } from 'react-router-dom';

function useVersion() {
  const [v, set] = React.useState<string>('Unknown');
  React.useEffect(() => {
    appApi.getVersion().then(set);
  }, []);
  return v;
}

function Version() {
  const navigate = useNavigate();
  const [version, set] = React.useState<string>('Unknown');
  React.useEffect(() => {
    appApi.getVersion().then(set);
  }, []);

  return (
    <div className="ml-1 px-1 hover:bg-black/10 cursor-pointer" onClick={() => navigate('/settings/about')}>
      {APP_NAME.toLocaleLowerCase()}-{version}
    </div>
  );
}

export const StatusBar: React.FC = () => {
  const version = useVersion();
  return (
    <div className="h-5 shrink-0 flex items-center justify-between px-2 bg-[#f8f8f8] border-t border-black/[0.06] text-[11px] text-black/50">
      <div className="flex items-center">
        <Version />
        <div className="flex items-center gap-1">
          <DoctorStatusIndicator />
          <DoctorInquiry />
        </div>
      </div>
      <div className="flex items-center" />
    </div>
  );
};
