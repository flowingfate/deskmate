import type { Story } from '@ladle/react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import { Input } from '@/shadcn/input';
import { Label } from '@/shadcn/label';

export default { title: 'Shadcn / Dialog' };

export const Default: Story = () => (
  <Dialog>
    <DialogTrigger asChild>
      <Button>Edit profile</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Edit profile</DialogTitle>
        <DialogDescription>
          Make changes to your profile here. Click save when you&apos;re done.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5 py-2">
        <Label htmlFor="dlg-name">Name</Label>
        <Input id="dlg-name" defaultValue="Ada Lovelace" />
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <DialogClose asChild>
          <Button>Save changes</Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
