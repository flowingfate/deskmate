import type { IpcMain } from 'electron';
import {
  mainToRender,
  renderToMain,
  type SubagentRunDataResult,
  type SubagentRunLookupFailure,
  type SubagentRunParent,
} from '@shared/ipc/subagentRun';
import type { Profile } from '@main/persist';
import type { SubrunDataFile } from '@shared/persist/types';
import { Profiles } from '@main/persist';
import { SubAgentManager } from '@main/pi/subagent/manager';
import { mainWindow } from '@main/startup/wins';

type LoadedSubrun =
  | { kind: 'found'; profile: Profile; data: SubrunDataFile }
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
      return { kind: 'found', profile, data: loaded.subrun.toDataFile() };
    case 'invalid_id':
      return { kind: 'invalid_id' };
    case 'missing':
      return { kind: 'missing' };
    case 'incomplete':
      return { kind: 'incomplete' };
    case 'corrupt':
      return { kind: 'corrupt' };
  }

  return { kind: 'error', error: 'Subrun query returned an unsupported result.' };
}

function dataResult(loaded: LoadedSubrun): SubagentRunDataResult {
  if (loaded.kind === 'found') return { kind: 'found', data: loaded.data };
  return loaded;
}

export function registerSubagentRunIpc(ipc: IpcMain): void {
  if (registered) return;
  registered = true;

  const handle = renderToMain.bindMain(ipc);
  handle.getRunData(async (_event, parent) => {
    try {
      return dataResult(await loadSubrun(parent));
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

      if (loaded.data.status !== 'pending' && loaded.data.status !== 'running') {
        return { kind: 'terminal', status: loaded.data.status };
      }

      const cancelled = SubAgentManager.forProfile(loaded.profile).cancelRun({
        profileId: loaded.profile.id,
        parentAgentId: parent.parentAgentId,
        parentSessionId: parent.parentSessionId,
        subrunId: parent.subrunId,
      });
      return cancelled
        ? { kind: 'cancel_requested' }
        : { kind: 'not_active', status: loaded.data.status };
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
