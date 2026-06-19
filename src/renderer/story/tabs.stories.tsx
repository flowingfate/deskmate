import type { Story } from '@ladle/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shadcn/tabs';

export default { title: 'Shadcn / Tabs' };

export const Default: Story = () => (
  <Tabs defaultValue="account" className="w-96">
    <TabsList>
      <TabsTrigger value="account">Account</TabsTrigger>
      <TabsTrigger value="password">Password</TabsTrigger>
      <TabsTrigger value="disabled" disabled>
        Disabled
      </TabsTrigger>
    </TabsList>
    <TabsContent value="account" className="text-sm text-sc-muted-foreground">
      Manage your account settings here.
    </TabsContent>
    <TabsContent value="password" className="text-sm text-sc-muted-foreground">
      Change your password here.
    </TabsContent>
  </Tabs>
);
