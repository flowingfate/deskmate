import type { Story } from '@ladle/react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/shadcn/tooltip';
import { Button } from '@/shadcn/button';

export default { title: 'Shadcn / Tooltip' };

export const Default: Story = () => (
  <TooltipProvider>
    <div className="flex gap-6">
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Tooltip key={side}>
          <TooltipTrigger asChild>
            <Button variant="outline">{side}</Button>
          </TooltipTrigger>
          <TooltipContent side={side}>Tooltip on {side}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  </TooltipProvider>
);
