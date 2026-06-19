import type { Story } from '@ladle/react';
import { Separator } from '@/shadcn/separator';

export default { title: 'Shadcn / Separator' };

export const Horizontal: Story = () => (
  <div className="w-72">
    <div className="text-sm font-medium">Deskmate</div>
    <div className="text-sm text-sc-muted-foreground">AI Studio</div>
    <Separator className="my-3" />
    <div className="text-sm text-sc-muted-foreground">Footer content</div>
  </div>
);

export const Vertical: Story = () => (
  <div className="flex h-6 items-center gap-3 text-sm">
    <span>Profile</span>
    <Separator orientation="vertical" />
    <span>Agents</span>
    <Separator orientation="vertical" />
    <span>Settings</span>
  </div>
);
