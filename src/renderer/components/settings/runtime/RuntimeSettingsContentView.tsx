import React from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/shadcn/select';
import { BUN_VERSIONS, UV_VERSIONS, PYTHON_VERSIONS } from '../../../lib/runtime/runtimeVersions';
import type { RuntimeEnvironment } from '../../../lib/userData/types';
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
  gitVersion: GitVersion | null;
  pythonVersions: PythonVersion[];
  isLoading: boolean;
  isPythonLoading: boolean;
  showGitVersion: boolean;
  newPythonVersion: string;
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
  gitVersion,
  pythonVersions,
  isLoading,
  isPythonLoading,
  showGitVersion,
  newPythonVersion,
  onInstall,
  onVersionChange,
  onNewPythonVersionChange,
  onInstallPython,
  onUninstallPython,
  onPinPythonVersion,
  onCleanUvCache,
}) => {
  return (
    <div className="flex flex-col p-6 bg-surface-primary h-full overflow-auto" data-dbg="runtime-settings">
      <div className="max-w-4xl mx-auto w-full transition-all duration-300 max-h-500 opacity-100 px-6 pb-6 space-y-6">
        {/* ── Card 2: App-managed Environment Components ── */}
          <div className="bg-white rounded-md p-2 border border-(--shadow-md) flex flex-col gap-2">
            {/* Card header */}
            <div className="flex items-center justify-between px-1 pb-2.5 border-b border-black/6 mb-1">
              <div className="flex-1">
                <label className="block text-content text-base font-medium">App-managed Bun &amp; uv</label>
                <p className="text-xs text-content-secondary mt-0.5 leading-normal">Bun handles npm, npx, and node. uv handles uvx and python. Both are managed by the app.</p>
              </div>
            </div>

            {/* Bun row */}
            <div className="flex items-center justify-between px-1 py-2.5">
              <div className="flex flex-col gap-0.75 flex-1">
                <span className="block text-content text-base font-normal">Bun <span className="text-xs font-normal text-content-tertiary ml-1.5">Node.js / npx</span></span>
                <span className={`text-xs leading-snug ${status.bun ? 'text-[#059669]' : 'text-status-error'}`}>
                  {status.bun ? (
                    <span title={status.bunPath}>{truncatePath(status.bunPath)}</span>
                  ) : 'Not installed'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-0.5 bg-surface-secondary border border-border rounded-md px-2 h-8">
                  <Select value={config.bunVersion} onValueChange={(v) => onVersionChange('bun', v)}>
                    <SelectTrigger className="w-16 bg-transparent border-none outline-none text-sm text-content"><SelectValue /></SelectTrigger>
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
            <div className="flex items-center justify-between px-1 py-2.5">
              <div className="flex flex-col gap-0.75 flex-1">
                <span className="block text-content text-base font-normal">uv <span className="text-xs font-normal text-content-tertiary ml-1.5">Python Manager</span></span>
                <span className={`text-xs leading-snug ${status.uv ? 'text-[#059669]' : 'text-status-error'}`}>
                  {status.uv ? (
                    <span title={status.uvPath}>{truncatePath(status.uvPath)}</span>
                  ) : 'Not installed'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-0.5 bg-surface-secondary border border-border rounded-md px-2 h-8">
                  <Select value={config.uvVersion} onValueChange={(v) => onVersionChange('uv', v)}>
                    <SelectTrigger className="w-16 bg-transparent border-none outline-none text-sm text-content"><SelectValue /></SelectTrigger>
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
              <div className="px-3 py-2.5 text-sm text-[#1f1f1f] bg-[#f5f5f5] border border-[#e0e0e0] rounded-lg mt-1">
                Installing… This may take a moment depending on your connection.
              </div>
            )}
          </div>

          {/* ── Card 3: Python Versions (only when uv is installed) ── */}
          {status.uv && (
            <div className="bg-white rounded-md p-2 border border-(--shadow-md) flex flex-col gap-2">
              {/* Card header */}
              <div className="flex items-center justify-between px-1 pb-2.5 border-b border-black/6 mb-1">
                <div className="flex-1">
                  <label className="block text-content text-base font-medium">App-managed Python</label>
                  <p className="text-xs text-content-secondary mt-0.5 leading-normal">Install a Python version and set it as the default for command-line tools and MCP servers.</p>
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
              <div className="flex items-center justify-between px-1 py-2.5 gap-2">
                <Select value={newPythonVersion} onValueChange={(v) => onNewPythonVersionChange(v)}>
                  <SelectTrigger className="flex-1 max-w-40 px-3 h-8 text-base bg-surface-secondary border border-border rounded-lg text-content"><SelectValue /></SelectTrigger>
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
                <div className="px-1 py-3 text-sm text-content-tertiary text-center">No Python versions installed</div>
              ) : (
                pythonVersions.map((py, idx) => (
                  <div key={idx} className="flex items-center justify-between px-1 py-2.5 gap-2.5">
                    <div className="flex flex-col gap-0.75 flex-1">
                      <span className="block text-content text-base font-normal">
                        {py.semver || py.version}
                        {config.pinnedPythonVersion === py.semver && (
                          <span className="text-xs font-normal text-content-tertiary ml-1.5">default</span>
                        )}
                      </span>
                      <span className={`text-xs leading-snug ${py.status === 'installed' ? 'text-[#059669]' : 'text-status-error'}`}>
                        {py.status === 'installed' && py.path ? (
                          <span title={py.path}>{truncatePath(py.path)}</span>
                        ) : 'Not installed'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
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


        <RuntimeSystemDependenciesCard
          gitVersion={gitVersion}
          showGitVersion={showGitVersion}
        />

      </div>
    </div>
  );
};

export default RuntimeSettingsContentView;
