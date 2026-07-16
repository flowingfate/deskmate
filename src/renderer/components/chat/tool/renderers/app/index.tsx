// src/renderer/components/chat/tool/renderers/app/index.tsx
// `app` LocalTool 的顶层 ToolRenderer。它为所有 app 子命令提供一致的通用展示；
// 专属子命令 renderer 只在有真实 production command 时才添加。

import React from 'react';
import type { ToolCall } from '@shared/persist/types'
import type {
  ToolRenderer,
  ToolSlotProps,
  ToolOutputSuccessSlotProps,
} from '../../types';
import { extractAppCmdline, firstNonFlagTokens } from './cmdline';

const FALLBACK_BLOCK_CLS =
  'm-0 px-2.5 py-2 rounded-[4px] bg-gray-50 border-1 border-black/7 ' +
  'font-mono text-[11.5px] leading-[1.55] text-gray-800 ' +
  'whitespace-pre-wrap break-words max-h-[220px] overflow-auto custom-scrollbar';

const chipLabel = (toolCall: ToolCall): string => {
  const tokens = firstNonFlagTokens(extractAppCmdline(toolCall.args), 1);
  return tokens[0] ? `app:${tokens[0]}` : 'app';
};

const InputBlock: React.FC<ToolSlotProps> = ({ toolCall }) => {
  const cmd = extractAppCmdline(toolCall.args);
  return <pre className={FALLBACK_BLOCK_CLS}>{cmd || '(no command)'}</pre>;
};

const OutputExecutingBlock: React.FC<ToolSlotProps> = () => (
  <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-gray-400 italic">
    Running…
  </div>
);

const OutputSuccessBlock: React.FC<ToolOutputSuccessSlotProps> = ({ result }) => (
  <pre className={FALLBACK_BLOCK_CLS}>{result}</pre>
);

export const appRenderer: ToolRenderer = {
  chipLabel,
  InputBlock,
  OutputExecutingBlock,
  OutputSuccessBlock,
};
