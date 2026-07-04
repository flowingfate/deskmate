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
  const loadData = useCallback(async () => {
    try {
      const sts = await runtimeApi.checkStatus();
      setStatus(sts);

      if (isGitEnabled) {
        const gitSts = await runtimeApi.checkGitVersion();
        setGitVersion(gitSts);
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
        <div className="p-6 text-content-secondary">
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
          size="icon-sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          title="Refresh runtime status"
        >
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
        </Button>
      }
    >
      <RuntimeSettingsContentView
        config={configForView}
        status={status}
        gitVersion={gitVersion}
        pythonVersions={pythonVersions}
        isLoading={isLoading}
        isPythonLoading={isPythonLoading}
        showGitVersion={isGitEnabled}
        newPythonVersion={newPythonVersion}
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
