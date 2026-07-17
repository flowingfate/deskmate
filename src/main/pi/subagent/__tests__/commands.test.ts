import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Tracer } from '../../../../shared/log/trace';
import type { AgentAppCmdContext } from '../../appcmd/types';

import { createDescribeCommand } from '../commands/describe';
import { createListCommand } from '../commands/list';
import { createRunCommand } from '../commands/run';
import { SubAgentManager } from '../manager';

let tmpRoot = '';

interface CommandCapture {
  context: AgentAppCmdContext;
  output: string[];
  errors: string[];
  exitCodes: number[];
}

function commandCapture(profileId: string, agentId: string): CommandCapture {
  const output: string[] = [];
  const errors: string[] = [];
  const exitCodes: number[] = [];
  return {
    context: {
      mode: 'agent',
      profileId,
      agentId,
      sessionId: 's_parent',
      signal: new AbortController().signal,
      tracer: Tracer.noop,
      eventSender: null,
      chunkStream: null,
      callId: 'call_1',
      print: (text) => output.push(text),
      printErr: (text) => errors.push(text),
      setExitCode: (code) => exitCodes.push(code),
      addDeliverable: () => undefined,
    },
    output,
    errors,
    exitCodes,
  };
}

async function setupProfile(): Promise<{
  profileId: string;
  parentId: string;
  delegateId: string;
  manager: SubAgentManager;
}> {
  const root = await import('../../../persist/lib/root');
  const { Profiles } = await import('../../../persist/profiles');
  const { ProfileDb } = await import('../../../persist/lib/db/db');
  root.setRootForTesting(tmpRoot);
  Profiles.resetForTesting();
  ProfileDb.resetForTesting();
  await Profiles.get().bootstrap();
  const profile = await Profiles.get().active();
  const parent = await profile.createAgent({ name: 'Parent', version: '1', model: 'model-parent' });
  const delegate = await profile.createAgent({
    name: 'Delegate',
    description: 'Reviews reports.',
    version: '1',
    model: 'model-delegate',
  });
  await delegate.patchFront({
    tools: ['read'],
    mcpServers: [{ name: 'docs', tools: ['search'] }],
    skills: { review: 'live' },
  });
  await parent.patchFront({ delegates: [delegate.id, 'a_missing'] });

  return {
    profileId: profile.id,
    parentId: parent.id,
    delegateId: delegate.id,
    manager: SubAgentManager.forProfile(profile),
  };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-command-test-'));
});

afterEach(async () => {
  const { ProfileDb } = await import('../../../persist/lib/db/db');
  ProfileDb.closeAll();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('SubAgentManager read-only delegation contracts', () => {
  it('lists only configured active delegates in order and preserves unavailable IDs', async () => {
    const setup = await setupProfile();

    expect(await setup.manager.listDelegates({
      profileId: setup.profileId,
      parentAgentId: setup.parentId,
      parentSessionId: 's_parent',
      signal: new AbortController().signal,
      tracer: Tracer.noop,
      correlationId: 'call_1',
    })).toEqual({
      kind: 'result',
      available: [{
        delegateAgentId: setup.delegateId,
        name: 'Delegate',
        description: 'Reviews reports.',
        model: 'model-delegate',
      }],
      unavailableIds: ['a_missing'],
    });
  });

  it('projects only authorized delegate capability data and rejects unavailable IDs', async () => {
    const setup = await setupProfile();
    const scope = {
      profileId: setup.profileId,
      parentAgentId: setup.parentId,
      parentSessionId: 's_parent',
      signal: new AbortController().signal,
      tracer: Tracer.noop,
      correlationId: 'call_1',
    };

    expect(await setup.manager.describeDelegate(scope, setup.delegateId)).toEqual({
      kind: 'result',
      delegate: {
        delegateAgentId: setup.delegateId,
        name: 'Delegate',
        description: 'Reviews reports.',
        model: 'model-delegate',
        localTools: { kind: 'selected', names: ['read'] },
        mcpServers: [{ serverName: 'docs', toolNames: ['search'] }],
        skills: [{ name: 'review', tier: 'live' }],
      },
    });
    expect(await setup.manager.describeDelegate(scope, 'a_missing')).toEqual({
      kind: 'rejected',
      error: 'Delegate Agent is unavailable: a_missing.',
    });
  });
});

describe('subagent command grammar', () => {
  it('writes list and describe results through the shared outcome envelope', async () => {
    const setup = await setupProfile();
    const capture = commandCapture(setup.profileId, setup.parentId);

    await createListCommand(setup.manager).run([], capture.context);
    await createDescribeCommand(setup.manager).run([setup.delegateId], capture.context);

    expect(capture.output).toEqual([
      `${JSON.stringify({ outcome: {
        kind: 'result',
        available: [{
          delegateAgentId: setup.delegateId,
          name: 'Delegate',
          description: 'Reviews reports.',
          model: 'model-delegate',
        }],
        unavailableIds: ['a_missing'],
      } })}\n`,
      `${JSON.stringify({ outcome: {
        kind: 'result',
        delegate: {
          delegateAgentId: setup.delegateId,
          name: 'Delegate',
          description: 'Reviews reports.',
          model: 'model-delegate',
          localTools: { kind: 'selected', names: ['read'] },
          mcpServers: [{ serverName: 'docs', toolNames: ['search'] }],
          skills: [{ name: 'review', tier: 'live' }],
        },
      } })}\n`,
    ]);
    expect(capture.errors).toEqual([]);
    expect(capture.exitCodes).toEqual([]);
  });

  it('rejects malformed run arguments before manager admission', async () => {
    const setup = await setupProfile();
    const capture = commandCapture(setup.profileId, setup.parentId);

    await createRunCommand(setup.manager).run([
      setup.delegateId,
      '--task', 'inspect',
      '--expect', 'report',
      '--timeout-seconds', '0',
    ], capture.context);

    expect(capture.output).toEqual([]);
    expect(capture.errors).toEqual(['subagent run: --timeout-seconds must be a positive integer.\n']);
    expect(capture.exitCodes).toEqual([2]);
  });

  it('reports parent summary failure without starting a delegated run', async () => {
    const setup = await setupProfile();
    const capture = commandCapture(setup.profileId, setup.parentId);
    capture.context.getParentContextSummary = async () => {
      throw new Error('summary unavailable');
    };

    await createRunCommand(setup.manager).run([
      setup.delegateId,
      '--task', 'inspect',
      '--expect', 'report',
      '--with-parent-summary',
    ], capture.context);

    expect(capture.output).toEqual([]);
    expect(capture.errors).toEqual(['subagent run: failed to load parent context summary: summary unavailable.\n']);
    expect(capture.exitCodes).toEqual([1]);
  });
});
