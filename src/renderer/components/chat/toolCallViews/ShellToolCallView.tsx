// src/renderer/components/chat/toolCallViews/ShellToolCallView.tsx
// Custom view component for `shell` tool calls - terminal-style display

import React from 'react';
import { ToolCallViewProps, ShellToolArgs, ShellToolResult } from './types';

/**
 * `shell` 工具 args 已是结构化对象 (Domain ToolCall.args);
 * 这里仅做形态校验,不再做 JSON.parse。
 */
const coerceShellArgs = (args: Record<string, unknown> | undefined): ShellToolArgs | null => {
  if (!args || typeof args.command !== 'string') return null;
  return args as unknown as ShellToolArgs;
};

/**
 * Parse tool result content
 */
const parseToolResult = (content: string): ShellToolResult | null => {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

/**
 * Get shell prompt string
 */
const getPrompt = (shell?: string, cwd?: string): string => {
  const displayPath = cwd || '~';
  // Return different prompt style based on shell type
  switch (shell) {
    case 'powershell':
      return `PS ${displayPath}>`;
    case 'cmd':
      return `${displayPath}>`;
    case 'bash':
    case 'sh':
    case 'zsh':
    default:
      return `$ `;
  }
};

/**
 * Execute Command Tool Call custom view
 * Displays command execution results in terminal style
 */
export const ShellToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  executionStatus,
}) => {
  const args = coerceShellArgs(toolCall.args);
  // Domain ToolCall.response.result 是工具的字符串输出。shell tool 内部把
  // ShellToolResult JSON.stringify 后写入,这里反序列化得到结构化结果。
  const resultText = toolCall.response?.result ?? '';
  const result = resultText ? parseToolResult(resultText) : null;

  // If no arguments, don't render
  if (!args || !args.command) {
    return null;
  }

  const isExecuting = executionStatus === 'executing';
  const isInterrupted = executionStatus === 'interrupted';
  const command = args.command + (args.args ? ' ' + args.args.join(' ') : '');
  const prompt = getPrompt(args.shell, args.cwd);

  // Build complete output content
  const buildOutput = (): string => {
    if (!result) return '';

    let output = '';

    // Add stdout
    if (result.stdout && result.stdout.trim()) {
      output += result.stdout;
    }

    // Add stderr (if any)
    if (result.stderr && result.stderr.trim()) {
      if (output) output += '\n';
      output += result.stderr;
    }

    return output.trim();
  };

  const output = buildOutput();
  const hasError = result && (result.exitCode !== 0 || (result.stderr && result.stderr.trim()));
  const timedOut = result?.timedOut;

  return (
    <div className="execute-command-view">
      <div className="terminal-container">
        {/* Command line */}
        <div className="terminal-line terminal-command-line">
          <span className="terminal-prompt">{prompt}</span>
          <span className="terminal-command">{command}</span>
        </div>

        {/* Executing state */}
        {isExecuting && (
          <div className="terminal-line terminal-executing">
            <span className="terminal-executing-text">Executing...</span>
          </div>
        )}

        {isInterrupted && (
          <div className="terminal-line terminal-timeout">
            <span className="terminal-timeout-text">Interrupted before command output was recorded</span>
          </div>
        )}

        {/* Output content */}
        {output && (
          <div className={`terminal-output ${hasError ? 'has-error' : ''}`}>
            <pre className="terminal-output-pre">{output}</pre>
          </div>
        )}

        {/* Timeout indicator */}
        {timedOut && (
          <div className="terminal-line terminal-timeout">
            <span className="terminal-timeout-text">⚠ Command timed out</span>
          </div>
        )}

        {/* Truncation indicator */}
        {result?.truncated && (
          <div className="terminal-line terminal-truncated">
            <span className="terminal-truncated-text">... (output truncated)</span>
          </div>
        )}

        {/* Exit code (only shown when non-zero) */}
        {result && result.exitCode !== null && result.exitCode !== 0 && !timedOut && (
          <div className="terminal-line terminal-exit-code">
            <span className="terminal-exit-code-text">Exit code: {result.exitCode}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShellToolCallView;
