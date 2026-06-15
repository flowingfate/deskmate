import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Import } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shadcn/dropdown-menu';

interface McpAddMenuDropdownProps {
  anchorElement: HTMLElement;
  onClose: () => void;
}

const McpAddMenuDropdown: React.FC<McpAddMenuDropdownProps> = ({
  anchorElement,
  onClose
}) => {
  const navigate = useNavigate();

  const anchorRect = anchorElement.getBoundingClientRect();

  const handleNewServer = () => {
    navigate('/settings/mcp/new');
  };

  const handleImportMcpServers = () => {
    navigate('/settings/mcp/import-config');
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
        <DropdownMenuItem onClick={handleNewServer}>
          <Plus size={16} strokeWidth={1.5} />
          <span>New Server</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleImportMcpServers}>
          <Import size={16} strokeWidth={1.5} />
          <span>Import MCP servers</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default McpAddMenuDropdown;