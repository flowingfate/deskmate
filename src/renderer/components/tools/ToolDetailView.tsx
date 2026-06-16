'use client';

import React from 'react';
import { Copy, Wrench } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { Separator } from '@/shadcn/separator';
import type { LocalToolInfo } from '@shared/types/toolsTypes';

interface ToolDetailViewProps {
  tool: LocalToolInfo | null;
}

const formatSchema = (schema: Record<string, unknown> | undefined): string => {
  if (!schema || typeof schema !== 'object') return 'N/A';
  try {
    return JSON.stringify(schema, null, 2);
  } catch {
    return String(schema);
  }
};

/**
 * 纯展示组件:单个本地工具的描述 + JSON Schema。
 *
 * 不渲染 server name 行(本地工具不属于任何 MCP server)。全 Tailwind +
 * semantic tokens,无独立 scss。
 */
const ToolDetailView: React.FC<ToolDetailViewProps> = ({ tool }) => {
  if (!tool) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-sc-muted-foreground">
        <Wrench className="size-10 opacity-40" />
        <p className="text-sm">Select a tool to view its details</p>
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

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      <h2 className="min-w-0 truncate text-base font-semibold text-sc-foreground">
        Description
      </h2>

      {tool.description && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-sc-border bg-sc-muted/30 p-3 font-sans text-sm leading-relaxed text-sc-muted-foreground">
          {tool.description}
        </pre>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold tracking-wide text-sc-muted-foreground">
            Input Schema
          </h3>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={copySchema}
            title="Copy schema as JSON"
          >
            <Copy size={14} data-icon="inline-start" />
            Copy
          </Button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-sc-border bg-sc-muted/40 p-3 font-mono text-xs leading-relaxed text-sc-foreground">
          <code>{schemaText}</code>
        </pre>
      </div>
    </div>
  );
};

export default ToolDetailView;
