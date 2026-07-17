/**
 * `skill install <name> --path <p> [--dry-run] [--json]`
 *
 * 装一个 skill 到本地(install-only,**不**自动绑 agent —— 那由 `skill bind` 负责)。
 *
 * 设计:
 *   - 只支持 device-path 安装:`--path` 指向本地 .zip / .skill / 文件夹,必填。
 *     (远程 source —— clawhub / github —— 已整体移除,不再有 `--from` 参数。)
 *   - `--dry-run` 演练:打印 resolved path,不下盘。
 *   - `--json` 输出 install envelope。
 *
 * 注:bind 流程不在这里 —— LLM 用 `app skill bind <name>` 显式绑(shell 范式
 * 一致:`apt install` 不会自动 `systemctl enable`)。
 */

import {
  installSkillInternal,
  type InstallSkillArgs,
  type InstallSkillResult,
} from './kernel/installSkill';

import { COMMON_FLAGS, isDryRun, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

import { validateName } from './_shared';

const HELP = `USAGE
  skill install <name> --path <path>

DESCRIPTION
  Install a skill from a local path to the device. The skill is copied
  to your profile's skills directory but NOT bound to any agent — use
  "skill bind <name>" to attach it.

OPTIONS
  --path <path>     Local path to a skill .zip / .skill / folder. REQUIRED.
  --dry-run         Show the resolved path without installing.
  --json            Output the install envelope as JSON.
  --help, -h        Show this help.

EXAMPLES
  skill install my-tool --path /Users/me/tools/my-tool.zip
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'path', type: 'string' },
];

export async function runInstall(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`skill install: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length === 0) {
    ctx.printErr('skill install: missing required <name>.\nTry "skill install --help".\n');
    ctx.setExitCode(2);
    return;
  }
  if (parsed.positional.length > 1) {
    ctx.printErr(
      `skill install: too many positional args (${parsed.positional.length}); only <name> is accepted.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const nameResult = validateName(parsed.positional[0]);
  if (!nameResult.ok) {
    ctx.printErr(`skill install: ${nameResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { name } = nameResult;

  const path = typeof parsed.flags.path === 'string' ? parsed.flags.path.trim() : undefined;
  if (!path) {
    ctx.printErr(`skill install: --path is required.\n`);
    ctx.setExitCode(2);
    return;
  }

  if (isDryRun(parsed.flags)) {
    const summary = {
      dryRun: true,
      action: 'install',
      skill_name: name,
      path,
    };
    if (isJson(parsed.flags)) {
      ctx.print(JSON.stringify(summary, null, 2) + '\n');
      return;
    }
    ctx.print(
      `[dry-run] skill install "${name}" (path=${path}).\n` +
        `Nothing was written. Re-run without --dry-run to apply.\n`,
    );
    return;
  }

  const internalArgs: InstallSkillArgs = {
    skill_name: name,
    path,
  };

  const result: InstallSkillResult = await installSkillInternal(internalArgs, {
    store: ctx.profile.store,
    signal: ctx.signal,
  });

  if (!result.success) {
    ctx.printErr(`skill install: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(
      JSON.stringify(
        { success: true, action: 'install', skill_name: result.skill_name },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  ctx.print(
    `Installed skill "${result.skill_name}". ` +
      `Use "app skill bind ${result.skill_name}" to attach it to an agent.\n`,
  );
}
