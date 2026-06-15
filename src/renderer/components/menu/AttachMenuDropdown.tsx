import React, { createElement } from 'react';
import { FilePlus, Camera } from 'lucide-react';
import { useScreenshotEnabled } from '../../lib/screenshot/useScreenshotEnabled';
import { useScreenshotHotkey } from '../../lib/screenshot/useScreenshotHotkey';
import { atom } from '@/atom';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shadcn/dropdown-menu';

const zeroState: {
  isOpen: boolean;
  anchorElement: HTMLElement | null;
} = { isOpen: false, anchorElement: null };

export const AttachMenuAtom = atom(zeroState, (get, set) => {
  function close() {
    set(zeroState);
  }

  function toggle(buttonElement: HTMLElement) {
    if (get().isOpen) {
      return set(zeroState);
    }
    set({ isOpen: true, anchorElement: buttonElement });
  }

  return { toggle, close };
});

interface InnerProps {
  anchorElement: HTMLElement;
}

const AttachMenuDropdown: React.FC<InnerProps> = ({ anchorElement }) => {
  const { close: onClose } = AttachMenuAtom.useChange();
  const enableScreenshot = useScreenshotEnabled();
  const screenshotHotkey = useScreenshotHotkey();

  const anchorRect = anchorElement.getBoundingClientRect();

  const handleSelectFiles = () => {
    window.dispatchEvent(new CustomEvent('chatInput:selectFiles'));
  };

  const handleScreenshot = () => {
    window.dispatchEvent(new CustomEvent('chatInput:screenshot'));
  };

  return (
    <DropdownMenu open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          style={{
            position: 'fixed',
            top: anchorRect.top,
            left: anchorRect.left,
            width: anchorRect.width,
            height: 0,
            opacity: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={4}>
        <DropdownMenuItem onClick={handleSelectFiles}>
          <FilePlus size={16} />
          <span>Add files & images</span>
        </DropdownMenuItem>
        {enableScreenshot && (
          <DropdownMenuItem onClick={handleScreenshot}>
            <Camera size={16} />
            <span>
              Add screenshot
              {screenshotHotkey && (
                <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', marginLeft: 6 }}>
                  ({screenshotHotkey})
                </span>
              )}
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default () => {
  const [{ isOpen, anchorElement }] = AttachMenuAtom.use();
  if (!isOpen || !anchorElement) return null;
  return createElement(AttachMenuDropdown, { anchorElement });
};
