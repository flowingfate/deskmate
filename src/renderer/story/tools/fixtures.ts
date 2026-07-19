import type { SubAgentRunResult, ToolCall } from '@shared/persist/types';
import type { SubAgentRuntimeState } from '@shared/types/subAgentRunTypes';
import { storyAgentId, storySessionId } from './mockElectron';

export const appCall: ToolCall = {
  id: 'tool_app',
  name: 'app',
  time: 1,
  args: { cmd: 'agent list' },
  response: {
    time: 2,
    status: 'success',
    result: 'Available Agents:\n- Research Agent\n- Writer Agent',
    images: [],
  },
};

export const shellCall: ToolCall = {
  id: 'tool_shell',
  name: 'shell',
  time: 3,
  args: { command: 'npm', args: ['run', 'typecheck'], shell: 'bash', cwd: '/workspace' },
  response: {
    time: 4,
    status: 'success',
    result: JSON.stringify({ stdout: 'Typecheck passed\n', stderr: '', exitCode: 0 }),
    images: [],
  },
};

export const webCall: ToolCall = {
  id: 'tool_web',
  name: 'web',
  time: 5,
  args: { cmd: 'search "Electron IPC patterns"' },
  response: {
    time: 6,
    status: 'success',
    result: 'Search completed with 3 sources.',
    images: [],
  },
};

export const writeCall: ToolCall = {
  id: 'tool_write',
  name: 'write',
  time: 7,
  args: { fileUri: 'local://artifacts/review.md', content: '# Review\nReady.' },
  response: {
    time: 8,
    status: 'success',
    result: JSON.stringify({ success: true, fileUri: 'local://artifacts/review.md' }),
    images: [],
  },
};

export const failedCall: ToolCall = {
  id: 'tool_failed',
  name: 'read',
  time: 9,
  args: { path: 'local://missing.txt' },
  response: {
    time: 10,
    status: 'fail',
    result: 'File not found: local://missing.txt',
    images: [],
  },
};

export const pendingSubagentCall: ToolCall = {
  id: 'tool_subagent_live',
  name: 'subagent',
  time: 11,
  args: {
    cmd: 'run a_delegate_story --task "Inspect the tool renderer" --expect "A concise review"',
  },
};

export const completedSubagentCall: ToolCall = {
  id: 'tool_subagent_completed',
  name: 'subagent',
  time: 12,
  args: {
    cmd: 'run a_delegate_story --task "Inspect the tool renderer" --expect "A concise review"',
  },
  response: {
    time: 13,
    status: 'success',
    result: JSON.stringify({
      outcome: {
        kind: 'result',
        result: {
          status: 'completed',
          subrunId: '001',
          delegateAgentId: 'a_delegate_story',
          content: 'The tool renderer uses a stable slot contract and keeps tool-specific UI localized.',
          deliverables: ['local://artifacts/review.md'],
          warnings: [],
          usage: { turns: 3, durationMs: 12_400 },
        },
      },
    }),
    images: [],
  },
};

export const continuedSubagentCall: ToolCall = {
  ...completedSubagentCall,
  id: 'tool_subagent_continued',
  args: {
    cmd: 'continue 001 --message "Add rollout risks" --max-turns 3',
  },
};

function delegatedResultCall(id: string, result: SubAgentRunResult): ToolCall {
  return {
    id,
    name: 'subagent',
    time: 20,
    args: {
      cmd: 'run a_delegate_story --task "Inspect the tool renderer" --expect "A concise review"',
    },
    response: {
      time: 21,
      status: 'success',
      result: JSON.stringify({ outcome: { kind: 'result', result } }),
      images: [],
    },
  };
}

export const partialSubagentCall = delegatedResultCall('tool_subagent_partial', {
  status: 'partial',
  subrunId: '002',
  delegateAgentId: 'a_delegate_story',
  content: 'The renderer slots are mapped, but animation behavior needs a browser check.',
  incompleteReason: 'The delegated time budget ended before the visual check.',
  deliverables: [],
  warnings: ['Story-only observation; no application runtime was started.'],
  usage: { turns: 8, durationMs: 48_000 },
});

export const blockedSubagentCall = delegatedResultCall('tool_subagent_blocked', {
  status: 'blocked',
  subrunId: '003',
  delegateAgentId: 'a_delegate_story',
  reason: 'The requested source file is unavailable in this Story fixture.',
  content: 'Provide the missing file before retrying.',
  deliverables: [],
  warnings: [],
  usage: { turns: 1, durationMs: 1_200 },
});

export const failedSubagentCall = delegatedResultCall('tool_subagent_failed', {
  status: 'failed',
  subrunId: '004',
  delegateAgentId: 'a_delegate_story',
  error: 'The delegated model connection failed.',
  deliverables: [],
  warnings: [],
  usage: { turns: 2, durationMs: 8_400 },
});

export const cancelledSubagentCall = delegatedResultCall('tool_subagent_cancelled', {
  status: 'cancelled',
  subrunId: '005',
  delegateAgentId: 'a_delegate_story',
  reason: 'Cancelled by the parent session.',
  deliverables: [],
  warnings: [],
  usage: { turns: 2, durationMs: 6_700 },
});

export const rejectedSubagentCall: ToolCall = {
  id: 'tool_subagent_rejected',
  name: 'subagent',
  time: 22,
  args: { cmd: 'run a_unavailable --task "Inspect" --expect "Review"' },
  response: {
    time: 23,
    status: 'success',
    result: JSON.stringify({ outcome: { kind: 'rejected', error: 'Delegate Agent is unavailable: a_unavailable.' } }),
    images: [],
  },
};

export const listSubagentCall: ToolCall = {
  id: 'tool_subagent_list',
  name: 'subagent',
  time: 24,
  args: { cmd: 'list' },
  response: {
    time: 25,
    status: 'success',
    result: JSON.stringify({ outcome: { kind: 'result', available: [{ delegateAgentId: 'a_delegate_story', name: 'Research Agent' }], unavailableIds: ['a_archived'] } }),
    images: [],
  },
};

export const describeSubagentCall: ToolCall = {
  id: 'tool_subagent_describe',
  name: 'subagent',
  time: 26,
  args: { cmd: 'describe a_delegate_story' },
  response: {
    time: 27,
    status: 'success',
    result: JSON.stringify({ outcome: { kind: 'result', delegate: { delegateAgentId: 'a_delegate_story', name: 'Research Agent', localTools: { kind: 'all' } } } }),
    images: [],
  },
};

export const malformedSubagentCall: ToolCall = {
  id: 'tool_subagent_malformed',
  name: 'subagent',
  time: 28,
  args: { cmd: 'run a_delegate_story --task "Inspect" --expect "Review"' },
  response: {
    time: 29,
    status: 'success',
    result: '{"unexpected":true}',
    images: [],
  },
};

export const executionFailedSubagentCall: ToolCall = {
  id: 'tool_subagent_execution_failed',
  name: 'subagent',
  time: 30,
  args: { cmd: 'run a_delegate_story --task "Inspect" --expect "Review"' },
  response: {
    time: 31,
    status: 'fail',
    result: 'The subagent tool could not start.',
    images: [],
  },
};

export const interruptedSubagentCall: ToolCall = {
  id: 'tool_subagent_interrupted',
  name: 'subagent',
  time: 32,
  args: { cmd: 'run a_delegate_story --task "Inspect" --expect "Review"' },
};

export const toolCalls = [appCall, shellCall, webCall, writeCall, completedSubagentCall, failedCall];

const liveStartedAt = Date.now() - 4_200;

export const liveSubagentState: SubAgentRuntimeState = {
  parentAgentId: storyAgentId,
  parentSessionId: storySessionId,
  subrunId: '001',
  delegateAgentId: 'a_delegate_story',
  correlationId: pendingSubagentCall.id,
  task: 'Inspect the tool renderer composition.',
  expectedOutput: 'A concise implementation review.',
  maxTurns: 8,
  timeoutMs: 480_000,
  currentTurn: 2,
  steps: [
    {
      kind: 'tool_started',
      turn: 2,
      timestamp: liveStartedAt + 2_000,
      toolCallId: 'delegate_read',
      toolName: 'read',
      argumentsSummary: 'src/renderer/components/chat/tool',
    },
  ],
  status: 'running',
  startedAt: liveStartedAt,
  lastTextSnippet: 'Comparing slot renderer fallbacks.',
  streamingText: 'Comparing slot renderer fallbacks.',
};
