import { useCallback, useEffect, useState } from 'react';
import { CircleUserRound, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import { Input } from '@/shadcn/input';
import { useToast } from '@/components/ui/ToastProvider';
import {
  profilesApi,
  type ProfileManagementItem,
  type ProfileRemovalResult,
} from '@/ipc/profiles';
import { DeleteProfileDialog } from './DeleteProfileDialog';

interface ProfileManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestCreate: () => void;
  onChanged: () => Promise<void>;
}

interface ProfileRowProps {
  profile: ProfileManagementItem;
  editing: boolean;
  draftName: string;
  saving: boolean;
  onBeginEdit: (profile: ProfileManagementItem) => void;
  onDraftNameChange: (value: string) => void;
  onSave: (profileId: string) => void;
  onCancelEdit: () => void;
  onDelete: (profile: ProfileManagementItem) => void;
}

interface ProfileListContentProps {
  profiles: ProfileManagementItem[] | undefined;
  loading: boolean;
  loadError: boolean;
  editingId: string | null;
  draftName: string;
  savingId: string | null;
  onRetry: () => void;
  onBeginEdit: (profile: ProfileManagementItem) => void;
  onDraftNameChange: (value: string) => void;
  onSave: (profileId: string) => void;
  onCancelEdit: () => void;
  onDelete: (profile: ProfileManagementItem) => void;
}

function profileStatus(profile: ProfileManagementItem): string {
  if (profile.windowState === 'current') return 'This window';
  if (profile.windowState === 'open') return 'Open elsewhere';
  return 'Closed';
}

function removalHint(profile: ProfileManagementItem): string | null {
  if (profile.removal.kind === 'allowed') return null;
  if (profile.removal.reason === 'current') return 'The profile in this window can’t be deleted.';
  if (profile.removal.reason === 'open') return 'Close its window before deleting.';
  return 'At least one profile is required.';
}

function ProfileRow({
  profile,
  editing,
  draftName,
  saving,
  onBeginEdit,
  onDraftNameChange,
  onSave,
  onCancelEdit,
  onDelete,
}: ProfileRowProps) {
  const hint = removalHint(profile);

  return (
    <div className="flex gap-3 border-b border-sc-border py-4 last:border-b-0">
      <CircleUserRound size={16} className="mt-0.5 shrink-0 text-sc-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              value={draftName}
              maxLength={80}
              disabled={saving}
              aria-label="Profile name"
              onChange={(event) => onDraftNameChange(event.target.value)}
            />
            <Button size="sm" disabled={saving || !draftName.trim()} onClick={() => onSave(profile.id)}>
              {saving && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={onCancelEdit}>Cancel</Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-sc-foreground">{profile.displayName}</span>
            <span className="shrink-0 text-xs text-sc-muted-foreground">{profileStatus(profile)}</span>
          </div>
        )}
        <p className="mt-1 text-xs text-sc-muted-foreground">
          {profile.kind === 'signed_in' ? 'Signed-in profile' : 'Guest profile'} · Created {new Date(profile.createdAt).toLocaleDateString()}
        </p>
        {hint && <p className="mt-1 text-xs text-sc-muted-foreground">{hint}</p>}
      </div>
      {!editing && (
        <div className="flex shrink-0 items-start gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => onBeginEdit(profile)} aria-label={`Edit ${profile.displayName}`} title="Edit profile name">
            <Pencil size={13} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            disabled={profile.removal.kind !== 'allowed'}
            onClick={() => onDelete(profile)}
            aria-label={`Delete ${profile.displayName}`}
            title={hint ?? 'Delete profile'}
          >
            <Trash2 size={13} aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}

function ProfileListContent({
  profiles,
  loading,
  loadError,
  editingId,
  draftName,
  savingId,
  onRetry,
  onBeginEdit,
  onDraftNameChange,
  onSave,
  onCancelEdit,
  onDelete,
}: ProfileListContentProps) {
  if (loading && !profiles) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-sc-muted-foreground" role="status">
        <Loader2 size={12} className="animate-spin" aria-hidden="true" />
        Loading profiles…
      </div>
    );
  }

  if (loadError && !profiles) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-sm text-sc-muted-foreground" role="alert">
        <span>Couldn’t load profiles.</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw size={12} aria-hidden="true" />
          Retry
        </Button>
      </div>
    );
  }

  return profiles?.map((profile) => (
    <ProfileRow
      key={profile.id}
      profile={profile}
      editing={editingId === profile.id}
      draftName={draftName}
      saving={savingId === profile.id}
      onBeginEdit={onBeginEdit}
      onDraftNameChange={onDraftNameChange}
      onSave={onSave}
      onCancelEdit={onCancelEdit}
      onDelete={onDelete}
    />
  ));
}

function ProfileManagerFooter({
  loading,
  onRefresh,
  onRequestCreate,
}: {
  loading: boolean;
  onRefresh: () => void;
  onRequestCreate: () => void;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-sc-border px-6 py-4">
      <Button size="sm" variant="outline" className="gap-1" disabled={loading} onClick={onRefresh}>
        <RefreshCw size={12} aria-hidden="true" />
        Refresh
      </Button>
      <Button size="sm" className="gap-1" onClick={onRequestCreate}>
        <Plus size={12} aria-hidden="true" />
        New profile
      </Button>
    </div>
  );
}

export function ProfileManagerDialog({
  open,
  onOpenChange,
  onRequestCreate,
  onChanged,
}: ProfileManagerDialogProps) {
  const { showError, showSuccess } = useToast();
  const [profiles, setProfiles] = useState<ProfileManagementItem[]>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProfileManagementItem | null>(null);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setProfiles(await profilesApi.listManaged());
    } catch {
      setLoadError(true);
      showError('Couldn’t load profiles. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    if (open) void loadProfiles();
  }, [loadProfiles, open]);

  function beginEdit(profile: ProfileManagementItem) {
    setEditingId(profile.id);
    setDraftName(profile.displayName);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftName('');
  }

  async function saveEdit(profileId: string) {
    const displayName = draftName.trim();
    if (!displayName) return;

    setSavingId(profileId);
    try {
      const updated = await profilesApi.updateMetadata({ profileId, displayName });
      setProfiles((current) => current?.map((profile) => profile.id === profileId ? updated : profile));
      cancelEdit();
      await onChanged();
      showSuccess('Profile name updated.');
    } catch {
      showError('Couldn’t update the profile name. Please try again.');
    } finally {
      setSavingId(null);
    }
  }

  async function deleteProfile(profileId: string, confirmationName: string): Promise<ProfileRemovalResult> {
    const result = await profilesApi.delete({ profileId, confirmationName });
    if (result.kind === 'deleted') {
      setProfiles((current) => current?.filter((profile) => profile.id !== profileId));
      await onChanged();
      showSuccess('Profile deleted.');
    } else {
      await loadProfiles();
    }
    return result;
  }

  function handleRequestCreate() {
    onOpenChange(false);
    onRequestCreate();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl p-0">
          <DialogHeader className="border-b border-sc-border px-6 py-5 pr-14">
            <DialogTitle>Manage profiles</DialogTitle>
            <DialogDescription>Profiles are independent workspaces with separate agents, conversations, and credentials.</DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
            <ProfileListContent
              profiles={profiles}
              loading={loading}
              loadError={loadError}
              editingId={editingId}
              draftName={draftName}
              savingId={savingId}
              onRetry={() => { void loadProfiles(); }}
              onBeginEdit={beginEdit}
              onDraftNameChange={setDraftName}
              onSave={(profileId) => { void saveEdit(profileId); }}
              onCancelEdit={cancelEdit}
              onDelete={setDeleteTarget}
            />
          </div>

          <ProfileManagerFooter
            loading={loading}
            onRefresh={() => { void loadProfiles(); }}
            onRequestCreate={handleRequestCreate}
          />
        </DialogContent>
      </Dialog>
      <DeleteProfileDialog
        target={deleteTarget}
        onOpenChange={(nextOpen) => { if (!nextOpen) setDeleteTarget(null); }}
        onDelete={deleteProfile}
      />
    </>
  );
}
