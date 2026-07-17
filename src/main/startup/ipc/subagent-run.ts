import type { IpcMain } from 'electron';
import {
  renderToMain,
  type SubagentRunLookupFailure,
  type SubagentRunParent,
  type SubagentRunStateResult,
} from '@shared/ipc/subagentRun';
import type { Profile } from '@main/profile';
import type { Subrun } from '@main/persist';
import { requireProfileForSender } from './profileContext';

type LoadedSubrun =
  | { kind: 'found'; profile: Profile; subrun: Subrun }
  | SubagentRunLookupFailure;

let registered = false;

async function loadSubrun(profile: Profile, parent: SubagentRunParent): Promise<LoadedSubrun> {
  const agent = await profile.store.getAgent(parent.parentAgentId);
  if (!agent) {
    return {
      kind: 'parent_not_found',
      error: `Parent Agent is unavailable: ${parent.parentAgentId}.`,
    };
  }

  const session = await agent.findSessionAcrossKinds(parent.parentSessionId);
  if (!session) {
    return {
      kind: 'parent_not_found',
      error: `Parent session is unavailable: ${parent.parentSessionId}.`,
    };
  }

  const loaded = await session.getSubrun(parent.subrunId);
  switch (loaded.kind) {
    case 'found':
      return { kind: 'found', profile, subrun: loaded.subrun };
    case 'invalid_id':
      return { kind: 'invalid_id' };
    case 'missing':
      return { kind: 'missing' };
    case 'incomplete':
      return { kind: 'incomplete' };
  }
}

async function stateResult(
  loaded: LoadedSubrun,
  parent: SubagentRunParent,
): Promise<SubagentRunStateResult> {
  if (loaded.kind !== 'found') return loaded;
  const state = await loaded.profile.getSubAgentManager().getRuntimeState({
    profileId: loaded.profile.id,
    parentAgentId: parent.parentAgentId,
    parentSessionId: parent.parentSessionId,
    subrunId: parent.subrunId,
  });
  return state
    ? { kind: 'found', state }
    : { kind: 'error', error: 'Subrun runtime state is unavailable.' };
}

export function registerSubagentRunIpc(ipc: IpcMain): void {
  if (registered) return;
  registered = true;

  const handle = renderToMain.bindMain(ipc);
  handle.getRunState(async (event, parent) => {
    try {
      return await stateResult(await loadSubrun(requireProfileForSender(event), parent), parent);
    } catch (error) {
      return { kind: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  });

  handle.getRunMessages(async (event, parent) => {
    try {
      const loaded = await loadSubrun(requireProfileForSender(event), parent);
      if (loaded.kind !== 'found') return loaded;
      const { messages } = await loaded.subrun.loadDomainMessages();
      return { kind: 'found', messages };
    } catch (error) {
      return { kind: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  });

  handle.cancelRun(async (event, parent) => {
    try {
      const loaded = await loadSubrun(requireProfileForSender(event), parent);
      if (loaded.kind !== 'found') return loaded;
      const status = loaded.subrun.status;
      if (status !== 'pending' && status !== 'running') {
        return { kind: 'terminal', status };
      }
      const cancelled = loaded.profile.getSubAgentManager().cancelRun({
        profileId: loaded.profile.id,
        parentAgentId: parent.parentAgentId,
        parentSessionId: parent.parentSessionId,
        subrunId: parent.subrunId,
      });
      return cancelled ? { kind: 'cancel_requested' } : { kind: 'not_active', status };
    } catch (error) {
      return { kind: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  });

}
