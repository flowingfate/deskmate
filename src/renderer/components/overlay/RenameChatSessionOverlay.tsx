import { atom } from '@/atom';
import { persistApi } from '@/ipc/persist';
import { useToast, type ToastContextType } from '../ui/ToastProvider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';

interface State {
  isOpen: boolean;
  agentId: string | null;
  sessionId: string | null;
  newTitle: string;
}

const zeroState: State = {
  isOpen: false,
  agentId: null,
  sessionId: null,
  newTitle: '',
};

export const RenameChatSessionAtom = atom(zeroState, (get, set) => {
  function cancel() {
    set(zeroState);
  }

  function show(agentId: string, sessionId: string, title: string) {
    set({ isOpen: true, agentId, sessionId, newTitle: title });
  }

  function setNewTitle(newTitle: string) {
    set({ ...get(), newTitle });
  }

  async function confirm(toast: ToastContextType) {
    const { agentId, sessionId, newTitle } = get();

    if (!agentId || !sessionId || !newTitle.trim()) return;

    try {
      const result = await persistApi.renameSession(
        agentId,
        sessionId,
        newTitle.trim(),
      );

      if (result?.success) {
        toast.showSuccess('Chat session renamed successfully');
      } else {
        toast.showError(result?.error || 'Failed to rename chat session');
      }
    } catch (error) {
      toast.showError('Failed to rename chat session');
    } finally {
      set(zeroState);
    }
  }

  return { cancel, confirm, show, setNewTitle };
});

export function RenameChatSessionOverlay() {
  const [state, actions] = RenameChatSessionAtom.use();
  const toast = useToast();

  return (
    <Dialog open={state.isOpen} onOpenChange={(open) => { if (!open) actions.cancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Chat Session</DialogTitle>
          <DialogDescription>
            Enter a new name for this chat session
          </DialogDescription>
        </DialogHeader>
        <div>
          <input
            type="text"
            className="mt-3 w-full rounded-lg border border-sc-border bg-sc-background px-3 py-2.5 text-sm text-sc-foreground focus:outline-none focus:ring-2 focus:ring-sc-ring"
            value={state.newTitle}
            onChange={(e) => actions.setNewTitle(e.target.value)}
            placeholder="Enter session name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && state.newTitle.trim()) {
                actions.confirm(toast);
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={actions.cancel}>
            Cancel
          </Button>
          <Button
            onClick={() => actions.confirm(toast)}
            disabled={!state.newTitle.trim()}
          >
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
