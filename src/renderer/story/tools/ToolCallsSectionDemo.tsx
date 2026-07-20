import { ToolCallsSection } from '@/components/chat/tool/ToolCallsSection';
import { registerBuiltinToolRenderers } from '@/components/chat/tool/registerBuiltins';
import { toolCalls } from './fixtures';


const STORY_AGENT_ID = 'story-agent';
const STORY_SESSION_ID = 'story-session';
registerBuiltinToolRenderers();

export function StandardToolCalls() {
  return (
    <div className="max-w-3xl">
      <ToolCallsSection agentId={STORY_AGENT_ID} sessionId={STORY_SESSION_ID} toolCalls={toolCalls} sectionKey="story-tool-calls" isLive />
    </div>
  );
}

export function InterruptedToolCall() {
  return (
    <div className="max-w-3xl">
      <ToolCallsSection
        agentId={STORY_AGENT_ID}
        sessionId={STORY_SESSION_ID}
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
