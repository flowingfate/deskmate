import type { SubrunId } from '@shared/persist/types';
import { DialogDescription, DialogHeader, DialogTitle } from '@/shadcn/dialog';
import { GeneratedFileCards } from '../../../../message/GeneratedFileCards';
import { SubagentStatusIcon } from '../RunResultDetails';

interface RunMessagesHeaderProps {
  agentId: string;
  sessionId: string;
  subrunId: SubrunId;
  status: string;
  task: string | null;
  expectedOutput: string | null;
  durationMs: number | undefined;
  turns: number;
  maxTurns: number | null;
  totalTokens: number | undefined;
  deliverables: string[];
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return '—';
  if (durationMs < 1_000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1_000)}s`;
}

export function RunMessagesHeader({
  agentId,
  sessionId,
  subrunId,
  status,
  task,
  expectedOutput,
  durationMs,
  turns,
  maxTurns,
  totalTokens,
  deliverables,
}: RunMessagesHeaderProps) {
  return (
    <DialogHeader className="shrink-0 border-b border-sc-border px-5 py-4 pr-12">
      <DialogTitle className="flex items-center gap-2 text-base">
        <span className="truncate">Sub run</span>
        <span className="font-mono text-sm font-medium text-sc-muted-foreground">#{subrunId}</span>
        <span className="flex items-center gap-1 text-sm font-medium capitalize text-sc-muted-foreground">
          <SubagentStatusIcon status={status} />
          {status}
        </span>
      </DialogTitle>
      <DialogDescription>Read-only transcript of this delegated run.</DialogDescription>
      <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-xs text-sc-muted-foreground">
        <span>Turns: {turns}{maxTurns ? `/${maxTurns}` : ''}</span>
        <span>Duration: {formatDuration(durationMs)}</span>
        <span>Tokens: {totalTokens?.toLocaleString() ?? '—'}</span>
      </div>
      {task ? (
        <div className="mt-3 rounded-md bg-sc-muted/50 px-3 py-2 text-xs leading-5 text-sc-foreground">
          <strong>Task:</strong> {task}
          {expectedOutput ? (
            <>
              <br />
              <strong>Expected:</strong> {expectedOutput}
            </>
          ) : null}
        </div>
      ) : null}
      {deliverables.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-sc-muted-foreground">Deliverables</p>
          <GeneratedFileCards agentId={agentId} sessionId={sessionId} items={deliverables.map((fileUri) => ({ fileUri }))} />
        </div>
      ) : null}
    </DialogHeader>
  );
}
