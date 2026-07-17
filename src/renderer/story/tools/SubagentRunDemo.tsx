import { useEffect } from 'react';
import type { ToolCall } from '@shared/persist/types';
import { ToolCallsSection } from '@/components/chat/tool/ToolCallsSection';
import { ToolDetailView } from '@/components/chat/tool/ToolDetailView';
import { registerBuiltinToolRenderers } from '@/components/chat/tool/registerBuiltins';
import { subagentRenderer } from '@/components/chat/tool/renderers/subagent';
import { SubagentRunMessagesDialog } from '@/components/chat/tool/renderers/subagent/message';
import { currentSessionStore } from '@/states/currentSession.atom';
import {
  blockedSubagentCall,
  cancelledSubagentCall,
  completedSubagentCall,
  continuedSubagentCall,
  describeSubagentCall,
  executionFailedSubagentCall,
  failedSubagentCall,
  interruptedSubagentCall,
  listSubagentCall,
  liveSubagentState,
  malformedSubagentCall,
  partialSubagentCall,
  pendingSubagentCall,
  rejectedSubagentCall,
} from './fixtures';
import {
  emitSubagentRunState,
  storyAgentId,
  storySessionId,
} from './mockElectron';

registerBuiltinToolRenderers();

function useStorySession(): void {
  useEffect(() => {
    currentSessionStore.set({
      agentId: storyAgentId,
      jobId: null,
      chatSessionId: storySessionId,
    });
    return () => currentSessionStore.set({ agentId: null, jobId: null, chatSessionId: null });
  }, []);
}

function SubagentDetailScenario({ title, toolCall }: { title: string; toolCall: ToolCall }) {
  return (
    <section className="max-w-2xl">
      <h2 className="m-0 mb-2 text-sm font-semibold text-sc-foreground">{title}</h2>
      <ToolDetailView
        toolCall={toolCall}
        executionStatus="completed"
        renderer={subagentRenderer}
      />
    </section>
  );
}

export function CompletedRun() {
  return <SubagentDetailScenario title="Completed result" toolCall={completedSubagentCall} />;
}

export function ContinuedRun() {
  useStorySession();
  return <SubagentDetailScenario title="Continued result" toolCall={continuedSubagentCall} />;
}

export function PartialRun() {
  return <SubagentDetailScenario title="Partial result" toolCall={partialSubagentCall} />;
}

export function BlockedRun() {
  return <SubagentDetailScenario title="Blocked result" toolCall={blockedSubagentCall} />;
}

export function FailedRun() {
  return <SubagentDetailScenario title="Failed result" toolCall={failedSubagentCall} />;
}

export function CancelledRun() {
  return <SubagentDetailScenario title="Cancelled result" toolCall={cancelledSubagentCall} />;
}

export function RejectedRun() {
  return <SubagentDetailScenario title="Rejected command" toolCall={rejectedSubagentCall} />;
}

export function ReadOnlyCommands() {
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <SubagentDetailScenario title="List command" toolCall={listSubagentCall} />
      <SubagentDetailScenario title="Describe command" toolCall={describeSubagentCall} />
    </div>
  );
}

export function UnknownResult() {
  return <SubagentDetailScenario title="Unknown result fallback" toolCall={malformedSubagentCall} />;
}

export function TranscriptDialog() {
  return (
    <section className="max-w-2xl">
      <h2 className="m-0 mb-2 text-sm font-semibold text-sc-foreground">Completed run transcript</h2>
      <p className="mb-3 text-sm text-sc-muted-foreground">Open the dialog to inspect the persisted user, assistant, and tool-call transcript.</p>
      <SubagentRunMessagesDialog
        parentAgentId={storyAgentId}
        parentSessionId={storySessionId}
        subrunId="001"
        agentName="Researcher"
        status="completed"
        task="Inspect the tool renderer composition."
        expectedOutput="A concise implementation review."
        durationMs={12_400}
        turns={3}
        maxTurns={8}
        usage={{ tokenUsage: { total: 1_248 } }}
        deliverables={['local://artifacts/review.md']}
      />
    </section>
  );
}

export function PendingRun() {
  return (
    <section className="max-w-2xl">
      <h2 className="m-0 mb-2 text-sm font-semibold text-sc-foreground">Pending run</h2>
      <ToolDetailView
        toolCall={pendingSubagentCall}
        executionStatus="executing"
        renderer={subagentRenderer}
      />
    </section>
  );
}

export function ChipStates() {
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <section>
        <h2 className="m-0 mb-2 text-sm font-semibold text-sc-foreground">Completed, failed, and interrupted</h2>
        <ToolCallsSection
          toolCalls={[completedSubagentCall, executionFailedSubagentCall, interruptedSubagentCall]}
          sectionKey="story-subagent-chip-terminal"
          isLive={false}
        />
      </section>
      <section>
        <h2 className="m-0 mb-2 text-sm font-semibold text-sc-foreground">Executing</h2>
        <ToolCallsSection
          toolCalls={[pendingSubagentCall]}
          sectionKey="story-subagent-chip-executing"
          isLive
        />
      </section>
    </div>
  );
}

export function LiveSubagentRun() {
  useStorySession();
  useEffect(() => {
    emitSubagentRunState(liveSubagentState);
  }, []);

  return (
    <section className="max-w-2xl">
      <h2 className="m-0 mb-2 text-sm font-semibold text-sc-foreground">Running and cancelable</h2>
      <ToolDetailView
        toolCall={pendingSubagentCall}
        executionStatus="executing"
        renderer={subagentRenderer}
      />
    </section>
  );
}
