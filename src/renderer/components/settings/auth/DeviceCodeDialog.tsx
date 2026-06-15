/**
 * Device-code 流程对话框（Step 8）。
 *
 * 显示 user code + verification URI；点击复制 code、按钮打开浏览器。
 * pi 的 progress 事件实时反馈轮询状态。完成 / 失败 由父组件的 stage
 * 切换驱动；本组件只负责渲染当前阶段。
 *
 * 关闭按钮 = cancel：父组件须把 onOpenChange(false) 翻译成 cancel + reset。
 */

import React, { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import { Input } from '@/shadcn/input';
import { Label } from '@/shadcn/label';
import { Badge } from '@/shadcn/badge';
import type { AuthStage } from './useAuthSession';

interface Props {
  open: boolean;
  providerName: string;
  stage: AuthStage;
  progressMessage: string | null;
  onClose: () => void;
  onSubmitPrompt: (value: string | undefined) => void;
}

const DeviceCodeDialog: React.FC<Props> = ({ open, providerName, stage, progressMessage, onClose, onSubmitPrompt }) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [promptValue, setPromptValue] = useState('');

  const copy = async (text: string, setCopied: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore — 用户能看到原文，手动复制 */
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sign in to {providerName}</DialogTitle>
          {stage.type === 'starting' && (
            <DialogDescription>Starting login flow...</DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-4 min-h-[120px]">
          {stage.type === 'starting' && (
            <div className="text-sm text-gray-500">Contacting {providerName}...</div>
          )}

          {stage.type === 'auth' && (
            <div className="flex flex-col gap-3">
              {stage.instructions && (
                <div className="text-sm text-gray-700">{stage.instructions}</div>
              )}
              <Button onClick={() => window.open(stage.url, '_blank')}>
                <ExternalLink size={14} className="mr-2" />
                Open in browser
              </Button>
              <div className="text-xs text-gray-500 break-all">{stage.url}</div>
            </div>
          )}

          {stage.type === 'deviceCode' && (
            <div className="flex flex-col gap-3">
              <div>
                <Label className="text-xs text-gray-500">Enter this code at:</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-xs px-2 py-1 bg-gray-100 rounded flex-1 truncate">{stage.verificationUri}</code>
                  <Button size="sm" variant="outline" onClick={() => window.open(stage.verificationUri, '_blank')}>
                    <ExternalLink size={14} />
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-xs text-gray-500">User code</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-lg font-mono px-3 py-2 bg-gray-100 rounded flex-1 text-center tracking-wider">{stage.userCode}</code>
                  <Button size="sm" variant="outline" onClick={() => copy(stage.userCode, setCopiedCode)}>
                    <Copy size={14} className="mr-1" />
                    {copiedCode ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
              {stage.expiresInSeconds && (
                <div className="text-xs text-gray-500">Expires in {Math.round(stage.expiresInSeconds / 60)} min</div>
              )}
            </div>
          )}

          {stage.type === 'prompt' && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!stage.allowEmpty && !promptValue) return;
                onSubmitPrompt(promptValue);
                setPromptValue('');
              }}
            >
              <Label>{stage.message}</Label>
              <Input
                autoFocus
                value={promptValue}
                placeholder={stage.placeholder}
                onChange={(e) => setPromptValue(e.target.value)}
              />
              <Button type="submit" size="sm" disabled={!stage.allowEmpty && !promptValue}>
                Submit
              </Button>
            </form>
          )}

          {stage.type === 'select' && (
            <div className="flex flex-col gap-2">
              <Label>{stage.message}</Label>
              {stage.options.map((opt) => (
                <Button
                  key={opt.id}
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  onClick={() => onSubmitPrompt(opt.id)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          )}

          {stage.type === 'progress' && (
            <div className="text-sm text-gray-600">{stage.message}</div>
          )}

          {stage.type === 'done' && stage.success === false && (
            <Badge variant="destructive" className="self-start">
              {stage.error}
            </Badge>
          )}

          {stage.type === 'done' && stage.success === true && (
            <div className="text-sm text-green-600">Signed in successfully.</div>
          )}

          {progressMessage && stage.type !== 'progress' && stage.type !== 'done' && (
            <div className="text-xs text-gray-500 border-t pt-2">{progressMessage}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {stage.type === 'done' ? 'Close' : 'Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeviceCodeDialog;
