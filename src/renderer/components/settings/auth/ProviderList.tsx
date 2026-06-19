/**
 * Provider 列表 — OAuth 与 API Key 分区展示。
 *
 * OAuth 区：已连接账号 + 可用 provider 按钮（点击启动 device-code 流程）。
 * API Key 区：已连接账号 + 内联录入表单（provider 选择 + baseUrl + apiKey）。
 * 不再使用 AddProviderDialog，所有操作平铺在页面中。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CircleCheck, CircleDashed, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { Badge } from '@/shadcn/badge';
import SettingsLayout from '../SettingsLayout';
import { useToast } from '../../ui/ToastProvider';
import { piApi } from '@/ipc/pi';
import type { ProviderAccountSummary } from '@shared/types/piAuthTypes';
import { PROVIDER_REGISTRY, getProviderDescriptor, type ProviderDescriptor } from './providerRegistry';
import DeviceCodeDialog from './DeviceCodeDialog';
import ApiKeyForm from './ApiKeyForm';
import { useAuthSession } from './useAuthSession';
import { log } from '@/log';

const logger = log.child({ mod: 'ProviderList' });

const ProviderList: React.FC = () => {
  const [accounts, setAccounts] = useState<ProviderAccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const auth = useAuthSession();
  const { showSuccess, showError } = useToast();

  const reload = useCallback(async () => {
    try {
      const res = await piApi.listAccounts();
      if (!res.success) {
        showError(res.error);
        return;
      }
      setAccounts(res.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 登录成功 → 刷新 + 显示 toast
  useEffect(() => {
    if (auth.stage.type === 'done' && auth.stage.success) {
      const p = auth.provider ? getProviderDescriptor(auth.provider) : null;
      showSuccess(`Connected to ${p?.name ?? auth.provider}`);
      void reload();
    }
  }, [auth.stage, auth.provider, reload, showSuccess]);

  const connectedIds = new Set(accounts.map((a) => a.provider));

  // ── OAuth ──
  const oauthAccounts = accounts.filter((a) => a.type === 'oauth');
  const oauthProviders = PROVIDER_REGISTRY.filter((p) => p.auth === 'oauth');

  // ── API Key ──
  const apiKeyAccounts = accounts.filter((a) => a.type === 'apiKey');
  const availableApiKey = PROVIDER_REGISTRY.filter((p) => p.auth === 'apiKey' && !connectedIds.has(p.id));

  const handleOAuthLogin = (providerId: string) => {
    auth.start(providerId).catch((err) => {
      logger.error({ msg: 'startLogin threw', err: String(err) });
      showError(err instanceof Error ? err.message : String(err));
    });
  };

  const handleLogout = async (providerId: string) => {
    const res = await piApi.logout(providerId);
    if (!res.success) {
      showError(res.error);
      return;
    }
    showSuccess('Signed out');
    await reload();
  };

  const oauthDialogOpen =
    auth.stage.type !== 'idle' &&
    !(auth.stage.type === 'done' && auth.stage.success);

  const oauthProviderName = auth.provider
    ? getProviderDescriptor(auth.provider)?.name ?? auth.provider
    : '';

  return (
    <SettingsLayout icon={<ShieldCheck size={18} />} title="Provider">
      <div className="px-6 py-4 flex flex-col gap-6">
        {/* ── OAuth 区 ── */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-gray-700">OAuth Accounts</h3>
          <AccountList
            providers={oauthProviders}
            connectedIds={connectedIds}
            accounts={oauthAccounts}
            onLogin={handleOAuthLogin}
            onLogout={handleLogout}
          />
        </section>

        {/* ── API Key 区 ── */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-gray-700">API Key Providers</h3>

          {/* 已连接 */}
          {apiKeyAccounts.length > 0 && (
            <AccountList
              providers={PROVIDER_REGISTRY.filter((p) => p.auth === 'apiKey' && connectedIds.has(p.id))}
              connectedIds={connectedIds}
              accounts={apiKeyAccounts}
              onLogout={handleLogout}
            />
          )}

          {/* 内联添加表单（点击按钮展开） */}
          {availableApiKey.length > 0 && !showApiKeyForm && (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setShowApiKeyForm(true)}
            >
              <Plus size={14} className="mr-1.5" />
              Add API Key
            </Button>
          )}
          {availableApiKey.length > 0 && showApiKeyForm && (
            <ApiKeyForm
              providers={availableApiKey}
              onSaved={() => { setShowApiKeyForm(false); void reload(); }}
              onCancel={() => setShowApiKeyForm(false)}
            />
          )}
        </section>

        {loading && <div className="text-sm text-gray-500">Loading...</div>}
      </div>

      <DeviceCodeDialog
        open={oauthDialogOpen}
        providerName={oauthProviderName}
        stage={auth.stage}
        progressMessage={auth.progressMessage}
        onClose={() => {
          if (auth.stage.type === 'done') {
            auth.reset();
          } else {
            void auth.cancel();
          }
        }}
        onSubmitPrompt={(v) => {
          void auth.submitPrompt(v);
        }}
      />
    </SettingsLayout>
  );
};

// ── 共用的账号列表行 ──

interface AccountListProps {
  providers: ProviderDescriptor[];
  connectedIds: Set<string>;
  accounts: ProviderAccountSummary[];
  onLogin?: (providerId: string) => void;
  onLogout: (providerId: string) => void;
}

const AccountList: React.FC<AccountListProps> = ({ providers, connectedIds, accounts, onLogin, onLogout }) => {
  const accountMap = new Map(accounts.map((a) => [a.provider, a]));

  return (
    <div className="flex flex-col divide-y border rounded-md border-black/7">
      {providers.map((p) => {
        const connected = connectedIds.has(p.id);
        const account = accountMap.get(p.id);
        return (
          <div
            key={p.id}
            className="flex items-center justify-between px-4 py-3 border-black/7"
          >
            <div className={`flex items-center gap-3 ${connected ? '' : 'opacity-60'}`}>
              {connected
                ? <CircleCheck size={16} className="text-green-500 shrink-0" />
                : <CircleDashed size={16} className="text-gray-400 shrink-0" />
              }
              <div className="flex flex-col">
                <span className="text-sm font-medium">{p.name}</span>
                {account?.baseUrl ? (
                  <span className="text-xs text-gray-500">{account.baseUrl}</span>
                ) : (
                  <span className="text-xs text-gray-500">{p.id}</span>
                )}
              </div>
              {connected && (
                <Badge variant="secondary" className="text-xs">
                  {account?.type === 'oauth' ? 'OAuth' : 'API Key'}
                </Badge>
              )}
            </div>
            {connected ? (
              <Button size="sm" variant="ghost" onClick={() => onLogout(p.id)}>
                Sign out
              </Button>
            ) : onLogin ? (
              <Button size="sm" variant="outline" onClick={() => onLogin(p.id)}>
                Sign in
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default ProviderList;
