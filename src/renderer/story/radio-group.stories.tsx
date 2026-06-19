import type { Story } from '@ladle/react';
import { RadioGroup, RadioGroupItem } from '@/shadcn/radio-group';
import { Label } from '@/shadcn/label';

export default { title: 'Shadcn / RadioGroup' };

export const Default: Story = () => (
  <RadioGroup defaultValue="comfortable">
    {[
      { value: 'default', label: 'Default' },
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'compact', label: 'Compact' },
    ].map((opt) => (
      <div key={opt.value} className="flex items-center gap-2">
        <RadioGroupItem value={opt.value} id={opt.value} />
        <Label htmlFor={opt.value}>{opt.label}</Label>
      </div>
    ))}
  </RadioGroup>
);

export const Disabled: Story = () => (
  <RadioGroup defaultValue="a" disabled>
    <div className="flex items-center gap-2">
      <RadioGroupItem value="a" id="r-a" />
      <Label htmlFor="r-a">Option A</Label>
    </div>
    <div className="flex items-center gap-2">
      <RadioGroupItem value="b" id="r-b" />
      <Label htmlFor="r-b">Option B</Label>
    </div>
  </RadioGroup>
);
