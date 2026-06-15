import * as React from 'react';
import { cn } from '@/lib/utilities/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-sc-input bg-sc-background px-3 py-2 text-sm ring-offset-sc-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-sc-foreground placeholder:text-sc-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sc-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export { Input };
