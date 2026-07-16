import { useState } from 'react';
import type { Story } from '@ladle/react';
import { Button } from '@/shadcn/button';
import { AnimatedHeight } from '@/components/chat/tool/AnimatedHeight';

export default { title: 'Chat / Tools / Animated Height' };

export const ExpandAndCollapse: Story = () => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="w-full max-w-xl">
      <Button size="sm" variant="outline" onClick={() => setExpanded((value) => !value)}>
        {expanded ? 'Collapse details' : 'Expand details'}
      </Button>
      <AnimatedHeight className="mt-3 overflow-hidden transition-[height] ease-out" duration={220}>
        <div className="rounded-lg border border-sc-border bg-sc-card p-4 text-sm text-sc-card-foreground">
          <p className="m-0 font-medium">Stable tool-call container</p>
          {expanded && (
            <p className="mb-0 mt-3 leading-6 text-sc-muted-foreground">
              ResizeObserver measures this block while the container animates its height. Toggle repeatedly to inspect transition and scroll anchoring behavior.
            </p>
          )}
        </div>
      </AnimatedHeight>
    </div>
  );
};
