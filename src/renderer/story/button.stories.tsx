import type { Story } from '@ladle/react';
import { Search, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/shadcn/button';

export default { title: 'Shadcn / Button' };

const variants = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const;
const sizes = ['default', 'sm', 'lg'] as const;

export const Variants: Story = () => (
  <div className="flex flex-wrap items-center gap-3">
    {variants.map((variant) => (
      <Button key={variant} variant={variant}>
        {variant}
      </Button>
    ))}
  </div>
);

export const Sizes: Story = () => (
  <div className="flex flex-wrap items-center gap-3">
    {sizes.map((size) => (
      <Button key={size} size={size}>
        size: {size}
      </Button>
    ))}
  </div>
);

export const IconSizes: Story = () => (
  <div className="flex items-center gap-3">
    <Button size="icon" aria-label="search">
      <Search className="h-4 w-4" />
    </Button>
    <Button size="icon-sm" variant="secondary" aria-label="search">
      <Search className="h-4 w-4" />
    </Button>
    <Button size="icon-xs" variant="ghost" aria-label="search">
      <Search className="h-3.5 w-3.5" />
    </Button>
  </div>
);

export const WithIcon: Story = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button>
      <Search className="mr-2 h-4 w-4" /> Search
    </Button>
    <Button variant="secondary">
      Continue <ArrowRight className="ml-2 h-4 w-4" />
    </Button>
    <Button disabled>
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading
    </Button>
  </div>
);

export const Disabled: Story = () => (
  <div className="flex flex-wrap items-center gap-3">
    {variants.map((variant) => (
      <Button key={variant} variant={variant} disabled>
        {variant}
      </Button>
    ))}
  </div>
);

export const AsLink: Story = () => (
  <Button asChild>
    <a href="#" onClick={(e) => e.preventDefault()}>
      Rendered as anchor
    </a>
  </Button>
);
