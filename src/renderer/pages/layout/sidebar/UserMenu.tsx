import { memo } from 'react';
import { Settings, LogIn, RotateCw, MessageSquareText, Hospital } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUpdate } from '@/components/autoUpdate/UpdateProvider';
import { doctorInquiryAtom } from '@/states/doctor.atom';
import { useFeatureFlag } from '@/lib/featureFlags/useFeatureFlag';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/shadcn/dropdown-menu';

function ReportBugItem(props: { onClose: () => void }) {
  const [state, actions] = doctorInquiryAtom.use();
  const doctorEnabled = useFeatureFlag('deskmateFeatureDoctor');

  if (!doctorEnabled) return null;
  if (state.type !== 'idle') return null;

  return (
    <DropdownMenuItem
      onClick={() => {
        props.onClose();
        actions.show();
      }}
    >
      <Hospital size={16} strokeWidth={1.5} />
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
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8}>
        <DropdownMenuItem onClick={onSignIn}>
          <LogIn size={16} strokeWidth={1.5} />
          <span>Sign in to GitHub Copilot</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenSettings}>
          <Settings size={16} strokeWidth={1.5} />
          <span>Settings</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCheckForUpdates}>
          <RotateCw size={16} strokeWidth={1.5} />
          <span>Check Updates</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSendFeedback}>
          <MessageSquareText size={16} strokeWidth={1.5} />
          <span>Send Feedback</span>
        </DropdownMenuItem>
        <ReportBugItem onClose={() => {}} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const UserMenu = memo(Menu);
