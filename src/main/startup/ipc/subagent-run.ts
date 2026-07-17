import type { IpcMain } from 'electron';
import {
  mainToRender,
  renderToMain,
  type SubagentRunLookupFailure,
  type SubagentRunParent,
  type SubagentRunStateResult,
} from '@shared/ipc/subagentRun';
import type { Profile, Subrun } from '@main/persist';
import { Profiles } from '@main/persist';
import { SubAgentManager } from '@main/pi/subagent/manager';
import { mainWindow } from '@main/startup/wins';

type LoadedSubrun =
  | { kind: 'found'; profile: Profile; subrun: Subrun }
  | SubagentRunLookupFailure;

let registered = false;

async function loadSubrun(parent: SubagentRunParent): Promise<LoadedSubrun> {
  const profile = await Profiles.get().active();
  const agent = await profile.getAgent(parent.parentAgentId);
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
  const state = await SubAgentManager.forProfile(loaded.profile).getRuntimeState({
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
  handle.getRunState(async (_event, parent) => {
    try {
      return await stateResult(await loadSubrun(parent), parent);
    } catch (error) {
      return {
        kind: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  handle.getRunMessages(async (_event, parent) => {
    try {
      const loaded = await loadSubrun(parent);
      if (loaded.kind !== 'found') return loaded;
      const { messages } = await loaded.subrun.loadDomainMessages();
      return { kind: 'found', messages };
    } catch (error) {
      return {
        kind: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  handle.cancelRun(async (_event, parent) => {
    try {
      const loaded = await loadSubrun(parent);
      if (loaded.kind !== 'found') return loaded;

      if (loaded.subrun.status !== 'pending' && loaded.subrun.status !== 'running') {
        return { kind: 'terminal', status: loaded.subrun.status };
      }

      const cancelled = SubAgentManager.forProfile(loaded.profile).cancelRun({
        profileId: loaded.profile.id,
        parentAgentId: parent.parentAgentId,
        parentSessionId: parent.parentSessionId,
        subrunId: parent.subrunId,
      });
      return cancelled
        ? { kind: 'cancel_requested' }
        : { kind: 'not_active', status: loaded.subrun.status };
    } catch (error) {
      return {
        kind: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  SubAgentManager.subscribeStateUpdates((state) => {
    const window = mainWindow();
    if (!window || window.isDestroyed()) return;
    mainToRender.bindWebContents(window.webContents).stateUpdate(state);
  });
}
