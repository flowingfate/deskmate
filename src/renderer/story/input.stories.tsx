import type { Story } from '@ladle/react';
import { Input } from '@/shadcn/input';
import { Label } from '@/shadcn/label';

export default { title: 'Shadcn / Input' };

export const Default: Story = () => <Input placeholder="Type something…" className="w-72" />;

export const Types: Story = () => (
  <div className="flex w-72 flex-col gap-3">
    <Input type="text" placeholder="text" />
    <Input type="email" placeholder="email@example.com" />
    <Input type="password" placeholder="password" />
    <Input type="number" placeholder="42" />
    <Input type="file" />
  </div>
);

export const Disabled: Story = () => (
  <Input className="w-72" placeholder="disabled" disabled />
);

export const WithLabel: Story = () => (
  <div className="flex w-72 flex-col gap-1.5">
    <Label htmlFor="email">Email</Label>
    <Input id="email" type="email" placeholder="email@example.com" />
  </div>
);
