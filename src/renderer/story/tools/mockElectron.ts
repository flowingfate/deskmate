import type { SubAgentRuntimeState } from '@shared/types/subAgentRunTypes';

export const storyProfileId = 'p_story';
export const storyAgentId = 'a_parent_story';
export const storySessionId = 's_story';

interface StoryEventListener {
  (_event: Event, state: SubAgentRuntimeState): void;
}

const stateListeners = new Set<StoryEventListener>();

function invoke(channel: string): Promise<boolean | object> {
  if (channel === 'persist:getSnapshot') {
    return Promise.resolve({
      success: true,
      data: {
        settings: {},
        agents: [
          {
            id: 'a_delegate_story',
            name: 'Researcher',
            description: 'Investigates implementation details and reports concise evidence.',
            version: '1',
            emoji: '🤡',
            model: 'openai:gpt-5-mini',
            createdAt: '2026-07-16T00:00:00.000Z',
            updatedAt: '2026-07-16T00:00:00.000Z',
          },
        ],
        skills: [],
        mcp: [],
        starred: [],
      },
    });
  }
  if (channel === 'subagentRun:getRunState') {
    return Promise.resolve({
      kind: 'found',
      state: {
        profileId: 'p_story',
        parentAgentId: 'a_story_parent',
        parentSessionId: 's_story_parent',
        subrunId: '001',
        delegateAgentId: 'a_story_delegate',
        task: 'Inspect the tool renderer composition.',
        expectedOutput: 'A concise implementation review.',
        maxTurns: 3,
        timeoutMs: 180_000,
        currentTurn: 1,
        steps: [],
        status: 'running',
        startedAt: Date.now() - 1_000,
      },
    });
  }
  if (channel === 'subagentRun:getRunMessages') {
    return Promise.resolve({
      kind: 'found',
      messages: [
        {
          role: 'user',
          id: 'm_task',
          time: Date.now() - 2_000,
          content: 'Inspect the tool renderer composition.',
          attachments: [],
        },
        {
          role: 'user',
          id: 'm_continue',
          time: Date.now() - 1_800,
          content: 'Add rollout risks.\n\n<system-reminder>Before ending this delegated run, call submit_result with the formal outcome.</system-reminder>',
          attachments: [],
        },
        {
          role: 'user',
          id: 'm_hidden_reminder',
          time: Date.now() - 1_700,
          content: '<system-reminder>Before ending this delegated run, call submit_result with the formal outcome.</system-reminder>',
          attachments: [],
        },
        {
          role: 'assistant',
          id: 'm_result',
          time: Date.now() - 1_000,
          think: 'Checking the renderer hierarchy, then examining the tool output shape.',
          content: 'The renderer reuses the **standard tool detail slots** and keeps tool-specific UI localized.',
          tool_calls: [
            {
              id: 'm_tool_find',
              name: 'find',
              time: Date.now() - 1_500,
              args: { path: 'src/renderer/components/chat/tool' },
              response: {
                time: Date.now() - 1_400,
                status: 'success',
                result: 'Found the shared detail container and registered renderers.',
                images: [],
              },
            },
            {
              id: 'm_tool_read',
              name: 'read',
              time: Date.now() - 1_300,
              args: { path: 'src/renderer/components/chat/tool/ToolDetailView.tsx' },
              response: {
                time: Date.now() - 1_200,
                status: 'success',
                result: 'Read the shared input and output detail slots.',
                images: [],
              },
            },
          ],
        },
      ],
    });
  }
  if (channel === 'subagentRun:cancelRun') {
    return Promise.resolve({ kind: 'cancel_requested' });
  }
  if (channel === 'fs:exists') return Promise.resolve(true);
  return Promise.resolve({ success: true, data: [] });
}

function on(channel: string, listener: StoryEventListener): void {
  if (channel === 'subagentRun:stateUpdate') stateListeners.add(listener);
}

function off(channel: string, listener: StoryEventListener): void {
  if (channel === 'subagentRun:stateUpdate') stateListeners.delete(listener);
}

export function installToolStoryElectronMock(): void {
  if (Object.getOwnPropertyDescriptor(window, 'electronAPI')) return;

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      persist: { invoke, on, off },
      subagentRun: { invoke, on, off },
      agentChat: { invoke, on, off },
      research: { invoke, on, off },
      log: { write() {}, writeBatch() {} },
      fs: { invoke },
      internalUrls: { invoke },
      skills: { invoke },
      workspace: { invoke, on, off },
    },
  });

  Object.defineProperty(window, '_human_in_loop_', {
    configurable: true,
    value: { on() {}, emit() {} },
  });
}

export function emitSubagentRunState(state: SubAgentRuntimeState): void {
  for (const listener of stateListeners) listener(new Event('stateUpdate'), state);
}
