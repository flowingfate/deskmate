/**
 * API Key 录入表单（Step 8）。
 *
 * 单输入框 + 保存按钮，不做实时校验：pi 在第一次 LLM 调用时报错就行。
 * 表单完成后 onSaved 触发父组件刷新列表。
 */

import React, { useState } from 'react';
import { Button } from '@/shadcn/button';
import { Input } from '@/shadcn/input';
import { Label } from '@/shadcn/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shadcn/dialog';
import { piApi } from '@/ipc/pi';
import { useToast } from '../../ui/ToastProvider';

interface Props {
  open: boolean;
  providerId: string;
  providerName: string;
  onClose: () => void;
  onSaved: () => void;
}

const ApiKeyForm: React.FC<Props> = ({ open, providerId, providerName, onClose, onSaved }) => {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const { showSuccess, showError } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey) return;
    setSaving(true);
    try {
      const res = await piApi.setApiKey(providerId, apiKey);
      if (!res.success) {
        showError(res.error);
        return;
      }
      showSuccess(`${providerName} API key saved`);
      setApiKey('');
      onSaved();
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setApiKey('');
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{providerName} API key</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Label htmlFor="pi-auth-apikey-input">API key</Label>
          <Input
            id="pi-auth-apikey-input"
            type="password"
            autoFocus
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div className="text-xs text-gray-500">
            Stored in your profile&apos;s auth file. We don&apos;t validate it now — invalid keys will be rejected on
            first use.
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!apiKey || saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ApiKeyForm;
