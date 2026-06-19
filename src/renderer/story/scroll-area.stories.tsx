import type { Story } from '@ladle/react';
import { ScrollArea } from '@/shadcn/scroll-area';
import { Separator } from '@/shadcn/separator';

export default { title: 'Shadcn / ScrollArea' };

const tags = Array.from({ length: 30 }, (_, i) => `v1.2.${i}`);

export const Vertical: Story = () => (
  <ScrollArea className="h-56 w-56 rounded-md border border-sc-border">
    <div className="p-4">
      <h4 className="mb-3 text-sm font-medium">Tags</h4>
      {tags.map((tag) => (
        <div key={tag}>
          <div className="py-1 text-sm">{tag}</div>
          <Separator />
        </div>
      ))}
    </div>
  </ScrollArea>
);

export const Horizontal: Story = () => (
  <ScrollArea className="w-72 rounded-md border border-sc-border whitespace-nowrap">
    <div className="flex gap-3 p-4">
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className="flex h-24 w-24 shrink-0 items-center justify-center rounded-md bg-sc-muted text-sm"
        >
          {i + 1}
        </div>
      ))}
    </div>
  </ScrollArea>
);
