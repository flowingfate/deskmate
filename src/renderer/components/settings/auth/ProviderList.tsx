/**
 * Provider 列表 + 添加 / 登出入口（Step 8）。
 *
 * 顶部 "Connected Accounts" 区列 listAccounts 返回的已登录 provider，
 * 每行带 logout 按钮。底部 "Add provider" 按钮打开 AddProviderDialog。
 * 选中 OAuth provider → DeviceCodeDialog；API Key provider → ApiKeyForm。
 *
 * loginComplete(success=true) 后由 useAuthSession 把 stage 切到 done.success，
 * 这里订阅 stage 在 success 时刷新 listAccounts。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, LogIn, LogOut, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { Badge } from '@/shadcn/badge';
import SettingsLayout from '../SettingsLayout';
import { useToast } from '../../ui/ToastProvider';
import { piApi } from '@/ipc/pi';
import type { ProviderAccountSummary } from '@shared/types/piAuthTypes';
import { PROVIDER_REGISTRY, getProviderDescriptor, type ProviderDescriptor } from './providerRegistry';
import AddProviderDialog from './AddProviderDialog';
import DeviceCodeDialog from './DeviceCodeDialog';
import ApiKeyForm from './ApiKeyForm';
import { useAuthSession } from './useAuthSession';
import { log } from '@/log';

const logger = log.child({ mod: 'ProviderList' });

const ProviderList: React.FC = () => {
  const [accounts, setAccounts] = useState<ProviderAccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [apiKeyTarget, setApiKeyTarget] = useState<ProviderDescriptor | null>(null);
  const auth = useAuthSession();
  const { showSuccess, showError } = useToast();

  const reload = useCallback(async () => {
    const res = await piApi.listAccounts();
    if (!res.success) {
      showError(res.error);
      return;
    }
    setAccounts(res.data ?? []);
    setLoading(false);
  }, [showError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 登录成功 → 刷新 + 显示 toast；失败由 dialog 自己显示，不重复 toast
  useEffect(() => {
    if (auth.stage.type === 'done' && auth.stage.success) {
      const p = auth.provider ? getProviderDescriptor(auth.provider) : null;
      showSuccess(`Connected to ${p?.name ?? auth.provider}`);
      void reload();
    }
  }, [auth.stage, auth.provider, reload, showSuccess]);

  const connectedIds = new Set(accounts.map((a) => a.provider));
  const available = PROVIDER_REGISTRY.filter((p) => !connectedIds.has(p.id));

  const handlePick = (p: ProviderDescriptor) => {
    setAddOpen(false);
    if (p.auth === 'oauth') {
      auth.start(p.id).catch((err) => {
        logger.error({ msg: 'startLogin threw', err: String(err) });
        showError(err instanceof Error ? err.message : String(err));
      });
    } else {
      setApiKeyTarget(p);
    }
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

  const oauthProviderName = auth.provider ? getProviderDescriptor(auth.provider)?.name ?? auth.provider : '';

  return (
    <SettingsLayout
      icon={<ShieldCheck size={18} />}
      title="Provider"
      actions={
        <Button size="sm" onClick={() => setAddOpen(true)} disabled={available.length === 0}>
          <Plus size={14} className="mr-1" />
          Add provider
        </Button>
      }
    >
      <div className="px-6 py-4 flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-gray-700">Connected accounts</h3>
          {loading ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : accounts.length === 0 ? (
            <div className="text-sm text-gray-500">
              No providers connected yet. Click &quot;Add provider&quot; to sign in.
            </div>
          ) : (
            <div className="flex flex-col divide-y border rounded-md">
              {accounts.map((a) => {
                const desc = getProviderDescriptor(a.provider);
                return (
                  <div key={a.provider} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      {a.type === 'oauth' ? <LogIn size={16} /> : <KeyRound size={16} />}
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{desc?.name ?? a.provider}</span>
                        <span className="text-xs text-gray-500">{a.provider}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {a.type === 'oauth' ? 'OAuth' : 'API Key'}
                      </Badge>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => handleLogout(a.provider)}>
                      <LogOut size={14} className="mr-1" />
                      Sign out
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <AddProviderDialog
        open={addOpen}
        available={available}
        onClose={() => setAddOpen(false)}
        onPick={handlePick}
      />

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

      {apiKeyTarget && (
        <ApiKeyForm
          open
          providerId={apiKeyTarget.id}
          providerName={apiKeyTarget.name}
          onClose={() => setApiKeyTarget(null)}
          onSaved={reload}
        />
      )}
    </SettingsLayout>
  );
};

export default ProviderList;
