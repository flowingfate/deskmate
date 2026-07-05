import React from 'react';
import { Plus, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shadcn/dropdown-menu';
import { SubAgentImportAtom } from '@/components/subAgents/subAgentCommands.atom';

interface SubAgentsAddMenuDropdownProps {
  anchorElement: HTMLElement;
  onClose: () => void;
}

const SubAgentsAddMenuDropdown: React.FC<SubAgentsAddMenuDropdownProps> = ({
  anchorElement,
  onClose,
}) => {
  const navigate = useNavigate();

  const anchorRect = anchorElement.getBoundingClientRect();

  const openImport = SubAgentImportAtom.useChange().open;
  const handleImportFromClaudeCode = () => {
    openImport();
  };

  const handleCreateCustom = () => {
    navigate('/settings/sub-agents/new');
  };


  return (
    <DropdownMenu open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          style={{
            position: 'fixed',
            top: anchorRect.bottom,
            left: anchorRect.left,
            width: anchorRect.width,
            height: 0,
            opacity: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4}>
        <DropdownMenuItem onClick={handleCreateCustom}>
          <Plus size={16} strokeWidth={1.5} />
          <span>Create Custom</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleImportFromClaudeCode}>
          <Upload size={16} strokeWidth={1.5} />
          <span>Import from AGENT.md (Claude Code)</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default SubAgentsAddMenuDropdown;
