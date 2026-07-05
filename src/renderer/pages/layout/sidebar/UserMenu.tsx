import { memo } from 'react';
import { Settings, LogIn, RotateCw, MessageSquareText, Hospital } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUpdate } from '@/components/autoUpdate/UpdateProvider';
import { doctorInquiryAtom } from '@/states/doctor.atom';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/shadcn/dropdown-menu';
import { GIT_REPO_URL_BASE } from '@shared/constants/endpoints';

function ReportBugItem(props: { onClose: () => void }) {
  const [state, actions] = doctorInquiryAtom.use();

  if (state.type !== 'idle') return null;

  return (
    <DropdownMenuItem
      onClick={() => {
        props.onClose();
        actions.show();
      }}
    >
      <Hospital size={14} strokeWidth={1.5} />
      <span>Report Bug</span>
    </DropdownMenuItem>
  );
}

interface UserMenuProps {
  children: React.ReactNode;
}

function Menu({ children }: UserMenuProps) {
  const { checkForUpdates, showUpdateDialog } = useUpdate();
  const navigate = useNavigate();

  function onOpenSettings() {
  }

  async function onCheckForUpdates() {
    try {
      await checkForUpdates();
      showUpdateDialog();
    } catch (error) {}
  }

  function onSignIn() {
    navigate('/login');
  }

  function onSendFeedback() {
    window.open(GIT_REPO_URL_BASE + '/issues/new', '_blank');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8}>
        <DropdownMenuItem onClick={onSignIn}>
          <LogIn size={14} strokeWidth={1.5} />
          <span>Sign in</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenSettings}>
          <Settings size={14} strokeWidth={1.5} />
          <span>Settings</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCheckForUpdates}>
          <RotateCw size={14} strokeWidth={1.5} />
          <span>Check Updates</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSendFeedback}>
          <MessageSquareText size={14} strokeWidth={1.5} />
          <span>Send Feedback</span>
        </DropdownMenuItem>
        <ReportBugItem onClose={() => {}} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const UserMenu = memo(Menu);
