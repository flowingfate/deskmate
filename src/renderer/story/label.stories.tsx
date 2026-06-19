import type { Story } from '@ladle/react';
import { Label } from '@/shadcn/label';
import { Input } from '@/shadcn/input';

export default { title: 'Shadcn / Label' };

export const Default: Story = () => <Label>Username</Label>;

export const WithControl: Story = () => (
  <div className="flex w-72 flex-col gap-1.5">
    <Label htmlFor="name">Display name</Label>
    <Input id="name" placeholder="Ada Lovelace" />
  </div>
);
