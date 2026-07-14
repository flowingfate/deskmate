// src/renderer/components/chat/tool/renderers/shell/index.tsx
// `shell` 工具的 ToolRenderer —— 终端风格输入 / 输出。
//
// slot 划分:
//   chipLabel          : `shell: <cmd>`(前 2 个 token,空间有限)
//   InputBlock         : 终端 prompt + command 单行
//   OutputSuccessBlock : stdout / stderr / exit code 终端块
// executing / interrupted / failed 走默认渲染。

import React from 'react';
import type { ToolCall } from '@shared/persist/types'
import type {
  ToolRenderer,
  ToolSlotProps,
  ToolOutputSuccessSlotProps,
  ShellToolArgs,
  ShellToolResult,
} from '../../types';

const coerceShellArgs = (args: Record<string, unknown> | undefined): ShellToolArgs | null => {
  if (!args || typeof args.command !== 'string') return null;
  return args as unknown as ShellToolArgs;
};

const parseShellResult = (content: string): ShellToolResult | null => {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const PROMPT_BY_SHELL: Record<string, (cwd: string) => string> = {
  powershell: (cwd) => `PS ${cwd}>`,
  cmd: (cwd) => `${cwd}>`,
};
const getPrompt = (shell?: string, cwd?: string): string => {
  const path = cwd || '~';
  const fn = shell ? PROMPT_BY_SHELL[shell] : undefined;
  return fn ? fn(path) : '$ ';
};

const TERMINAL_BLOCK_CLS =
  'm-0 px-2.5 py-2 rounded-[4px] bg-zinc-900 text-zinc-100 ' +
  'font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap break-words ' +
  'max-h-[260px] overflow-auto custom-scrollbar';

const chipLabel = (toolCall: ToolCall): string => {
  const args = coerceShellArgs(toolCall.args);
  if (!args) return 'shell';
  const cmd = args.command + (args.args && args.args.length > 0 ? ' ' + args.args.join(' ') : '');
  const trimmed = cmd.trim().split(/\s+/).slice(0, 2).join(' ');
  return `shell: ${trimmed}`;
};

const InputBlock: React.FC<ToolSlotProps> = ({ toolCall }) => {
  const args = coerceShellArgs(toolCall.args);
  if (!args) return <pre className={TERMINAL_BLOCK_CLS}>(invalid shell args)</pre>;
  const command = args.command + (args.args ? ' ' + args.args.join(' ') : '');
  const prompt = getPrompt(args.shell, args.cwd);
  return (
    <pre className={TERMINAL_BLOCK_CLS}>
      <span className="text-emerald-400">{prompt}</span>
      <span> {command}</span>
    </pre>
  );
};

const OutputSuccessBlock: React.FC<ToolOutputSuccessSlotProps> = ({ result }) => {
  const parsed = parseShellResult(result);
  if (!parsed) {
    return <pre className={TERMINAL_BLOCK_CLS}>{result}</pre>;
  }

  const output = [parsed.stdout?.trim(), parsed.stderr?.trim()]
    .filter(Boolean)
    .join('\n')
    .trim();
  const hasError = parsed.exitCode !== 0 || (parsed.stderr && parsed.stderr.trim());

  return (
    <pre className={TERMINAL_BLOCK_CLS}>
      {output && (
        <span className={hasError ? 'text-rose-300' : ''}>
          {output}
          {'\n'}
        </span>
      )}
      {parsed.timedOut && <span className="text-amber-400">⚠ Command timed out{'\n'}</span>}
      {parsed.truncated && <span className="text-zinc-500">... (output truncated){'\n'}</span>}
      {parsed.exitCode !== null && parsed.exitCode !== 0 && !parsed.timedOut && (
        <span className="text-rose-300">Exit code: {parsed.exitCode}</span>
      )}
      {!output && !parsed.timedOut && !parsed.truncated && parsed.exitCode === 0 && (
        <span className="text-zinc-500 italic">(no output)</span>
      )}
    </pre>
  );
};

export const shellRenderer: ToolRenderer = {
  chipLabel,
  InputBlock,
  OutputSuccessBlock,
};
