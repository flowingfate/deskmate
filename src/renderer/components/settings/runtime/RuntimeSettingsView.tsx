'use client'

import React, { useEffect, useState, useCallback } from 'react';
import { Terminal, RefreshCw } from 'lucide-react';
import { Badge } from '@/shadcn/badge';
import { Button } from '@/shadcn/button';
import { useToast } from '../../ui/ToastProvider';
import SettingsLayout from '../SettingsLayout';
import RuntimeSettingsContentView, { RuntimeStatus, GitVersion, PythonVersion } from './RuntimeSettingsContentView';
import { DEFAULT_PYTHON_VERSION } from '../../../lib/runtime/runtimeVersions';
import { appDataManager } from '../../../lib/userData/appDataManager';
import { useFeatureFlag } from '../../../lib/featureFlags';
import type { RuntimeEnvironment } from '../../../lib/userData/types';
import type { SystemRuntimeStatus } from '@shared/types/runtimeTypes';
import { runtimeApi } from '@/ipc/runtime';
import { log } from '@/log';
const logger = log.child({ mod: 'RuntimeSettingsView' });

const RuntimeSettingsView: React.FC = () => {
  const [runtimeEnv, setRuntimeEnv] = useState<RuntimeEnvironment | null>(null);
  // Independent install version draft state to avoid AppDataManager push interrupting user input fields
  const [installVersions, setInstallVersions] = useState({ bun: '', uv: '' });
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [gitVersion, setGitVersion] = useState<GitVersion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pythonVersions, setPythonVersions] = useState<PythonVersion[]>([]);
  const [newPythonVersion, setNewPythonVersion] = useState<string>(DEFAULT_PYTHON_VERSION);
  const [isPythonLoading, setIsPythonLoading] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemRuntimeStatus | null>(null);
  const { showSuccess, showError } = useToast();
  const isGitEnabled = useFeatureFlag('deskmateUseGit');

  // Subscribe to AppDataManager, receive runtimeEnvironment changes in real time
  useEffect(() => {
    // Read current cache directly (appDataManager initialized by backend push, no manual pull needed)
    const rt = appDataManager.getRuntimeEnvironment();
    if (rt) {
      setRuntimeEnv(rt);
      setInstallVersions({ bun: rt.bunVersion, uv: rt.uvVersion });
    }

    const unsub = appDataManager.subscribe((cfg) => {
      const rt = cfg.runtimeEnvironment;
      if (rt) {
        setRuntimeEnv(rt);
        // Sync version number (server pushes new version after installation completes)
        setInstallVersions({ bun: rt.bunVersion, uv: rt.uvVersion });
      }
    });

    return unsub;
  }, []);

  const loadPythonVersions = useCallback(async () => {
    try {
      const versions = await runtimeApi.listPythonVersions();
      setPythonVersions(versions);
    } catch (e) {
      logger.error({ msg: String(e) });
    }
  }, []);

  // loadData only loads status and python version list (these don't go through AppDataManager).
  // System PATH probe is gated by mode: spawning ~10 system commands in internal mode would
  // add hundreds of ms to the panel-mount with nothing to show for it (the system card is
  // hidden). Pass `modeOverride` from `handleModeChange` so the post-switch refresh uses the
  // newly-selected mode instead of the stale React state.
  const loadData = useCallback(async (modeOverride?: 'system' | 'internal') => {
    try {
      const sts = await runtimeApi.checkStatus();
      setStatus(sts);

      const effectiveMode = modeOverride ?? appDataManager.getRuntimeEnvironment()?.mode ?? 'internal';

      if (isGitEnabled) {
        const gitSts = await runtimeApi.checkGitVersion();
        setGitVersion(gitSts);
      }

      if (effectiveMode === 'system') {
        const sysSts = await runtimeApi.checkSystemStatus();
        setSystemStatus(sysSts);
      } else {
        // No card to render in internal mode — clear so a later switch starts fresh.
        setSystemStatus(null);
      }

      if (sts.uv) {
        loadPythonVersions();
      }
    } catch (e) {
      logger.error({ msg: String(e) });
    }
  }, [loadPythonVersions, isGitEnabled]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadData();
      showSuccess('Runtime status refreshed');
    } catch (e) {
      showError('Failed to refresh runtime status');
    } finally {
      setIsRefreshing(false);
    }
  }, [loadData, showSuccess, showError]);

  const handleModeChange = useCallback(async (mode: 'system' | 'internal') => {
    if (runtimeEnv?.mode === mode) return;
    if (mode === 'system') {
      const ok = window.confirm(
        'Switch to "Use User System Environment"?\n\n'
        + 'The app will stop managing Node.js / Python and rely on whatever is on your PATH.\n'
        + 'Some MCP servers may fail to start if their required versions are missing or '
        + 'incompatible. You can switch back at any time.'
      );
      if (!ok) return;
    }
    try {
      await runtimeApi.setMode(mode);
      // AppCacheManager will push update → AppDataManager → setRuntimeEnv auto-refresh.
      // Re-detect now so the new mode's status (system PATH probes / internal bin) is
      // fresh in the view; pass the new mode explicitly because React state hasn't caught up yet.
      await loadData(mode);
      showSuccess(`Switched to ${mode} mode`);
    } catch (e) {
      showError('Failed to switch mode');
    }
  }, [runtimeEnv?.mode, loadData, showSuccess, showError]);

  const handleInstall = useCallback(async (tool: 'bun' | 'uv') => {
    setIsLoading(true);
    try {
      const version = installVersions[tool];
      await runtimeApi.installComponent(tool, version);
      showSuccess(`Installed ${tool} v${version}`);
      await loadData();
    } catch (e: any) {
      showError(`Failed to install ${tool}: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [installVersions, loadData, showSuccess, showError]);

  const handleVersionChange = useCallback((tool: 'bun' | 'uv', value: string) => {
    setInstallVersions(prev => ({ ...prev, [tool]: value }));
  }, []);

  const handleInstallPython = useCallback(async () => {
    if (!newPythonVersion) return;
    setIsPythonLoading(true);
    try {
      await runtimeApi.installPythonVersion(newPythonVersion);
      showSuccess(`Python ${newPythonVersion} installed successfully`);
      await loadPythonVersions();
    } catch (e: any) {
      showError(`Failed to install Python ${newPythonVersion}: ${e.message}`);
    } finally {
      setIsPythonLoading(false);
    }
  }, [newPythonVersion, loadPythonVersions, showSuccess, showError]);

  const handleUninstallPython = useCallback(async (version: string) => {
    if (!confirm(`Are you sure you want to uninstall Python ${version}?`)) return;
    setIsPythonLoading(true);
    try {
      await runtimeApi.uninstallPythonVersion(version);
      showSuccess(`Uninstalled Python ${version}`);
      // pinnedPythonVersion is auto-updated via AppCacheManager → AppDataManager push, no manual setConfig needed
      await loadPythonVersions();
    } catch (e: any) {
      showError(`Failed to uninstall: ${e.message}`);
    } finally {
      setIsPythonLoading(false);
    }
  }, [loadPythonVersions, showSuccess, showError]);

  const handlePinPythonVersion = useCallback(async (version: string) => {
    try {
      await runtimeApi.setPinnedPythonVersion(version);
      // AppCacheManager will push update → AppDataManager → setRuntimeEnv auto-refresh
      showSuccess(`Pinned Python ${version}`);
    } catch {
      showError('Failed to pin version');
    }
  }, [showSuccess, showError]);

  const handleCleanUvCache = useCallback(async () => {
    setIsLoading(true);
    try {
      await runtimeApi.cleanUvCache();
      showSuccess('uv cache cleaned');
    } catch (e) {
      showError('Failed to clean uv cache');
    } finally {
      setIsLoading(false);
    }
  }, [showSuccess, showError]);

  // Merge AppDataManager runtimeEnv with installVersions draft for the view config
  const configForView = runtimeEnv
    ? { ...runtimeEnv, bunVersion: installVersions.bun, uvVersion: installVersions.uv }
    : null;

  if (!configForView || !status) {
    return (
      <SettingsLayout icon={<Terminal size={18} />} title="Runtime Environment">
        <div className="runtime-settings-loading">
          Loading runtime status...
        </div>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout
      icon={<Terminal size={18} />}
      title="Runtime Environment"
      badges={
        <>
          <Badge variant="secondary" className="text-xs">mode: {configForView.mode}</Badge>
          <Badge variant={status.bun ? "default" : "secondary"} className="text-xs">
            bun: {status.bun ? 'installed' : 'not installed'}
          </Badge>
          <Badge variant={status.uv ? "default" : "secondary"} className="text-xs">
            uv: {status.uv ? 'installed' : 'not installed'}
          </Badge>
        </>
      }
      actions={
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          disabled={isRefreshing}
          title="Refresh runtime status"
        >
          <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
        </Button>
      }
    >
      <RuntimeSettingsContentView
        config={configForView}
        status={status}
        systemStatus={systemStatus}
        gitVersion={gitVersion}
        pythonVersions={pythonVersions}
        isLoading={isLoading}
        isPythonLoading={isPythonLoading}
        showGitVersion={isGitEnabled}
        newPythonVersion={newPythonVersion}
        onModeChange={handleModeChange}
        onInstall={handleInstall}
        onVersionChange={handleVersionChange}
        onNewPythonVersionChange={setNewPythonVersion}
        onInstallPython={handleInstallPython}
        onUninstallPython={handleUninstallPython}
        onPinPythonVersion={handlePinPythonVersion}
        onCleanUvCache={handleCleanUvCache}
        onRefresh={loadData}
      />
    </SettingsLayout>
  );
};

export default RuntimeSettingsView;
