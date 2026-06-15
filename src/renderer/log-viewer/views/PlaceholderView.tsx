// Placeholder view：占位"Coming soon"。
// 后续每个 view 实装时直接替换 App 里的 view 路由 case。
// 设计保持与 LogsView 同骨架（toolbar 高度一致），切换时不会跳变。

import type { ComponentType } from 'react';
import { Sparkles } from 'lucide-react';

interface Props {
  title: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
}

export function PlaceholderView({ title, icon: Icon, description }: Props) {
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-white">
      {/* 占位 toolbar：与 LogsToolbar 单 strip (vw-toolbar-h) 对齐 */}
      <div className="flex h-12 items-center border-b border-vw-divider px-4">
        <h1 className="text-[13px] font-semibold tracking-tight text-slate-900">{title}</h1>
      </div>

      <div className="flex flex-1 items-center justify-center px-8">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="relative mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-100 ring-1 ring-blue-200/50">
            <Icon className="h-6 w-6 text-blue-600" />
            <Sparkles className="absolute -right-1 -top-1 h-3.5 w-3.5 text-amber-500" />
          </div>
          <h2 className="text-[16px] font-semibold tracking-tight text-slate-900">
            {title} · coming soon
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">{description}</p>
        </div>
      </div>
    </section>
  );
}
