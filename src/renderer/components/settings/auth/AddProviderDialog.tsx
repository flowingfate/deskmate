/**
 * "Add Provider" 选择对话框（Step 8）。
 *
 * 列出尚未连接的 provider，按 auth 类型分组（OAuth / API Key）。点击 OAuth
 * 项 → 通知父组件启动 device-code 流程；点击 API Key 项 → 通知父组件
 * 打开 ApiKeyForm。
 */

import React from 'react';
import { KeyRound, LogIn } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import type { ProviderDescriptor } from './providerRegistry';

interface Props {
  open: boolean;
  available: ProviderDescriptor[];
  onClose: () => void;
  onPick: (provider: ProviderDescriptor) => void;
}

const AddProviderDialog: React.FC<Props> = ({ open, available, onClose, onPick }) => {
  const oauth = available.filter((p) => p.auth === 'oauth');
  const apiKey = available.filter((p) => p.auth === 'apiKey');

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add provider</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {oauth.length > 0 && (
            <section className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase text-gray-500">Sign in with OAuth</h4>
              {oauth.map((p) => (
                <Button
                  key={p.id}
                  variant="outline"
                  className="justify-start"
                  onClick={() => onPick(p)}
                >
                  <LogIn size={14} className="mr-2" />
                  {p.name}
                </Button>
              ))}
            </section>
          )}

          {apiKey.length > 0 && (
            <section className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase text-gray-500">Use API key</h4>
              {apiKey.map((p) => (
                <Button
                  key={p.id}
                  variant="outline"
                  className="justify-start"
                  onClick={() => onPick(p)}
                >
                  <KeyRound size={14} className="mr-2" />
                  {p.name}
                </Button>
              ))}
            </section>
          )}

          {available.length === 0 && (
            <div className="text-sm text-gray-500">All providers already connected.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddProviderDialog;
