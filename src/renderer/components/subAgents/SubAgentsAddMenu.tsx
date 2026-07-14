import React from 'react';
import { Plus, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shadcn/dropdown-menu';

interface SubAgentsAddMenuProps {
  onImport: () => void;
}

const SubAgentsAddMenu: React.FC<SubAgentsAddMenuProps> = ({ onImport }) => {
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Add Sub-Agent" aria-label="Add Sub-Agent">
          <Plus size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        <DropdownMenuItem onSelect={() => navigate('/settings/sub-agents/new')}>
          <Plus size={16} strokeWidth={1.5} />
          <span>Create Custom</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onImport}>
          <Upload size={16} strokeWidth={1.5} />
          <span>Import from AGENT.md (Claude Code)</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default SubAgentsAddMenu;
