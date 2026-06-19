import type { Story } from '@ladle/react';
import { Popover, PopoverTrigger, PopoverContent } from '@/shadcn/popover';
import { Button } from '@/shadcn/button';
import { Input } from '@/shadcn/input';
import { Label } from '@/shadcn/label';

export default { title: 'Shadcn / Popover' };

export const Default: Story = () => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline">Open dimensions</Button>
    </PopoverTrigger>
    <PopoverContent>
      <div className="flex flex-col gap-3">
        <div>
          <h4 className="text-sm font-medium">Dimensions</h4>
          <p className="text-sm text-sc-muted-foreground">Set the layout dimensions.</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="width" className="w-16">
            Width
          </Label>
          <Input id="width" defaultValue="100%" className="h-8" />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="height" className="w-16">
            Height
          </Label>
          <Input id="height" defaultValue="240px" className="h-8" />
        </div>
      </div>
    </PopoverContent>
  </Popover>
);
