import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utilities/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-hidden focus:ring-2 focus:ring-sc-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-sc-primary text-sc-primary-foreground hover:bg-sc-primary/80',
        secondary: 'border-transparent bg-sc-secondary text-sc-secondary-foreground hover:bg-sc-secondary/80',
        destructive: 'border-transparent bg-sc-destructive text-sc-destructive-foreground hover:bg-sc-destructive/80',
        outline: 'text-sc-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
