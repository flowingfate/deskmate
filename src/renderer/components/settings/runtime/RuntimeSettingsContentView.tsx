import React from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/shadcn/select';
import { BUN_VERSIONS, UV_VERSIONS, PYTHON_VERSIONS } from '../../../lib/runtime/runtimeVersions';
import type { RuntimeEnvironment } from '../../../lib/userData/types';
import type { SystemRuntimeStatus } from '@shared/types/runtimeTypes';
import RuntimeSystemDependenciesCard from './RuntimeSystemDependenciesCard';

export interface RuntimeStatus {
  bun: boolean;
  uv: boolean;
  bunPath: string;
  uvPath: string;
}

export interface GitVersion {
  installed: boolean;
  version: string | null;
  path: string | null;
}

export interface PythonVersion {
  version: string;
  semver?: string;
  path: string | null;
  status: 'installed' | 'available';
}

interface RuntimeSettingsContentViewProps {
  config: RuntimeEnvironment;
  status: RuntimeStatus;
  systemStatus: SystemRuntimeStatus | null;
  gitVersion: GitVersion | null;
  pythonVersions: PythonVersion[];
  isLoading: boolean;
  isPythonLoading: boolean;
  showGitVersion: boolean;
  newPythonVersion: string;
  onModeChange: (mode: 'system' | 'internal') => Promise<void>;
  onInstall: (tool: 'bun' | 'uv') => Promise<void>;
  onVersionChange: (tool: 'bun' | 'uv', value: string) => void;
  onNewPythonVersionChange: (value: string) => void;
  onInstallPython: () => Promise<void>;
  onUninstallPython: (version: string) => Promise<void>;
  onPinPythonVersion: (version: string) => Promise<void>;
  onCleanUvCache: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

/** Truncate a long path, keeping the last N segments visible */
function truncatePath(path: string | null, maxLen = 48): string {
  if (!path) return '-';
  if (path.length <= maxLen) return path;
  const sep = path.includes('/') ? '/' : '\\';
  const parts = path.split(sep);
  let result = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = parts[i] + sep + result;
    if (('…' + sep + next).length > maxLen) break;
    result = next;
  }
  return '…' + sep + result;
}

const RuntimeSettingsContentView: React.FC<RuntimeSettingsContentViewProps> = ({
  config,
  status,
  systemStatus,
  gitVersion,
  pythonVersions,
  isLoading,
  isPythonLoading,
  showGitVersion,
  newPythonVersion,
  onModeChange,
  onInstall,
  onVersionChange,
  onNewPythonVersionChange,
  onInstallPython,
  onUninstallPython,
  onPinPythonVersion,
  onCleanUvCache,
}) => {
  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">

            {/* ── Card 1: Runtime Mode ── */}
            <div className="toolbar-settings-card">
              {/* Card header row */}
              <div className="toolbar-setting-item" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}>
                <div className="setting-label-container">
                  <label className="setting-label" style={{ fontWeight: 500 }}>Runtime Mode</label>
                  <p className="runtime-card-desc">
                    Select the runtime environment for command-line tools and MCP servers.
                  </p>
                </div>
              </div>

              {/* System option */}
              <label
                className={`runtime-mode-row toolbar-setting-item ${config.mode === 'system' ? 'runtime-mode-row--active' : ''}`}
                onClick={() => onModeChange('system')}
              >
                <div className="setting-label-container">
                  <span className="setting-label">Use User System Environment</span>
                  <span className="runtime-card-desc">Uses commands from your system PATH. Not all required commands may be available — you are responsible for managing your environment and ensuring the necessary commands are accessible.</span>
                </div>
                <input
                  type="radio"
                  name="runtimeMode"
                  checked={config.mode === 'system'}
                  onChange={() => onModeChange('system')}
                  className="runtime-radio"
                />
              </label>

              {/* Internal option */}
              <label
                className={`runtime-mode-row toolbar-setting-item ${config.mode === 'internal' ? 'runtime-mode-row--active' : ''}`}
                onClick={() => onModeChange('internal')}
              >
                <div className="setting-label-container">
                  <span className="setting-label">Use App-managed Environment</span>
                  <span className="runtime-card-desc">Uses the app-managed runtime with bun (npm, npx, node) and uv (uvx, python) pre-installed — works out of the box, no setup required.</span>
                </div>
                <input
                  type="radio"
                  name="runtimeMode"
                  checked={config.mode === 'internal'}
                  onChange={() => onModeChange('internal')}
                  className="runtime-radio"
                />
              </label>
            </div>

            {config.mode === 'system' && (
              <div className="toolbar-settings-card">
                <div className="toolbar-setting-item" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}>
                  <div className="setting-label-container">
                    <label className="setting-label" style={{ fontWeight: 500 }}>System Runtimes Detected on PATH</label>
                    <p className="runtime-card-desc">
                      The app will invoke whatever your shell PATH resolves these to. Missing or version-mismatched
                      tools may break specific MCP servers.
                    </p>
                  </div>
                </div>
                {systemStatus === null ? (
                  <div className="toolbar-setting-item" style={{ paddingTop: '8px' }}>
                    <span className="runtime-card-desc">Probing system PATH…</span>
                  </div>
                ) : (
                  (['node', 'npm', 'python', 'pip', 'uv'] as const).map((cmd) => {
                    const probe = systemStatus[cmd];
                    return (
                      <div key={cmd} className="runtime-component-row toolbar-setting-item">
                        <div className="runtime-component-meta">
                          <span className="setting-label">{cmd}</span>
                          <span className={`runtime-status-dot ${probe.installed ? 'runtime-status-dot--ok' : 'runtime-status-dot--off'}`}>
                            {probe.installed
                              ? <span title={probe.path ?? undefined}>{probe.version ?? 'installed'}{probe.path ? ` · ${truncatePath(probe.path)}` : ''}</span>
                              : 'Not found on PATH'}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {config.mode === 'internal' && (<>
            {/* ── Card 2: Environment Components ── */}
            <div className="toolbar-settings-card">
              {/* Card header */}
              <div className="toolbar-setting-item" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}>
                <div className="setting-label-container">
                  <label className="setting-label" style={{ fontWeight: 500 }}>App-managed Bun &amp; uv</label>
                  <p className="runtime-card-desc">Bun handles npm, npx, and node. uv handles uvx and python. Both are managed by the app.</p>
                </div>
              </div>

              {/* Bun row */}
              <div className="runtime-component-row toolbar-setting-item">
                <div className="runtime-component-meta">
                  <span className="setting-label">Bun <span className="runtime-component-tag">Node.js / npx</span></span>
                  <span className={`runtime-status-dot ${status.bun ? 'runtime-status-dot--ok' : 'runtime-status-dot--off'}`}>
                    {status.bun ? (
                      <span title={status.bunPath}>{truncatePath(status.bunPath)}</span>
                    ) : 'Not installed'}
                  </span>
                </div>
                <div className="runtime-component-actions">
                  <div className="runtime-version-field">
                    <Select value={config.bunVersion} onValueChange={(v) => onVersionChange('bun', v)}>
                      <SelectTrigger className="runtime-version-input-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {BUN_VERSIONS.map((entry) => (
                          <SelectItem key={entry.version} value={entry.version}>{entry.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={isLoading}
                    onClick={() => onInstall('bun')}
                  >
                    {status.bun ? 'Update' : 'Install'}
                  </Button>
                </div>
              </div>

              {/* uv row */}
              <div className="runtime-component-row toolbar-setting-item">
                <div className="runtime-component-meta">
                  <span className="setting-label">uv <span className="runtime-component-tag">Python Manager</span></span>
                  <span className={`runtime-status-dot ${status.uv ? 'runtime-status-dot--ok' : 'runtime-status-dot--off'}`}>
                    {status.uv ? (
                      <span title={status.uvPath}>{truncatePath(status.uvPath)}</span>
                    ) : 'Not installed'}
                  </span>
                </div>
                <div className="runtime-component-actions">
                  <div className="runtime-version-field">
                    <Select value={config.uvVersion} onValueChange={(v) => onVersionChange('uv', v)}>
                      <SelectTrigger className="runtime-version-input-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UV_VERSIONS.map((entry) => (
                          <SelectItem key={entry.version} value={entry.version}>{entry.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={isLoading}
                    onClick={() => onInstall('uv')}
                  >
                    {status.uv ? 'Update' : 'Install'}
                  </Button>
                </div>
              </div>

              {/* Loading indicator */}
              {isLoading && (
                <div className="runtime-loading-bar">
                  Installing… This may take a moment depending on your connection.
                </div>
              )}
            </div>

            {/* ── Card 3: Python Versions (only when uv is installed) ── */}
            {status.uv && (
              <div className="toolbar-settings-card">
                {/* Card header */}
                <div className="toolbar-setting-item" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}>
                  <div className="setting-label-container">
                    <label className="setting-label" style={{ fontWeight: 500 }}>App-managed Python</label>
                    <p className="runtime-card-desc">Install a Python version and set it as the default for command-line tools and MCP servers.</p>
                  </div>
                  {process.env.NODE_ENV === 'development' && (
                    <Button
                      variant="link"
                      size="sm"
                      onClick={onCleanUvCache}
                      disabled={isLoading}
                    >
                      Clean Cache
                    </Button>
                  )}
                </div>

                {/* Install Python row */}
                <div className="toolbar-setting-item" style={{ gap: '8px' }}>
                  <Select value={newPythonVersion} onValueChange={(v) => onNewPythonVersionChange(v)}>
                    <SelectTrigger className="runtime-python-input"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PYTHON_VERSIONS.map((entry) => (
                        <SelectItem key={entry.version} value={entry.version}>{entry.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={isPythonLoading}
                    onClick={onInstallPython}
                  >
                    {isPythonLoading ? 'Installing…' : 'Install Python'}
                  </Button>
                </div>

                {/* Installed Python list */}
                {pythonVersions.length === 0 ? (
                  <div className="runtime-empty-hint">No Python versions installed</div>
                ) : (
                  pythonVersions.map((py, idx) => (
                    <div key={idx} className="runtime-python-row toolbar-setting-item">
                      <div className="runtime-component-meta">
                        <span className="setting-label">
                          {py.semver || py.version}
                          {config.pinnedPythonVersion === py.semver && (
                            <span className="runtime-component-tag" style={{ marginLeft: '6px' }}>default</span>
                          )}
                        </span>
                        <span className={`runtime-status-dot ${py.status === 'installed' ? 'runtime-status-dot--ok' : 'runtime-status-dot--off'}`}>
                          {py.status === 'installed' && py.path ? (
                            <span title={py.path}>{truncatePath(py.path)}</span>
                          ) : 'Not installed'}
                        </span>
                      </div>

                      <div className="runtime-component-actions">
                        {/* Pin/Set Default */}
                        {py.status === 'installed' && config.pinnedPythonVersion !== py.semver && (
                          <Button
                            onClick={() => onPinPythonVersion(py.semver || py.version)}
                            variant="ghost"
                            size="sm"
                            disabled={isPythonLoading}
                          >
                            Set Default
                          </Button>
                        )}

                        {/* Uninstall */}
                        {py.status === 'installed' && (
                          <Button
                            onClick={() => onUninstallPython(py.version)}
                            variant="ghost"
                            size="icon"
                            disabled={isPythonLoading}
                            title="Uninstall"
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
            </>)}

            <RuntimeSystemDependenciesCard
              gitVersion={gitVersion}
              showGitVersion={showGitVersion}
            />

          </div>
        </div>
      </div>
    </div>
  );
};

export default RuntimeSettingsContentView;
