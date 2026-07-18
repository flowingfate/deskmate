import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import { Input } from '@/shadcn/input';
import type { ProfileManagementItem, ProfileRemovalResult } from '@/ipc/profiles';

interface DeleteProfileDialogProps {
  target: ProfileManagementItem | null;
  onOpenChange: (open: boolean) => void;
  onDelete: (profileId: string, confirmationName: string) => Promise<ProfileRemovalResult>;
}

function blockedMessage(result: Extract<ProfileRemovalResult, { kind: 'blocked' }>): string {
  if (result.reason === 'current') return 'The profile in this window cannot be deleted.';
  if (result.reason === 'open') return 'Close the profile window before deleting it.';
  return 'At least one profile is required.';
}

export function DeleteProfileDialog({ target, onOpenChange, onDelete }: DeleteProfileDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmationName, setConfirmationName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setConfirmationName('');
    setError(null);
  }, [target?.id]);

  function handleOpenChange(open: boolean) {
    if (!submitting) onOpenChange(open);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || confirmationName !== target.displayName) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await onDelete(target.id, confirmationName);
      if (result.kind === 'blocked') {
        setError(blockedMessage(result));
        return;
      }
      onOpenChange(false);
    } catch {
      setError('Couldn’t delete the profile. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" initialFocusRef={inputRef}>
        <DialogHeader>
          <DialogTitle>Delete profile?</DialogTitle>
          <DialogDescription>
            This permanently deletes {target ? `“${target.displayName}”` : 'this profile'}, including its agents,
            conversations, schedules, MCP credentials, and local files. Any background work will stop.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-2" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-sc-foreground" htmlFor="profile-delete-confirmation">
            Type {target ? `“${target.displayName}”` : 'the profile name'} to confirm
          </label>
          <Input
            ref={inputRef}
            id="profile-delete-confirmation"
            value={confirmationName}
            disabled={submitting}
            aria-describedby={error ? 'profile-delete-error' : undefined}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setConfirmationName(event.target.value);
              if (error) setError(null);
            }}
          />
          {error && <p id="profile-delete-error" role="alert" className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="pt-4">
            <Button size="sm" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" disabled={submitting || confirmationName !== target?.displayName}>
              {submitting && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
              Delete profile
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
