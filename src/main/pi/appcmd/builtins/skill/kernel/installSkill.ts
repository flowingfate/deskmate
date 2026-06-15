/**
 * Skill "install" 内核 —— 仅落到本地(install-only),**不**绑 agent。
 *
 * 角色:被 `appcmd/builtins/skill/install.ts` 调用。
 *
 * 走 `installAndActivateSkill` 这个**唯一**权威安装流程(见 lib/skill/ai.prompt.md
 * "唯一权威流程"),source 字段语义保持一致。
 *
 * `signal` 仅做契约形状对齐 —— 该路径下 IO 主要在 `installAndActivateSkill` 内部,
 * 该 helper 当前没有 signal 入口。
 */

import { installAndActivateSkill } from '@main/lib/skill/installAndActivateSkill';

export interface InstallSkillArgs {
  /** Skill name(用于结果展示) */
  skill_name: string;
  /** 本地 skill 包路径(.zip / .skill / 文件夹) */
  path: string;
  /** request source 标签,留给日志/审计 */
  request_source?: string;
}

export interface InstallSkillResult {
  success: boolean;
  message: string;
  skill_name: string;
  error?: string;
}

export async function installSkillInternal(
  args: InstallSkillArgs,
  _opts?: { signal?: AbortSignal },
): Promise<InstallSkillResult> {
  const skillName = args.skill_name?.trim();
  if (!skillName) {
    return {
      success: false,
      message: 'Invalid input: skill_name is required and must be a non-empty string.',
      skill_name: '',
      error: 'INVALID_INPUT',
    };
  }

  if (!args.path || !args.path.trim()) {
    return {
      success: false,
      message: '"path" is required.',
      skill_name: skillName,
      error: 'MISSING_PATH',
    };
  }

  try {
    const result = await installAndActivateSkill({
      source: { type: 'device-path', value: args.path.trim() },
      requestSource: args.request_source ?? 'chat-tool',
      activation: { mode: 'install-only' },
    });

    return {
      success: result.success,
      message: result.message || (result.success ? `Installed skill "${skillName}".` : `Failed to install skill "${skillName}".`),
      skill_name: skillName,
      error: result.error,
    };
  } catch (err) {
    return {
      success: false,
      message: `Error installing skill "${skillName}": ${err instanceof Error ? err.message : String(err)}`,
      skill_name: skillName,
      error: 'INSTALL_FAILED',
    };
  }
}
