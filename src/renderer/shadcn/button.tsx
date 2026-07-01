import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utilities/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-sc-background transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sc-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-sc-primary text-sc-primary-foreground hover:bg-sc-primary/90',
        destructive: 'bg-sc-destructive text-sc-destructive-foreground hover:bg-sc-destructive/90',
        outline: 'border border-sc-input bg-sc-background hover:bg-sc-accent hover:text-sc-accent-foreground',
        secondary: 'bg-sc-secondary text-sc-secondary-foreground hover:bg-sc-secondary/80',
        ghost: 'hover:bg-sc-accent hover:text-sc-accent-foreground',
        link: 'text-sc-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
        'icon-xs': 'h-6 w-6',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';

export { Button, buttonVariants };
