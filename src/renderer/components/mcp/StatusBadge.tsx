import React from 'react';
import { Badge } from '@/shadcn/badge';
import { cn } from '@/lib/utilities/utils';

/**
 * MCP server runtime 状态 → Badge 的统一映射。
 *
 * 单点维护"状态文案 + 颜色":McpServerCard / AgentMcpServerCard 共享。
 * 颜色用 tailwind utility 而非 raw HEX —— 状态语义本身就需要色彩(成功 /
 * 进行中 / 错误),无法 round-trip 到 semantic token,所以用 `emerald / amber
 * / red / sc-muted-foreground` 组合,统一暗黑模式 token。
 */

export type McpServerStatus =
  | 'connected'
  | 'disconnected'
  | 'connecting'
  | 'disconnecting'
  | 'error'
  | 'needs-user-interaction'
  | string;

interface StatusBadgeProps {
  status: McpServerStatus;
  className?: string;
}

interface StatusStyle {
  label: string;
  className: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  connected: {
    label: 'connected',
    className: 'border-transparent bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400',
  },
  connecting: {
    label: 'connecting',
    className: 'border-transparent bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400',
  },
  disconnecting: {
    label: 'disconnecting',
    className: 'border-transparent bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400',
  },
  'needs-user-interaction': {
    label: 'needs sign-in',
    className: 'border-transparent bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400',
  },
  error: {
    label: 'error',
    className: 'border-transparent bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-500/15 dark:text-red-400',
  },
  disconnected: {
    label: 'disconnected',
    className: 'border-transparent bg-sc-muted text-sc-muted-foreground hover:bg-sc-muted',
  },
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className }) => {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.disconnected;
  return (
    <Badge className={cn('text-[10px] font-medium uppercase tracking-wide', style.className, className)}>
      {style.label}
    </Badge>
  );
};

export default StatusBadge;
