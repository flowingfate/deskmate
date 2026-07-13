import React from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';
import { useToast } from '../ui/ToastProvider';
import { appApi } from '@/ipc/app';
import { skillsApi } from '@/ipc/skill';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shadcn/dropdown-menu';
import { DeleteSkillDialogAtom } from '../skills/skillCommands.atom';

interface SkillDropdownMenuProps {
  skillName: string;
  anchorElement: HTMLElement;
  onClose: () => void;
}

const SkillDropdownMenu: React.FC<SkillDropdownMenuProps> = ({
  skillName,
  anchorElement,
  onClose
}) => {
  const { showError } = useToast();
  const [isDev, setIsDev] = React.useState(false);
  React.useEffect(() => {
    const checkDevMode = async () => {
      const devMode = await appApi.isDev();
      setIsDev(devMode);
    };
    checkDevMode();
  }, []);

  const platform = window.electronAPI?.platform || 'darwin';
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';

  const getOpenInExplorerText = () => {
    if (isWindows) {
      return 'Open in File Explorer';
    } else if (isMac) {
      return 'Open in Finder';
    } else {
      return 'Open in File Manager';
    }
  };

  const anchorRect = anchorElement.getBoundingClientRect();

  const requestDeleteSkill = DeleteSkillDialogAtom.useChange().requestDelete;

  const handleDelete = () => {
    void requestDeleteSkill(skillName);
  };

  const handleOpenInExplorer = async () => {
    onClose();

    try {
      if (!skillsApi?.openSkillFolder) {
        showError('Open folder API not available');
        return;
      }

      const result = await skillsApi.openSkillFolder(skillName);

      if (!result.success) {
        showError(`Failed to open folder: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to open folder: ${errorMessage}`);
    }
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
        {isDev && (
          <DropdownMenuItem onClick={handleOpenInExplorer}>
            <FolderOpen size={16} strokeWidth={1.5} />
            <span>{getOpenInExplorerText()}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={handleDelete}>
          <Trash2 size={16} strokeWidth={1.5} />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default SkillDropdownMenu;