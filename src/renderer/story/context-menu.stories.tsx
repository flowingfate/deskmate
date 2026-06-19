import type { Story } from '@ladle/react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/shadcn/context-menu';

export default { title: 'Shadcn / ContextMenu' };

export const Default: Story = () => (
  <ContextMenu>
    <ContextMenuTrigger className="flex h-40 w-80 items-center justify-center rounded-md border border-dashed border-sc-border text-sm text-sc-muted-foreground">
      Right click here
    </ContextMenuTrigger>
    <ContextMenuContent className="w-56">
      <ContextMenuLabel>Actions</ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuItem>
        Back
        <ContextMenuShortcut>⌘[</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem>
        Forward
        <ContextMenuShortcut>⌘]</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem inset disabled>
        Reload
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger inset>More tools</ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-44">
          <ContextMenuItem>Save page as…</ContextMenuItem>
          <ContextMenuItem>Create shortcut…</ContextMenuItem>
          <ContextMenuItem>Developer tools</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </ContextMenuContent>
  </ContextMenu>
);
