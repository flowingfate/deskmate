import * as React from 'react';
import type { Story } from '@ladle/react';
import { Checkbox } from '@/shadcn/checkbox';
import { Label } from '@/shadcn/label';

export default { title: 'Shadcn / Checkbox' };

export const Default: Story = () => {
  const [checked, setChecked] = React.useState<boolean | 'indeterminate'>(false);
  return (
    <div className="flex items-center gap-2">
      <Checkbox id="terms" checked={checked} onCheckedChange={setChecked} />
      <Label htmlFor="terms">Accept terms and conditions</Label>
    </div>
  );
};

export const States: Story = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <Checkbox id="off" />
      <Label htmlFor="off">Unchecked</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="on" defaultChecked />
      <Label htmlFor="on">Checked</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="mixed" checked="indeterminate" />
      <Label htmlFor="mixed">Indeterminate</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="disabled" disabled />
      <Label htmlFor="disabled">Disabled</Label>
    </div>
  </div>
);
