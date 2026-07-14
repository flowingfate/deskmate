import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shadcn/tooltip';

interface RibbonItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'title'> {
  isActive?: boolean;
  tooltip: string;
}


export function RibbonItem({ isActive = false, tooltip, type = 'button', ...props }: RibbonItemProps): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-full self-stretch">
          <button
            {...props}
            type={type}
            className={`inline-flex h-full min-w-5 cursor-pointer self-stretch items-center justify-center gap-1 px-1.5 text-[10px] font-medium text-content-heading transition-colors hover:bg-black/[0.035] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-black/30 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent ${isActive ? 'bg-black/6' : ''}`}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-[11px]">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
