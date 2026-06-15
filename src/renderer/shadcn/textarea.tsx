import * as React from 'react';
import { cn } from '@/lib/utilities/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-sc-input bg-sc-background px-3 py-2 text-sm ring-offset-sc-background placeholder:text-sc-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sc-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export { Textarea };
