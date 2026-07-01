import React, { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/shadcn/button';

interface CodeBlockCopyButtonProps {
  code: string;
}

const CodeBlockCopyButton: React.FC<CodeBlockCopyButtonProps> = ({ code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="code-block-copy-btn"
      onClick={handleCopy}
      title="Copy code"
      aria-label="Copy code"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </Button>
  );
};

export default CodeBlockCopyButton;
