import React, { createElement } from 'react';
import { SlidersHorizontal, CheckCircle, SquarePen } from 'lucide-react';
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

export const EditAgentMenuAtom = atom(zeroState, (get, set) => {
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

const EditAgentMenuDropdown: React.FC<InnerProps> = ({ anchorElement }) => {
  const { close: onClose } = EditAgentMenuAtom.useChange();

  const anchorRect = anchorElement.getBoundingClientRect();

  const handleSelectMcpTools = () => {
    window.dispatchEvent(new CustomEvent('agent:editAgent', {
      detail: {
        agentId: null,
        initialTab: 'mcp'
      }
    }));
  };

  const handleSelectSkills = () => {
    window.dispatchEvent(new CustomEvent('agent:editAgent', {
      detail: {
        agentId: null,
        initialTab: 'skills'
      }
    }));
  };

  const handleEditSystemPrompt = () => {
    window.dispatchEvent(new CustomEvent('agent:editAgent', {
      detail: {
        agentId: null,
        initialTab: 'prompt'
      }
    }));
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
        <DropdownMenuItem onClick={handleSelectMcpTools}>
          <SlidersHorizontal size={16} />
          <span>Select MCP Tools</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSelectSkills}>
          <CheckCircle size={16} />
          <span>Select Skills</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleEditSystemPrompt}>
          <SquarePen size={16} />
          <span>Edit System Prompt</span>
        </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default () => {
  const [{ isOpen, anchorElement }] = EditAgentMenuAtom.use();
  if (!isOpen || !anchorElement) return null;
  return createElement(EditAgentMenuDropdown, { anchorElement });
};
