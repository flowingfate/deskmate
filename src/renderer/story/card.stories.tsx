import type { Story } from '@ladle/react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/shadcn/card';
import { Button } from '@/shadcn/button';

export default { title: 'Shadcn / Card' };

export const Default: Story = () => (
  <Card className="w-80">
    <CardHeader>
      <CardTitle>Create project</CardTitle>
      <CardDescription>Deploy your new project in one click.</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-sm text-sc-muted-foreground">
        Configure the runtime, attach tools and let the agent take over.
      </p>
    </CardContent>
    <CardFooter className="justify-end gap-2">
      <Button variant="ghost">Cancel</Button>
      <Button>Deploy</Button>
    </CardFooter>
  </Card>
);

export const ContentOnly: Story = () => (
  <Card className="w-80">
    <CardContent className="pt-6 text-sm">A minimal card with body only.</CardContent>
  </Card>
);
