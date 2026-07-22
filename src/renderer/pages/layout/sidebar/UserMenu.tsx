import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Check,
  CircleUserRound,
  Hospital,
  Loader2,
  LogIn,
  MessageSquareText,
  PencilLine,
  Plus,
  RotateCw,
  Settings,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUpdate } from '@/components/autoUpdate/UpdateProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { doctorInquiryAtom } from '@/states/doctor.atom';
import { profilesApi, type ProfileListItem, type ProfileWindowState } from '@/ipc/profiles';
import { windowApi } from '@/ipc/window';
import { CreateProfileDialog } from './CreateProfileDialog';
import { ProfileManagerDialog } from './ProfileManagerDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
  children: (currentProfile: ProfileListItem | undefined) => ReactNode;
}

interface ProfileListProps {
  profiles: ProfileListItem[] | undefined;
  loading: boolean;
  loadError: boolean;
  openingProfileId: string | null;
  onOpenProfile: (profileId: string) => void;
  onRetry: () => void;
  onCreate: () => void;
  onManage: () => void;
}

function getProfileWindowAction(windowState: ProfileWindowState): string {
  if (windowState === 'current') return 'This window';
  if (windowState === 'open') return 'Focus window';
  return 'Open window';
}

function ProfileList({
  profiles,
  loading,
  loadError,
  openingProfileId,
  onOpenProfile,
  onRetry,
  onCreate,
  onManage,
}: ProfileListProps) {
  return (
    <>
      <DropdownMenuLabel>Profiles</DropdownMenuLabel>
      {profiles?.map((profile) => {
        const isCurrent = profile.windowState === 'current';
        const isOpening = openingProfileId === profile.id;
        const status = getProfileWindowAction(profile.windowState);

        return (
          <DropdownMenuItem
            key={profile.id}
            disabled={isCurrent || isOpening}
            onSelect={() => onOpenProfile(profile.id)}
          >
            {isCurrent ? <Check aria-hidden="true" /> : <CircleUserRound aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate">{profile.displayName}</span>
            <span className="shrink-0 text-xs text-sc-muted-foreground">
              {isOpening ? <Loader2 className="animate-spin" aria-label="Opening profile" /> : status}
            </span>
          </DropdownMenuItem>
        );
      })}
      {loading && !profiles && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-sc-muted-foreground" role="status">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          Loading profiles…
        </div>
      )}
      {loadError && !profiles && (
        <DropdownMenuItem onSelect={onRetry}>
          <RotateCw aria-hidden="true" />
          <span>Couldn’t load profiles. Retry</span>
        </DropdownMenuItem>
      )}
      {loadError && profiles && (
        <DropdownMenuItem onSelect={onRetry}>
          <RotateCw aria-hidden="true" />
          <span>Refresh profiles</span>
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onCreate}>
        <Plus aria-hidden="true" />
        <span>Create profile…</span>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onManage}>
        <PencilLine size={12} aria-hidden="true" />
        <span>Manage profiles…</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}

function Menu({ children }: UserMenuProps) {
  const { checkForUpdates, showUpdateDialog } = useUpdate();
  const { showError } = useToast();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<ProfileListItem[]>();
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [profilesLoadError, setProfilesLoadError] = useState(false);
  const [openingProfileId, setOpeningProfileId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [profileManagerOpen, setProfileManagerOpen] = useState(false);

  const loadProfiles = useCallback(async () => {
    setLoadingProfiles(true);
    setProfilesLoadError(false);
    try {
      setProfiles(await profilesApi.list());
    } catch {
      setProfilesLoadError(true);
    } finally {
      setLoadingProfiles(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const currentProfile = profiles?.find((profile) => profile.id === window.electronAPI.profile.id);
  const suggestedProfileName = `Profile ${(profiles?.length ?? 0) + 1}`;

  function onOpenSettings() {
  }

  async function onCheckForUpdates() {
    try {
      await checkForUpdates();
      showUpdateDialog();
    } catch {}
  }

  function onSignIn() {
    navigate('/login');
  }

  function onSendFeedback() {
    window.open(GIT_REPO_URL_BASE + '/issues/new', '_blank');
  }

  async function handleOpenProfile(profileId: string): Promise<void> {
    setOpeningProfileId(profileId);
    try {
      await windowApi.openProfile(profileId);
    } catch {
      showError('Couldn’t open the profile. Please try again.');
    } finally {
      setOpeningProfileId(null);
    }
  }

  async function handleCreateProfile(displayName: string) {
    await profilesApi.createAndOpen({ displayName });
    await loadProfiles();
  }

  return (
    <>
      <DropdownMenu onOpenChange={(open) => { if (open) void loadProfiles(); }}>
        <DropdownMenuTrigger asChild>
          {children(currentProfile)}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" sideOffset={8} className="max-h-[320px] w-72 overflow-y-auto">
          <ProfileList
            profiles={profiles}
            loading={loadingProfiles}
            loadError={profilesLoadError}
            openingProfileId={openingProfileId}
            onOpenProfile={(profileId) => { void handleOpenProfile(profileId); }}
            onRetry={() => { void loadProfiles(); }}
            onCreate={() => setCreateDialogOpen(true)}
            onManage={() => setProfileManagerOpen(true)}
          />
          {/* <DropdownMenuItem onClick={onSignIn}>
            <LogIn size={14} strokeWidth={1.5} />
            <span>Sign in</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator /> */}
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
      <CreateProfileDialog
        open={createDialogOpen}
        suggestedName={suggestedProfileName}
        onOpenChange={setCreateDialogOpen}
        onCreate={handleCreateProfile}
      />
      <ProfileManagerDialog
        open={profileManagerOpen}
        onOpenChange={setProfileManagerOpen}
        onRequestCreate={() => setCreateDialogOpen(true)}
        onChanged={loadProfiles}
      />
    </>
  );
}

export const UserMenu = memo(Menu);
