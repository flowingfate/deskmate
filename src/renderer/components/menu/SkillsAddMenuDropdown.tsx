import React from 'react';
import { FolderPlus, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shadcn/dropdown-menu';
import { useAddSkillFromDevice } from '../skills/useAddSkillFromDevice';

interface SkillsAddMenuDropdownProps {
  anchorElement: HTMLElement;
  onClose: () => void;
}

const SkillsAddMenuDropdown: React.FC<SkillsAddMenuDropdownProps> = ({
  anchorElement,
  onClose
}) => {
  const anchorRect = anchorElement.getBoundingClientRect();

  const addSkillFromDevice = useAddSkillFromDevice();

  const handleAddFromDeviceArtifact = () => {
    void addSkillFromDevice('artifact');
  };

  const handleAddFromDeviceFolder = () => {
    void addSkillFromDevice('folder');
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
        <DropdownMenuItem onClick={handleAddFromDeviceArtifact}>
          <Plus size={16} strokeWidth={1.5} />
          <span>Add from Device (.zip/.skill)</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleAddFromDeviceFolder}>
          <FolderPlus size={16} strokeWidth={1.5} />
          <span>Add from Device (folder)</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default SkillsAddMenuDropdown;