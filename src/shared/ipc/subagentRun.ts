import { connectMainToRender, connectRenderToMain } from './base';
import type { Message, SubAgentRunStatus, SubrunDataFile, SubrunId } from '../persist/types';
import type { SubAgentRuntimeState } from '../types/subAgentRunTypes';

export interface SubagentRunParent {
  parentAgentId: string;
  parentSessionId: string;
  subrunId: SubrunId;
}

export interface SubagentRunFound {
  kind: 'found';
  data: SubrunDataFile;
}

export interface SubagentRunParentNotFound {
  kind: 'parent_not_found';
  error: string;
}

export interface SubagentRunInvalidId {
  kind: 'invalid_id';
}

export interface SubagentRunMissing {
  kind: 'missing';
}

export interface SubagentRunIncomplete {
  kind: 'incomplete';
}

export interface SubagentRunCorrupt {
  kind: 'corrupt';
}

export interface SubagentRunQueryError {
  kind: 'error';
  error: string;
}

export type SubagentRunLookupFailure =
  | SubagentRunParentNotFound
  | SubagentRunInvalidId
  | SubagentRunMissing
  | SubagentRunIncomplete
  | SubagentRunCorrupt
  | SubagentRunQueryError;

export type SubagentRunDataResult = SubagentRunFound | SubagentRunLookupFailure;

export interface SubagentRunMessagesFound {
  kind: 'found';
  messages: Message[];
}

export type SubagentRunMessagesResult = SubagentRunMessagesFound | SubagentRunLookupFailure;

export interface SubagentRunCancelRequested {
  kind: 'cancel_requested';
}

export interface SubagentRunTerminal {
  kind: 'terminal';
  status: SubAgentRunStatus;
}

export interface SubagentRunNotActive {
  kind: 'not_active';
  status: 'pending' | 'running';
}

export type SubagentRunCancelResult =
  | SubagentRunCancelRequested
  | SubagentRunTerminal
  | SubagentRunNotActive
  | SubagentRunLookupFailure;

type RenderToMain = {
  cancelRun: {
    call: [parent: SubagentRunParent];
    return: SubagentRunCancelResult;
  };
  getRunData: {
    call: [parent: SubagentRunParent];
    return: SubagentRunDataResult;
  };
  getRunMessages: {
    call: [parent: SubagentRunParent];
    return: SubagentRunMessagesResult;
  };
};

type MainToRender = {
  stateUpdate: SubAgentRuntimeState;
};

export const renderToMain = connectRenderToMain<RenderToMain>('subagentRun');
export const mainToRender = connectMainToRender<MainToRender>('subagentRun');
