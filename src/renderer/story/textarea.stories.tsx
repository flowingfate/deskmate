import type { Story } from '@ladle/react';
import { Textarea } from '@/shadcn/textarea';
import { Label } from '@/shadcn/label';

export default { title: 'Shadcn / Textarea' };

export const Default: Story = () => (
  <Textarea className="w-80" placeholder="Write your message…" />
);

export const Disabled: Story = () => (
  <Textarea className="w-80" placeholder="disabled" disabled />
);

export const WithLabel: Story = () => (
  <div className="flex w-80 flex-col gap-1.5">
    <Label htmlFor="bio">Bio</Label>
    <Textarea id="bio" placeholder="Tell us about yourself" rows={5} />
  </div>
);
