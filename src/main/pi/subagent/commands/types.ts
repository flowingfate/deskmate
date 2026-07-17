import type { AppCmdContext } from '../../appcmd/types';
import type {
  SkillTier,
  SubAgentRunResult,
  ThinkingLevel,
} from '@shared/persist/types';
import type { Tracer } from '@shared/log/trace';

export interface SubAgentCommandScope {
  profileId: string;
  parentAgentId: string;
  parentSessionId: string;
  signal: AbortSignal;
  tracer: Tracer;
  correlationId: string;
}

export interface SubAgentCommandResultOutcome {
  kind: 'result';
  result: SubAgentRunResult;
}

export interface SubAgentCommandRejectedOutcome {
  kind: 'rejected';
  error: string;
}

export type SubAgentCommandOutcome =
  | SubAgentCommandResultOutcome
  | SubAgentCommandRejectedOutcome;

export interface SubAgentDelegateSummary {
  delegateAgentId: string;
  name: string;
  description?: string;
  model: string;
}

export interface SubAgentListDelegatesResultOutcome {
  kind: 'result';
  available: SubAgentDelegateSummary[];
  unavailableIds: string[];
}

export type SubAgentListDelegatesOutcome =
  | SubAgentListDelegatesResultOutcome
  | SubAgentCommandRejectedOutcome;

export interface SubAgentAllLocalTools {
  kind: 'all';
}

export interface SubAgentSelectedLocalTools {
  kind: 'selected';
  names: string[];
}

export type SubAgentLocalToolSelection =
  | SubAgentAllLocalTools
  | SubAgentSelectedLocalTools;

export interface SubAgentMcpSelection {
  serverName: string;
  toolNames: string[];
}

export interface SubAgentSkillSelection {
  name: string;
  tier: SkillTier;
}

export interface SubAgentDelegateDescription extends SubAgentDelegateSummary {
  thinkingLevel?: ThinkingLevel;
  localTools: SubAgentLocalToolSelection;
  mcpServers: SubAgentMcpSelection[];
  skills: SubAgentSkillSelection[];
}

export interface SubAgentDescribeDelegateResultOutcome {
  kind: 'result';
  delegate: SubAgentDelegateDescription;
}

export type SubAgentDescribeDelegateOutcome =
  | SubAgentDescribeDelegateResultOutcome
  | SubAgentCommandRejectedOutcome;


export function toSubAgentCommandScope(ctx: AppCmdContext): SubAgentCommandScope {
  return {
    profileId: ctx.profileId,
    parentAgentId: ctx.agentId,
    parentSessionId: ctx.sessionId,
    signal: ctx.signal,
    tracer: ctx.tracer,
    correlationId: ctx.callId,
  };
}
