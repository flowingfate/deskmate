import { useRef } from 'react';
import { atom } from '@/atom';
import { duplicateAgent } from '@renderer/lib/chat/agentOps';
import { useToast, type ToastContextType } from '../ui/ToastProvider';
import { useAgents } from '@/states/agents.atom';
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
  agentName: string | null;
  newName: string;
}

const zeroState: State = {
  isOpen: false,
  agentId: null,
  agentName: null,
  newName: '',
};

export const DuplicateAgentAtom = atom(zeroState, (get, set) => {
  function cancel() {
    set(zeroState);
  }

  function show(agentId: string, agentName: string) {
    set({ isOpen: true, agentId, agentName, newName: `${agentName} Copy` });
  }

  function setNewName(newName: string) {
    set({ ...get(), newName });
  }

  async function confirm(toast: ToastContextType) {
    const { agentId, newName } = get();

    if (!agentId || !newName.trim()) {
      toast.showError('Invalid agent data for duplication');
      set(zeroState);
      return;
    }

    try {
      const result = await duplicateAgent(agentId, newName.trim());

      if (result.success) {
        const warnings: string[] = [];
        if (result.data?.knowledgeCopyFailed) warnings.push('knowledge files');
        if (result.data?.scheduleCopyFailed) warnings.push('scheduled tasks');

        if (warnings.length > 0) {
          toast.showWarning(`Agent "${newName.trim()}" created, but ${warnings.join(' and ')} could not be copied.`);
        } else {
          toast.showSuccess(`Agent "${newName.trim()}" created successfully!`);
        }
        set(zeroState);
        // agents.atom 订阅 persist:agent:updated 自动刷新
      } else {
        toast.showError(result.error || 'Failed to duplicate agent');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.showError(`Failed to duplicate agent: ${errorMessage}`);
    }
  }

  return { cancel, confirm, show, setNewName };
});

export function DuplicateAgentOverlay() {
  const [state, actions] = DuplicateAgentAtom.use();
  const toast = useToast();
  const agents = useAgents();
  const nameInputRef = useRef<HTMLInputElement>(null);

  const isDuplicateNameExists = state.newName.trim()
    ? agents.some(agent => agent.name?.toLowerCase() === state.newName.trim().toLowerCase())
    : false;

  return (
    <Dialog open={state.isOpen} onOpenChange={(open) => { if (!open) actions.cancel(); }}>
      <DialogContent className="max-w-md" initialFocusRef={nameInputRef}>
        <DialogHeader>
          <DialogTitle>Duplicate Agent</DialogTitle>
          <DialogDescription>
            Enter a name for the copy of <strong>{state.agentName}</strong>
          </DialogDescription>
        </DialogHeader>
        <div>
          <input
            ref={nameInputRef}
            type="text"
            className={`mt-3 w-full rounded-lg border border-sc-border bg-sc-background px-3 py-2.5 text-sm text-sc-foreground focus:outline-none focus:ring-2 focus:ring-sc-ring ${isDuplicateNameExists ? 'border-yellow-500 bg-yellow-50' : ''}`}
            value={state.newName}
            onChange={(e) => actions.setNewName(e.target.value)}
            placeholder="Enter new agent name"
          />
          {isDuplicateNameExists && (
            <p className="mt-2 text-sm text-yellow-600">⚠️ Agent name already exists</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={actions.cancel}>
            Cancel
          </Button>
          <Button
            onClick={() => actions.confirm(toast)}
            disabled={!state.newName.trim() || isDuplicateNameExists}
          >
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
