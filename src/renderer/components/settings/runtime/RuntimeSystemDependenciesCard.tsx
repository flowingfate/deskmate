import React from 'react';
import type { GitVersion } from './RuntimeSettingsContentView';

interface RuntimeSystemDependenciesCardProps {
  gitVersion: GitVersion | null;
}

const RuntimeSystemDependenciesCard: React.FC<RuntimeSystemDependenciesCardProps> = ({ gitVersion }) => {
  return (
    <div className="bg-white rounded-md p-2 border border-(--shadow-md) flex flex-col gap-2">
      <div className="flex items-center justify-between px-1 pb-2.5 border-b border-black/6 mb-1">
        <div className="flex-1">
          <label className="block text-(--text-primary) text-base font-medium">System Dependencies</label>
          <p className="text-xs text-(--text-secondary) mt-0.5 leading-normal">System-wide tools used by command-line workflows.</p>
        </div>
      </div>

      <div className="flex items-center justify-between px-1 py-2.5">
        <div className="flex flex-col gap-0.75 flex-1">
          <span className="block text-(--text-primary) text-base font-normal">Git <span className="text-xs font-normal text-(--text-tertiary) ml-1.5">VCS</span></span>
          <span className={`text-xs leading-snug ${gitVersion?.installed ? 'text-[#059669]' : 'text-(--status-error)'}`}>
            {gitVersion?.installed
              ? <span title={gitVersion.path ?? undefined}>{gitVersion.version ? `v${gitVersion.version}` : 'Installed'}</span>
              : 'Not installed'}
          </span>
        </div>
      </div>

      {!gitVersion?.installed && (
        <div className="text-sm text-(--text-tertiary) text-center p-3 bg-amber-400/10 rounded-md mt-2">
          Install Git for your platform to enable Git-backed workflows.
        </div>
      )}
    </div>
  );
};

export default RuntimeSystemDependenciesCard;
