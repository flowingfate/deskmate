/**
 * CopyButton — 复制文本到剪贴板的按钮。
 *
 * `text` 可以是字符串或惰性 getter（getter 在点击时调用，适合那些
 * 渲染期间不想反复推导的长文本）。
 */

import React, { useState } from 'react';
import { Button } from '@/shadcn/button';

interface CopyButtonProps {
  text: string | (() => string);
}

const COPIED_RESET_MS = 500;

const CopiedIcon: React.FC = () => (
  <svg className="action-icon" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const CopyIcon: React.FC = () => (
  <svg className="action-icon" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

export const CopyButton: React.FC<CopyButtonProps> = ({ text }) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    const payload = typeof text === 'function' ? text() : text;
    try {
      await navigator.clipboard.writeText(payload);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), COPIED_RESET_MS);
    } catch {
      // 剪贴板权限缺失时静默 — 用户重试即可，没必要打断流程。
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="copy-btn"
      onClick={handleCopy}
      title={isCopied ? 'Copied' : 'Copy'}
      aria-label={isCopied ? 'Copied' : 'Copy'}
    >
      {isCopied ? <CopiedIcon /> : <CopyIcon />}
    </Button>
  );
};
