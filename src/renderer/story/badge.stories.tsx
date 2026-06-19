import type { Story } from '@ladle/react';
import { Badge } from '@/shadcn/badge';

export default { title: 'Shadcn / Badge' };

const variants = ['default', 'secondary', 'destructive', 'outline'] as const;

export const Variants: Story = () => (
  <div className="flex flex-wrap items-center gap-3">
    {variants.map((variant) => (
      <Badge key={variant} variant={variant}>
        {variant}
      </Badge>
    ))}
  </div>
);

export const WithContent: Story = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Badge>New</Badge>
    <Badge variant="secondary">v2.7.10</Badge>
    <Badge variant="destructive">Deprecated</Badge>
    <Badge variant="outline">12 runs</Badge>
  </div>
);
