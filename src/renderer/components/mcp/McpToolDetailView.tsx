'use client';

import React from 'react';
import { ArrowLeft, Copy, Wrench } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { Separator } from '@/shadcn/separator';
import { Badge } from '@/shadcn/badge';
import { MCPTool } from '../../types/mcpTypes';

interface McpToolDetailViewProps {
  tool: MCPTool | null;
  serverName?: string;
  onBack?: () => void;
}

const formatSchema = (schema: unknown): string => {
  if (!schema || typeof schema !== 'object') return 'N/A';
  try {
    return JSON.stringify(schema, null, 2);
  } catch {
    return String(schema);
  }
};

/**
 * 单个 MCP tool 详情(右栏 detail view)。
 *
 * 风格与 `tools/ToolDetailView` 对齐。额外渲染 server 归属信息(`serverName` /
 * `tool.serverId`),以及 back 按钮跳回 list mode。
 */
const McpToolDetailView: React.FC<McpToolDetailViewProps> = ({
  tool,
  serverName,
  onBack,
}) => {
  if (!tool) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-sc-muted-foreground">
        <Wrench className="size-10 opacity-40" />
        <p className="text-sm font-medium">Select a Tool</p>
        <p className="text-xs">Choose a tool from the list to view detailed information.</p>
      </div>
    );
  }

  const schemaText = formatSchema(tool.inputSchema);

  const copySchema = async () => {
    try {
      await navigator.clipboard.writeText(schemaText);
    } catch {
      // ignore
    }
  };

  const copyToolInfo = async () => {
    const info = `Tool: ${tool.name}\nDescription: ${tool.description ?? ''}\n${
      serverName ? `Server: ${serverName}\n` : ''
    }\nInput Schema:\n${schemaText}`;
    try {
      await navigator.clipboard.writeText(info);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      <div className="flex items-center gap-2">
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            title="Back to tool list"
            aria-label="Back to tool list"
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <Wrench className="size-5 shrink-0 text-sc-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-sc-foreground">
          {tool.name}
        </h2>
        <Button variant="ghost" size="sm" onClick={copyToolInfo} title="Copy full tool info">
          <Copy data-icon="inline-start" />
          Copy
        </Button>
      </div>

      {tool.description && (
        <p className="text-sm leading-relaxed text-sc-muted-foreground">
          {tool.description}
        </p>
      )}

      {serverName && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-sc-muted-foreground">
          <span>Server:</span>
          <Badge variant="secondary">{serverName}</Badge>
        </div>
      )}

      <Separator />

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-sc-muted-foreground">
            Input Schema
          </h3>
          <Button variant="ghost" size="sm" onClick={copySchema} title="Copy schema as JSON">
            <Copy data-icon="inline-start" />
            Copy schema
          </Button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-sc-border bg-sc-muted/40 p-3 font-mono text-xs leading-relaxed text-sc-foreground">
          <code>{schemaText}</code>
        </pre>
      </div>
    </div>
  );
};

export default McpToolDetailView;
