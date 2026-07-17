import { ToolCallsSection } from '@/components/chat/tool/ToolCallsSection';
import { registerBuiltinToolRenderers } from '@/components/chat/tool/registerBuiltins';
import { toolCalls } from './fixtures';

registerBuiltinToolRenderers();

export function StandardToolCalls() {
  return (
    <div className="max-w-3xl">
      <ToolCallsSection toolCalls={toolCalls} sectionKey="story-tool-calls" isLive />
    </div>
  );
}

export function InterruptedToolCall() {
  return (
    <div className="max-w-3xl">
      <ToolCallsSection
        toolCalls={[
          {
            id: 'pending-tool',
            name: 'shell',
            time: 1,
            args: { command: 'npm', args: ['run', 'build'] },
          },
        ]}
        sectionKey="story-interrupted-tool"
        isLive={false}
      />
    </div>
  );
}
