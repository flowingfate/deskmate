import type { SubrunId } from '@shared/persist/types';
import { Button } from '@/shadcn/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from '@/shadcn/dialog';
import { RunMessagesContent } from './RunMessagesContent';
import { RunMessagesHeader } from './RunMessagesHeader';
import { useRunMessages } from './useRunMessages';

interface SubagentRunMessagesDialogProps {
  agentId: string;
  sessionId: string;
  subrunId: SubrunId;
  agentName: string;
  status: string;
  task: string | null;
  expectedOutput: string | null;
  durationMs: number | undefined;
  usage: { tokenUsage?: { total: number } } | null;
  deliverables: string[];
  turns: number;
  maxTurns: number | null;
}

function RunMessagesDialogContent({
  agentId,
  sessionId,
  subrunId,
  status,
  task,
  expectedOutput,
  durationMs,
  turns,
  maxTurns,
  usage,
  deliverables,
}: SubagentRunMessagesDialogProps) {
  const { state, retry } = useRunMessages({
    agentId,
    sessionId,
    subrunId,
  });

  return (
    <>
      <RunMessagesHeader
        agentId={agentId}
        sessionId={sessionId}
        subrunId={subrunId}
        status={status}
        task={task}
        expectedOutput={expectedOutput}
        durationMs={durationMs}
        turns={turns}
        maxTurns={maxTurns}
        totalTokens={usage?.tokenUsage?.total}
        deliverables={deliverables}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <RunMessagesContent agentId={agentId} sessionId={sessionId} state={state} onRetry={retry} />
      </div>

      <DialogFooter className="shrink-0 border-t border-sc-border px-5 py-3">
        <DialogClose asChild>
          <Button type="button" variant="outline" size="sm">
            Close
          </Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}

export function SubagentRunMessagesDialog(props: SubagentRunMessagesDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          View transcript
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden p-0">
        <RunMessagesDialogContent {...props} />
      </DialogContent>
    </Dialog>
  );
}
