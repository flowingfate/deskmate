import { lazy, Suspense } from 'react';
import type { Story } from '@ladle/react';
import { installToolStoryElectronMock } from './mockElectron';

installToolStoryElectronMock();

const BlockedRun = lazy(() => import('./SubagentRunDemo').then((module) => ({ default: module.BlockedRun })));
const CancelledRun = lazy(() => import('./SubagentRunDemo').then((module) => ({ default: module.CancelledRun })));
const ChipStates = lazy(() => import('./SubagentRunDemo').then((module) => ({ default: module.ChipStates })));
const CompletedRun = lazy(() => import('./SubagentRunDemo').then((module) => ({ default: module.CompletedRun })));
const FailedRun = lazy(() => import('./SubagentRunDemo').then((module) => ({ default: module.FailedRun })));
const LiveSubagentRun = lazy(() => import('./SubagentRunDemo').then((module) => ({ default: module.LiveSubagentRun })));
const PartialRun = lazy(() => import('./SubagentRunDemo').then((module) => ({ default: module.PartialRun })));
const PendingRun = lazy(() => import('./SubagentRunDemo').then((module) => ({ default: module.PendingRun })));
const ReadOnlyCommands = lazy(() => import('./SubagentRunDemo').then((module) => ({ default: module.ReadOnlyCommands })));
const RejectedRun = lazy(() => import('./SubagentRunDemo').then((module) => ({ default: module.RejectedRun })));
const UnknownResult = lazy(() => import('./SubagentRunDemo').then((module) => ({ default: module.UnknownResult })));
const TranscriptDialog = lazy(() => import('./SubagentRunDemo').then((module) => ({ default: module.TranscriptDialog })));

export default { title: 'Chat / Tools / Subagent Run Card' };

function StoryBoundary({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<span className="text-sm text-sc-muted-foreground">Loading subagent card…</span>}>
      {children}
    </Suspense>
  );
}

export const ChipStatesStory: Story = () => <StoryBoundary><ChipStates /></StoryBoundary>;
export const Pending: Story = () => <StoryBoundary><PendingRun /></StoryBoundary>;
export const RunningAndCancelable: Story = () => <StoryBoundary><LiveSubagentRun /></StoryBoundary>;
export const Completed: Story = () => <StoryBoundary><CompletedRun /></StoryBoundary>;
export const Partial: Story = () => <StoryBoundary><PartialRun /></StoryBoundary>;
export const Blocked: Story = () => <StoryBoundary><BlockedRun /></StoryBoundary>;
export const Failed: Story = () => <StoryBoundary><FailedRun /></StoryBoundary>;
export const Cancelled: Story = () => <StoryBoundary><CancelledRun /></StoryBoundary>;
export const Rejected: Story = () => <StoryBoundary><RejectedRun /></StoryBoundary>;
export const ReadOnlyListAndDescribe: Story = () => <StoryBoundary><ReadOnlyCommands /></StoryBoundary>;
export const UnknownResultFallback: Story = () => <StoryBoundary><UnknownResult /></StoryBoundary>;
export const Transcript: Story = () => <StoryBoundary><TranscriptDialog /></StoryBoundary>;
