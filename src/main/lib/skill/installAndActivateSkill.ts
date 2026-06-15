import { applySkillToAgents } from './applySkillToAgents';
import { getSkillAvailability } from './skillAvailability';
import { addSkillFromDevice } from './skillDeviceImporter';
import { Profiles } from '../../persist';

type SkillSource = { type: 'device-path'; value: string };

type ActivationMode = 'current-agent' | 'selected-agents' | 'all-agents' | 'install-only';

interface SkillActivationTarget {
  agentId: string;
  agentName: string;
}

export interface InstallAndActivateSkillArgs {
  source: SkillSource;
  requestSource?: string;
  activation: {
    mode: ActivationMode;
    agentId?: string;
    agentName?: string;
    targets?: SkillActivationTarget[];
  };
  confirmOverwrite?: (skillName: string) => Promise<boolean>;
}

export type SkillActivationResolution =
  | 'installed_and_callable'
  | 'installed_but_not_applied'
  | 'installed_but_needs_target_selection'
  | 'already_callable'
  | 'failed';

export interface InstallAndActivateSkillResult {
  success: boolean;
  skillName: string;
  install: {
    performed: boolean;
    success: boolean;
    isOverwrite: boolean;
  };
  activation: {
    attempted: boolean;
    success: boolean;
    appliedTargets: SkillActivationTarget[];
    skippedTargets: Array<SkillActivationTarget & { reason: string }>;
  };
  currentChat: {
    agentId?: string;
    agentName?: string;
    callable: boolean;
  };
  resolution: SkillActivationResolution;
  message: string;
  error?: string;
  skillVersion?: string;
  inputType?: 'zip' | 'skill' | 'folder';
}

async function resolveCurrentAgentTarget(agentId?: string, _agentName?: string): Promise<SkillActivationTarget | null> {
  if (!agentId) {
    return null;
  }

  let profile;
  try {
    profile = await Profiles.get().active();
  } catch {
    return null;
  }
  const agent = await profile.getAgent(agentId);
  if (!agent) {
    return null;
  }
  return { agentId, agentName: agent.config.name };
}

function buildResult(args: {
  success: boolean;
  skillName: string;
  installSuccess: boolean;
  isOverwrite?: boolean;
  resolution: SkillActivationResolution;
  message: string;
  error?: string;
  skillVersion?: string;
  inputType?: 'zip' | 'skill' | 'folder';
  attempted?: boolean;
  appliedTargets?: SkillActivationTarget[];
  skippedTargets?: Array<SkillActivationTarget & { reason: string }>;
  currentAgentId?: string;
  currentAgentName?: string;
  callable?: boolean;
}): InstallAndActivateSkillResult {
  return {
    success: args.success,
    skillName: args.skillName,
    install: {
      performed: true,
      success: args.installSuccess,
      isOverwrite: args.isOverwrite || false,
    },
    activation: {
      attempted: args.attempted || false,
      success: args.appliedTargets ? args.appliedTargets.length > 0 && !(args.skippedTargets || []).some(item => item.reason === 'UPDATE_FAILED') : false,
      appliedTargets: args.appliedTargets || [],
      skippedTargets: args.skippedTargets || [],
    },
    currentChat: {
      agentId: args.currentAgentId,
      agentName: args.currentAgentName,
      callable: !!args.callable,
    },
    resolution: args.resolution,
    message: args.message,
    error: args.error,
    skillVersion: args.skillVersion,
    inputType: args.inputType,
  };
}

export async function installAndActivateSkill(
  args: InstallAndActivateSkillArgs,
): Promise<InstallAndActivateSkillResult> {
  let skillName = '';
  let skillVersion: string | undefined;
  let inputType: 'zip' | 'skill' | 'folder' | undefined;
  let isOverwrite = false;

  try {
    const installResult = await addSkillFromDevice(args.source.value, args.confirmOverwrite);
    if (!installResult.success || !installResult.skillName) {
      const result = buildResult({
        success: false,
        skillName: installResult.skillName || '',
        installSuccess: false,
        resolution: 'failed',
        message: installResult.error || 'Failed to install skill from device.',
        error: installResult.error || 'INSTALL_FAILED',
      });
      return result;
    }

    skillName = installResult.skillName;
    skillVersion = installResult.skillVersion;
    inputType = installResult.inputType;
    isOverwrite = !!installResult.isOverwrite;

    const availabilityBeforeApply = await getSkillAvailability({
      skillName,
      agentId: args.activation.agentId,
      agentName: args.activation.agentName,
    });

    if (args.activation.mode === 'install-only') {
      const result = buildResult({
        success: true,
        skillName,
        skillVersion,
        inputType,
        installSuccess: true,
        isOverwrite,
        currentAgentId: args.activation.agentId,
        currentAgentName: availabilityBeforeApply.currentAgentName,
        callable: availabilityBeforeApply.callableInCurrentChat,
        resolution: availabilityBeforeApply.callableInCurrentChat ? 'already_callable' : 'installed_but_not_applied',
        message: availabilityBeforeApply.callableInCurrentChat
          ? `Skill "${skillName}" is already available for the current agent${availabilityBeforeApply.currentAgentName ? ` (${availabilityBeforeApply.currentAgentName})` : ''}.`
          : `Successfully added skill "${skillName}" to the profile skill library.`,
      });
      return result;
    }

    let targets: SkillActivationTarget[] | undefined;
    if (args.activation.mode === 'current-agent') {
      const currentTarget = await resolveCurrentAgentTarget(args.activation.agentId, args.activation.agentName);
      if (!currentTarget) {
        const result = buildResult({
          success: true,
          skillName,
          skillVersion,
          inputType,
          installSuccess: true,
          isOverwrite,
          currentAgentId: args.activation.agentId,
          currentAgentName: availabilityBeforeApply.currentAgentName,
          callable: false,
          resolution: 'installed_but_needs_target_selection',
          message: `Skill "${skillName}" has been installed, but I could not determine which agent should use it in the current chat.`,
        });
        return result;
      }
      targets = [currentTarget];
    } else if (args.activation.mode === 'selected-agents') {
      targets = args.activation.targets;
    } else if (args.activation.mode === 'all-agents') {
      const profile = await Profiles.get().active();
      const records = profile.listAgents();
      targets = [];
      for (const rec of records) {
        const agent = await profile.getAgent(rec.id);
        if (agent) targets.push({ agentId: rec.id, agentName: agent.config.name });
      }
    }

    if (!targets || targets.length === 0) {
      const result = buildResult({
        success: true,
        skillName,
        skillVersion,
        inputType,
        installSuccess: true,
        isOverwrite,
        currentAgentId: args.activation.agentId,
        currentAgentName: availabilityBeforeApply.currentAgentName,
        callable: availabilityBeforeApply.callableInCurrentChat,
        resolution: 'installed_but_not_applied',
        message: `Skill "${skillName}" has been installed, but no activation targets were resolved.`,
      });
      return result;
    }

    const applyResult = await applySkillToAgents({
      skillName,
      targets,
      requestSource: args.requestSource,
    });

    const availabilityAfterApply = await getSkillAvailability({
      skillName,
      agentId: args.activation.agentId,
      agentName: args.activation.agentName,
    });

    if (availabilityAfterApply.callableInCurrentChat) {
      const result = buildResult({
        success: true,
        skillName,
        skillVersion,
        inputType,
        installSuccess: true,
        isOverwrite,
        attempted: true,
        appliedTargets: applyResult.appliedTargets,
        skippedTargets: applyResult.skippedTargets,
        currentAgentId: args.activation.agentId,
        currentAgentName: availabilityAfterApply.currentAgentName,
        callable: true,
        resolution: availabilityBeforeApply.callableInCurrentChat ? 'already_callable' : 'installed_and_callable',
        message: availabilityBeforeApply.callableInCurrentChat
          ? `Skill "${skillName}" is already available for the current agent${availabilityAfterApply.currentAgentName ? ` (${availabilityAfterApply.currentAgentName})` : ''}.`
          : `Skill "${skillName}" has been installed and applied to ${availabilityAfterApply.currentAgentName || 'the current agent'}.`,
      });
      return result;
    }

    const result = buildResult({
      success: applyResult.success,
      skillName,
      skillVersion,
      inputType,
      installSuccess: true,
      isOverwrite,
      attempted: true,
      appliedTargets: applyResult.appliedTargets,
      skippedTargets: applyResult.skippedTargets,
      currentAgentId: args.activation.agentId,
      currentAgentName: availabilityAfterApply.currentAgentName,
      callable: false,
      resolution: 'installed_but_not_applied',
      message: applyResult.appliedCount > 0
        ? `Skill "${skillName}" was installed, but it is not yet callable in the current chat.`
        : applyResult.message,
      error: applyResult.error,
    });
    return result;
  } catch (error) {
    const result = buildResult({
      success: false,
      skillName,
      skillVersion,
      inputType,
      installSuccess: false,
      isOverwrite,
      resolution: 'failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
    return result;
  }
}