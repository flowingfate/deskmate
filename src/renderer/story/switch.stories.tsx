import * as React from 'react';
import type { Story } from '@ladle/react';
import { Switch } from '@/shadcn/switch';
import { Label } from '@/shadcn/label';

export default { title: 'Shadcn / Switch' };

export const Default: Story = () => {
  const [on, setOn] = React.useState(false);
  return (
    <div className="flex items-center gap-2">
      <Switch id="airplane" checked={on} onCheckedChange={setOn} />
      <Label htmlFor="airplane">Airplane mode {on ? 'on' : 'off'}</Label>
    </div>
  );
};

export const States: Story = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <Switch id="s-off" />
      <Label htmlFor="s-off">Off</Label>
    </div>
    <div className="flex items-center gap-2">
      <Switch id="s-on" defaultChecked />
      <Label htmlFor="s-on">On</Label>
    </div>
    <div className="flex items-center gap-2">
      <Switch id="s-disabled" disabled />
      <Label htmlFor="s-disabled">Disabled</Label>
    </div>
  </div>
);
