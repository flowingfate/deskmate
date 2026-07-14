import React, { useEffect, useState } from 'react';
import { FolderOpen, MoreHorizontal, Trash2 } from 'lucide-react';
import { appApi } from '@/ipc/app';
import { skillsApi } from '@/ipc/skill';
import { Button } from '@/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shadcn/dropdown-menu';
import { useToast } from '../ui/ToastProvider';
import { DeleteSkillDialogAtom } from './skillCommands.atom';

interface SkillDropdownMenuProps {
  skillName: string;
}

function getOpenInExplorerText(platform: string): string {
  if (platform === 'win32') return 'Open in File Explorer';
  if (platform === 'darwin') return 'Open in Finder';
  return 'Open in File Manager';
}

const SkillDropdownMenu: React.FC<SkillDropdownMenuProps> = ({ skillName }) => {
  const { showError } = useToast();
  const requestDelete = DeleteSkillDialogAtom.useChange().requestDelete;
  const [isDev, setIsDev] = useState(false);
  const platform = window.electronAPI?.platform || 'darwin';

  useEffect(() => {
    void appApi.isDev().then(setIsDev);
  }, []);

  const handleOpenInExplorer = async (): Promise<void> => {
    try {
      const result = await skillsApi.openSkillFolder(skillName);
      if (!result.success) {
        showError(`Failed to open folder: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to open folder: ${message}`);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${skillName}`}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal size={15} strokeWidth={1.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        {isDev && (
          <DropdownMenuItem onSelect={() => void handleOpenInExplorer()}>
            <FolderOpen size={16} strokeWidth={1.5} />
            <span>{getOpenInExplorerText(platform)}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="text-red-600 focus:text-red-600"
          onSelect={() => void requestDelete(skillName)}
        >
          <Trash2 size={16} strokeWidth={1.5} />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default SkillDropdownMenu;
