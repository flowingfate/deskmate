import React from 'react';
import type { GitVersion } from './RuntimeSettingsContentView';

interface RuntimeSystemDependenciesCardProps {
  gitVersion: GitVersion | null;
  showGitVersion: boolean;
}

const RuntimeSystemDependenciesCard: React.FC<RuntimeSystemDependenciesCardProps> = ({
  gitVersion,
  showGitVersion,
}) => {
  if (!showGitVersion) {
    return null;
  }
  return (
    <div className="toolbar-settings-card">
      <div className="toolbar-setting-item" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}>
        <div className="setting-label-container">
          <label className="setting-label" style={{ fontWeight: 500 }}>System Dependencies</label>
          <p className="runtime-card-desc">System-wide tools used by command-line workflows.</p>
        </div>
      </div>

      <div className="runtime-component-row toolbar-setting-item">
        <div className="runtime-component-meta">
          <span className="setting-label">Git <span className="runtime-component-tag">VCS</span></span>
          <span className={`runtime-status-dot ${gitVersion?.installed ? 'runtime-status-dot--ok' : 'runtime-status-dot--off'}`}>
            {gitVersion?.installed
              ? <span title={gitVersion.path ?? undefined}>{gitVersion.version ? `v${gitVersion.version}` : 'Installed'}</span>
              : 'Not installed'}
          </span>
        </div>
      </div>

      {!gitVersion?.installed && (
        <div className="runtime-empty-hint" style={{ padding: '12px', backgroundColor: 'rgba(251, 191, 36, 0.1)', borderRadius: '6px', marginTop: '8px' }}>
          Install Git for your platform to enable Git-backed workflows.
        </div>
      )}
    </div>
  );
};

export default RuntimeSystemDependenciesCard;
