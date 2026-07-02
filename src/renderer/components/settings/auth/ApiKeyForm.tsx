/**
 * API Key 录入表单（内联版）。
 *
 * 单选按钮组选择 provider + baseUrl（可选）+ apiKey 输入，
 * 直接平铺在 ProviderList 中。
 */

import React, { useState } from 'react';
import { Button } from '@/shadcn/button';
import { Input } from '@/shadcn/input';
import { Label } from '@/shadcn/label';
import { RadioGroup, RadioGroupItem } from '@/shadcn/radio-group';
import { piApi } from '@/ipc/pi';
import { useToast } from '../../ui/ToastProvider';
import type { ProviderDescriptor } from './providerRegistry';

interface Props {
  providers: ProviderDescriptor[];
  onSaved: () => void;
  onCancel: () => void;
}

const ApiKeyForm: React.FC<Props> = ({ providers, onSaved, onCancel }) => {
  const [selectedId, setSelectedId] = useState(providers[0]?.id ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const { showSuccess, showError } = useToast();

  const selected = providers.find((p) => p.id === selectedId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey || !selectedId) return;
    setSaving(true);
    try {
      const trimmedBaseUrl = baseUrl.trim() || undefined;
      const res = await piApi.setApiKey(selectedId, apiKey, trimmedBaseUrl);
      if (!res.success) {
        showError(res.error);
        return;
      }
      showSuccess(`${selected?.name ?? selectedId} API key saved`);
      setApiKey('');
      setBaseUrl('');
      onSaved();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (providers.length === 0) return null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-md border border-black/7 p-4">
      {/* Provider 单选 */}
      <div className="flex flex-col gap-2">
        <Label>Provider</Label>
        <RadioGroup value={selectedId} onValueChange={setSelectedId} className="grid grid-cols-2 gap-2">
          {providers.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2 cursor-pointer rounded-md border border-black/7 px-3 py-2 hover:bg-gray-50 has-[[data-state=checked]]:border-neutral-500 has-[[data-state=checked]]:bg-neutral-50/50"
            >
              <RadioGroupItem value={p.id} />
              <span className="text-sm">{p.name}</span>
            </label>
          ))}
        </RadioGroup>
      </div>

      {/* Base URL */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pi-auth-baseurl-input">
          Base URL
          <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
        </Label>
        <Input
          id="pi-auth-baseurl-input"
          type="url"
          placeholder={selected?.defaultBaseUrl ?? 'https://api.example.com'}
          autoComplete="off"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <p className="text-xs text-gray-500">
          留空使用内置地址。使用代理或兼容服务时填写自定义地址。
        </p>
      </div>

      {/* API Key */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pi-auth-apikey-input">API Key</Label>
        <Input
          id="pi-auth-apikey-input"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!apiKey || saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  );
};

export default ApiKeyForm;
