// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { agentSettingsEntryLoader, peekAgentSettingsEntry } from './settingsEntry';

function recordAgentSettingsEntry(agentId: string): void {
  agentSettingsEntryLoader({
    request: new Request('http://localhost'),
    url: new URL('http://localhost'),
    pattern: '/agent/:agentId/settings/*',
    params: { agentId },
    context: undefined,
  });
}

describe('agentSettingsEntryLoader', () => {
  it('preserves the original route while switching settings tabs', () => {
    const entryRoute = '/agent/agent-a/session-a?view=details#messages';
    history.replaceState(null, '', entryRoute);
    recordAgentSettingsEntry('agent-a');

    history.replaceState(null, '', '/agent/agent-a/settings/basic');
    recordAgentSettingsEntry('agent-a');
    history.replaceState(null, '', '/agent/agent-a/settings/skills');
    recordAgentSettingsEntry('agent-a');

    expect(peekAgentSettingsEntry()).toBe(entryRoute);
  });
});
