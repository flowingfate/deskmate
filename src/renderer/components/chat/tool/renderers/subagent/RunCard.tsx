import { useEffect, useState } from 'react';
import { Bot, Loader2, OctagonX, Wrench } from 'lucide-react';
import type { SubAgentRunResult, SubrunDataFile } from '@shared/persist/types';
import type { SubAgentRunStep, SubAgentRuntimeState } from '@shared/types/subAgentRunTypes';
import type { ToolCall } from '@shared/persist/types';
import { subagentRunApi, useSubagentRunState } from '@/ipc/subagentRun';
import { useAgentById } from '@/states/agents.atom';
import { useProfileId } from '@/states/profile.atom';
import { useCurrentSession } from '@/states/currentSession.atom';
import { Button } from '@/shadcn/button';
import { AgentAvatar } from '../../../../common/AgentAvatar';
import type { SubagentRunResultView } from './parse';
import {
  SubagentFormalResultDetails,
  SubagentStatusIcon,
} from './RunResultDetails';

type AuditState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'found'; data: SubrunDataFile }
  | { kind: 'error'; message: string };

interface SubagentRunCardProps {
  toolCall: ToolCall;
  result?: SubagentRunResultView;
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return '—';
  if (durationMs < 1_000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1_000)}s`;
}

function resultFromData(data: SubrunDataFile | null): SubAgentRunResult | null {
  if (!data || data.status === 'pending' || data.status === 'running') return null;
  return data.result;
}

function resultFromRuntime(state: SubAgentRuntimeState | null): SubAgentRunResult | null {
  if (!state || state.status === 'pending' || state.status === 'running') return null;
  return state.result;
}

function stepSummary(step: SubAgentRunStep | undefined): string | null {
  if (!step) return null;
  switch (step.kind) {
    case 'turn_started':
      return `Turn ${step.turn} started`;
    case 'assistant_text':
      return step.textSnippet;
    case 'tool_started':
      return `Running ${step.toolName}`;
    case 'tool_completed':
      return `${step.toolName} completed in ${formatDuration(step.durationMs)}`;
    case 'tool_failed':
      return `${step.toolName} failed: ${step.error}`;
  }
}

function auditError(result: Awaited<ReturnType<typeof subagentRunApi.getRunData>>): string | null {
  switch (result.kind) {
    case 'found':
      return null;
    case 'parent_not_found':
    case 'error':
      return result.error;
    case 'invalid_id':
      return 'The delegated run ID is invalid.';
    case 'missing':
      return 'The delegated run record is unavailable.';
    case 'incomplete':
      return 'The delegated run reservation is incomplete.';
    case 'corrupt':
      return 'The delegated run record is corrupt.';
  }
}

function cancelError(result: Awaited<ReturnType<typeof subagentRunApi.cancelRun>>): string | null {
  switch (result.kind) {
    case 'cancel_requested':
      return null;
    case 'terminal':
      return `Run already finished as ${result.status}.`;
    case 'not_active':
      return `Run is no longer active (${result.status}).`;
    case 'parent_not_found':
    case 'error':
      return result.error;
    case 'invalid_id':
      return 'The delegated run ID is invalid.';
    case 'missing':
      return 'The delegated run record is unavailable.';
    case 'incomplete':
      return 'The delegated run reservation is incomplete.';
    case 'corrupt':
      return 'The delegated run record is corrupt.';
  }
}


export function SubagentRunCard({ toolCall, result }: SubagentRunCardProps) {
  const { agentId, chatSessionId } = useCurrentSession();
  const profileId = useProfileId();
  const liveState = useSubagentRunState(toolCall.id, profileId, agentId, chatSessionId, result?.subrunId);
  const subrunId = result?.subrunId ?? liveState?.subrunId;
  const delegateAgentId = result?.delegateAgentId ?? liveState?.delegateAgentId;
  const agent = useAgentById(delegateAgentId);
  const [audit, setAudit] = useState<AuditState>({ kind: 'idle' });
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId || !chatSessionId || !subrunId) {
      setAudit({ kind: 'idle' });
      return;
    }

    let disposed = false;
    setAudit({ kind: 'loading' });
    void (async () => {
      try {
        const queried = await subagentRunApi.getRunData({
          parentAgentId: agentId,
          parentSessionId: chatSessionId,
          subrunId,
        });
        if (disposed) return;
        if (queried.kind === 'found') {
          setAudit({ kind: 'found', data: queried.data });
          return;
        }
        setAudit({ kind: 'error', message: auditError(queried) ?? 'Unable to load run metadata.' });
      } catch (error) {
        if (!disposed) {
          setAudit({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [agentId, chatSessionId, subrunId]);

  const auditResult = audit.kind === 'found' ? resultFromData(audit.data) : null;
  const formalResult = result ?? resultFromRuntime(liveState) ?? auditResult;
  const runningState = liveState?.status === 'running' ? liveState : null;
  const status = formalResult?.status ?? liveState?.status ?? auditResult?.status ?? 'pending';
  const task = liveState?.task ?? (audit.kind === 'found' ? audit.data.request.task : null);
  const expectedOutput = liveState?.expectedOutput ?? (audit.kind === 'found' ? audit.data.request.expectedOutput : null);
  const currentTurn = liveState?.currentTurn ?? formalResult?.usage.turns ?? 0;
  const maxTurns = liveState?.maxTurns ?? (audit.kind === 'found' ? audit.data.request.policy.maxTurns : null);
  const durationMs = formalResult?.usage.durationMs
    ?? (runningState ? Math.max(0, Date.now() - runningState.startedAt) : undefined);
  const latestStep = liveState?.steps.at(-1);
  const latestUpdate = runningState?.streamingText ?? runningState?.lastTextSnippet ?? stepSummary(latestStep);
  const canCancel = Boolean(
    subrunId
      && agentId
      && chatSessionId
      && liveState
      && (status === 'pending' || status === 'running'),
  );

  async function cancel(): Promise<void> {
    if (!subrunId || !agentId || !chatSessionId || isCancelling) return;
    setIsCancelling(true);
    setCancelMessage(null);
    try {
      const cancelled = await subagentRunApi.cancelRun({
        parentAgentId: agentId,
        parentSessionId: chatSessionId,
        subrunId,
      });
      setCancelMessage(cancelError(cancelled));
    } catch (error) {
      setCancelMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-black/8 bg-gray-50 p-3" aria-live="polite">
      <header className="flex items-center gap-2.5">
        {agent ? (
          <AgentAvatar
            emoji={agent.emoji}
            avatar={agent.avatar}
            name={agent.name}
            version={agent.version}
            size="sm"
          />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-gray-200 text-gray-600">
            <Bot size={16} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            <span className="truncate">{agent?.name ?? delegateAgentId ?? 'Delegated Agent'}</span>
            {subrunId && <span className="font-mono text-xs font-medium text-gray-500">#{subrunId}</span>}
          </div>
          <p className="m-0 truncate text-xs text-gray-500">
            {agent?.description ?? 'Delegated run'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-xs font-medium capitalize text-gray-700">
          <SubagentStatusIcon status={status} />
          <span>{status}</span>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
        <span>Turns: {currentTurn}{maxTurns ? `/${maxTurns}` : ''}</span>
        <span>Duration: {formatDuration(durationMs)}</span>
      </div>

      {task && (
        <div className="rounded-md bg-white px-2.5 py-2 text-xs leading-5 text-gray-700">
          <strong>Task:</strong> {task}
          {expectedOutput && <><br /><strong>Expected:</strong> {expectedOutput}</>}
        </div>
      )}

      {latestUpdate && !formalResult && (
        <div className="flex items-start gap-1.5 rounded-md bg-sky-50 px-2.5 py-2 text-xs leading-5 text-sky-900">
          <Wrench size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{latestUpdate}</span>
        </div>
      )}

      <SubagentFormalResultDetails result={formalResult} />

      {canCancel && (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={cancel}
            disabled={isCancelling}
            aria-label={`Cancel delegated run ${subrunId}`}
          >
            {isCancelling ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <OctagonX size={14} aria-hidden="true" />}
            {isCancelling ? 'Cancelling…' : 'Cancel'}
          </Button>
          {audit.kind === 'loading' && <span className="text-xs text-gray-500">Loading audit metadata…</span>}
        </div>
      )}

      {cancelMessage && <p className="m-0 text-xs text-rose-700">{cancelMessage}</p>}
      {audit.kind === 'error' && <p className="m-0 text-xs text-amber-700">Audit metadata unavailable: {audit.message}</p>}
    </section>
  );
}
