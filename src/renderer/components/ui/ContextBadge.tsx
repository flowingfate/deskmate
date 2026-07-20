import React from 'react';
import { badgeVariants } from '@/shadcn/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/shadcn/popover';
import { cn } from '@/lib/utilities/utils';
import { useAgentById } from '@/states/agents.atom';
import { useModelInfo } from '../../lib/models/useModelInfo';
import { useContextUsage, useCumulativeUsage } from '../chat/useSessionCache';

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    const kValue = tokens / 1000;
    return kValue % 1 === 0 ? `${kValue.toFixed(0)}k` : `${kValue.toFixed(1)}k`;
  }
  return tokens.toString();
}

function formatCumulativeTokenCount(tokens: number): string {
  return `${tokens.toLocaleString()}（${Math.ceil(tokens / 1000)}K）`;
}

const EMPTY_CONTEXT_USAGE = { tokenCount: 0, totalMessages: 0, contextMessages: 0, compressionRatio: 1 };
const EMPTY_CUMULATIVE_USAGE = { in: 0, out: 0, total: 0, cache: [0, 0] };

interface ContextBadgeProps {
  agentId: string;
  sessionId: string | null;
}

export const ContextBadge: React.FC<ContextBadgeProps> = ({ agentId, sessionId }) => {
  const agent = useAgentById(agentId);
  const currentModel = agent?.model ?? null;
  const { info } = useModelInfo(currentModel);
  const usage = useContextUsage(sessionId) ?? EMPTY_CONTEXT_USAGE;
  const cumulativeUsage = useCumulativeUsage(sessionId) ?? EMPTY_CUMULATIVE_USAGE;
  const contextTokens = usage.tokenCount;
  const modelContextWindow = info?.contextWindow ?? 0;
  const utilizationRatio = modelContextWindow > 0 ? contextTokens / modelContextWindow : 0;
  const utilizationText = `${(utilizationRatio * 100).toFixed(1)}%`;
  const remainingTokens = Math.max(modelContextWindow - contextTokens, 0);
  const clampedUtilization = Math.min(utilizationRatio * 100, 100);

  let variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' = 'default';
  let progressClass = 'bg-sc-primary';
  if (utilizationRatio > 0.9) {
    variant = 'destructive';
    progressClass = 'bg-sc-destructive';
  } else if (utilizationRatio > 0.7) {
    variant = 'outline';
    progressClass = 'bg-amber-500';
  }

  const contextText = formatTokenCount(contextTokens);
  const windowText = formatTokenCount(modelContextWindow);
  const promptInputTokens = cumulativeUsage.in + cumulativeUsage.cache[0] + cumulativeUsage.cache[1];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(badgeVariants({ variant }), 'cursor-pointer hover:opacity-80')}
          title={`Context usage: ${contextTokens.toLocaleString()} / ${modelContextWindow.toLocaleString()} tokens (${utilizationText}). Click for details.`}
          aria-label="Show context details"
        >
          {`context: ${contextText}/${windowText}`}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-72 space-y-3 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-sc-foreground">Context details</span>
          <span className="text-xs font-semibold text-sc-muted-foreground">{utilizationText}</span>
        </div>
        {modelContextWindow > 0 ? (
          <div className="space-y-1.5">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-black/8"
              role="progressbar"
              aria-label="Context utilization"
              aria-valuemin={0}
              aria-valuemax={modelContextWindow}
              aria-valuenow={Math.min(contextTokens, modelContextWindow)}
            >
              <div className={cn('h-full transition-[width] duration-150', progressClass)} style={{ width: `${clampedUtilization}%` }} />
            </div>
            <p className="text-[11px] text-sc-muted-foreground">{utilizationText} of the model context window is in use.</p>
          </div>
        ) : (
          <p className="text-[11px] text-sc-muted-foreground">The model context window is unavailable.</p>
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <dt className="text-sc-muted-foreground">Model</dt>
            <dd className="mt-0.5 truncate font-medium text-sc-foreground" title={currentModel ?? undefined}>{currentModel ?? 'Not selected'}</dd>
          </div>
          <div>
            <dt className="text-sc-muted-foreground">Used</dt>
            <dd className="mt-0.5 font-medium text-sc-foreground">{contextTokens.toLocaleString()} tokens</dd>
          </div>
          <div>
            <dt className="text-sc-muted-foreground">Window</dt>
            <dd className="mt-0.5 font-medium text-sc-foreground">{modelContextWindow > 0 ? `${modelContextWindow.toLocaleString()} tokens` : 'Unavailable'}</dd>
          </div>
          <div>
            <dt className="text-sc-muted-foreground">Remaining</dt>
            <dd className="mt-0.5 font-medium text-sc-foreground">{modelContextWindow > 0 ? `${remainingTokens.toLocaleString()} tokens` : 'Unavailable'}</dd>
          </div>
        </dl>
        <section className="border-t border-sc-border pt-3">
          <h3 className="text-sm font-medium text-sc-foreground">Cumulative token usage</h3>
          <dl className="mt-2 space-y-1.5 text-xs tabular-nums">
            <div className="flex items-center justify-between gap-4">
              <dt className="font-medium text-sc-foreground">Prompt input</dt>
              <dd className="font-medium text-sc-foreground">{formatCumulativeTokenCount(promptInputTokens)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="pl-3 text-sc-muted-foreground">Uncached input</dt>
              <dd className="text-sc-muted-foreground">{formatCumulativeTokenCount(cumulativeUsage.in)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="pl-3 text-sc-muted-foreground">Cache read</dt>
              <dd className="text-sc-muted-foreground">{formatCumulativeTokenCount(cumulativeUsage.cache[0])}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="pl-3 text-sc-muted-foreground">Cache write</dt>
              <dd className="text-sc-muted-foreground">{formatCumulativeTokenCount(cumulativeUsage.cache[1])}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-sc-border pt-1.5">
              <dt className="font-medium text-sc-foreground">Output</dt>
              <dd className="font-medium text-sc-foreground">{formatCumulativeTokenCount(cumulativeUsage.out)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-sc-border pt-1.5">
              <dt className="font-medium text-sc-foreground">Total</dt>
              <dd className="font-semibold text-sc-foreground">{formatCumulativeTokenCount(cumulativeUsage.total)}</dd>
            </div>
          </dl>
        </section>
      </PopoverContent>
    </Popover>
  );
};

export default ContextBadge;
