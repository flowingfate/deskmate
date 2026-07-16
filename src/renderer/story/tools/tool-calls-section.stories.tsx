import { lazy, Suspense } from 'react';
import type { Story } from '@ladle/react';
import { installToolStoryElectronMock } from './mockElectron';

installToolStoryElectronMock();

const StandardToolCalls = lazy(() => import('./ToolCallsSectionDemo').then((module) => ({
  default: module.StandardToolCalls,
})));
const InterruptedToolCall = lazy(() => import('./ToolCallsSectionDemo').then((module) => ({
  default: module.InterruptedToolCall,
})));

export default { title: 'Chat / Tools / Tool Calls Section' };

export const CollapsedAndExpanded: Story = () => (
  <Suspense fallback={<span className="text-sm text-sc-muted-foreground">Loading tool calls…</span>}>
    <StandardToolCalls />
  </Suspense>
);

export const InterruptedPendingCall: Story = () => (
  <Suspense fallback={<span className="text-sm text-sc-muted-foreground">Loading tool calls…</span>}>
    <InterruptedToolCall />
  </Suspense>
);
