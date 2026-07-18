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

interface CreateProfileDialogProps {
  open: boolean;
  suggestedName: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (displayName: string) => Promise<void>;
}

export function CreateProfileDialog({
  open,
  suggestedName,
  onOpenChange,
  onCreate,
}: CreateProfileDialogProps) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const [displayName, setDisplayName] = useState(suggestedName);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setDisplayName(suggestedName);
      setError(null);
    }
    wasOpenRef.current = open;
  }, [open, suggestedName]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = displayName.trim();
    if (!normalizedName) {
      setError('Enter a profile name.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onCreate(normalizedName);
      onOpenChange(false);
    } catch {
      setError('Couldn’t create the profile. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!submitting) onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" initialFocusRef={nameInputRef}>
        <DialogHeader>
          <DialogTitle>New profile</DialogTitle>
          <DialogDescription>
            Create an independent workspace. It will open in a new window.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-2" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-sc-foreground" htmlFor="profile-display-name">
            Profile name
          </label>
          <Input
            ref={nameInputRef}
            id="profile-display-name"
            value={displayName}
            maxLength={80}
            disabled={submitting}
            aria-describedby={error ? 'profile-display-name-error' : undefined}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setDisplayName(event.target.value);
              if (error) setError(null);
            }}
          />
          {error && (
            <p id="profile-display-name-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="pt-4">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {submitting ? 'Creating…' : 'Create profile'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
