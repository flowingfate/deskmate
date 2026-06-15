// view 路由表。当前只有 logs 实装；其余占位 placeholder。
// 后续加新 view：往 VIEWS 数组加一项 + 写对应组件即可。

import type { ComponentType } from 'react';
import { Activity, AlertOctagon, GitBranch, BarChart3, Bookmark } from 'lucide-react';

export type ViewId = 'logs' | 'errors' | 'traces' | 'stats' | 'saved';

export interface ViewDef {
  id: ViewId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** placeholder 的 view 显示"Coming soon"，不参与真实查询。 */
  placeholder?: boolean;
}

export const VIEWS: ViewDef[] = [
  { id: 'logs', label: 'Logs', icon: Activity },
  { id: 'errors', label: 'Errors', icon: AlertOctagon, placeholder: true },
  { id: 'traces', label: 'Traces', icon: GitBranch },
  { id: 'stats', label: 'Stats', icon: BarChart3, placeholder: true },
  { id: 'saved', label: 'Saved', icon: Bookmark, placeholder: true },
];

export function findView(id: ViewId): ViewDef {
  return VIEWS.find((v) => v.id === id) ?? VIEWS[0];
}
