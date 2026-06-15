import React from 'react';
import { Badge } from '@/shadcn/badge';
import { useCurrentAgent } from '@/states/agents.atom';
import { useModelInfo } from '../../lib/models/useModelInfo';
import { CurrentSessionTokenUsage } from '../../lib/chat/agentSessionCacheManager';

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    const kValue = tokens / 1000;
    return kValue % 1 === 0 ? `${kValue.toFixed(0)}k` : `${kValue.toFixed(1)}k`;
  }
  return tokens.toString();
}

export const ContextBadge: React.FC = () => {
  const currentAgent = useCurrentAgent();
  const currentModel = currentAgent?.model ?? null;
  const { info } = useModelInfo(currentModel);

  const usage = CurrentSessionTokenUsage.use();
  const contextTokens = usage.tokenCount;

  // info 未到时显示为 0 / 0；解析后立即更新。比老实现的"硬编码 128_000"少一处误导
  const modelContextWindow = info?.contextWindow ?? 0;

  const utilizationRatio = modelContextWindow > 0 ? contextTokens / modelContextWindow : 0;

  let variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' = 'default';
  if (utilizationRatio > 0.9) {
    variant = 'destructive';
  } else if (utilizationRatio > 0.7) {
    variant = 'outline';
  } else if (utilizationRatio > 0) {
    variant = 'default';
  }

  const contextText = formatTokenCount(contextTokens);
  const windowText = formatTokenCount(modelContextWindow);

  return (
    <Badge
      variant={variant}
      className="text-xs"
      title={`Context usage: ${contextTokens.toLocaleString()} / ${modelContextWindow.toLocaleString()} tokens (${(utilizationRatio * 100).toFixed(1)}%)`}
    >
      {`context: ${contextText}/${windowText}`}
    </Badge>
  );
};

export default ContextBadge;
