/**
 * `schedule list [--agent <id>] [--json]`
 *
 * 只读:列出 scheduler 已登记的全部(或某 agent 的)schedule。
 *
 * 不暴露 `status <job-id>` 单条查询 —— job 的 id 不是 human-friendly key
 * (是 `j_*` ULID),LLM 想看某条详情走 `list` 然后 grep id;UI 看详情走
 * Settings → Schedules tab。
 *
 * `--json` 透传结构化 schedule array,方便链式调用(`list --json` → 解析
 * → `update <id>`)。
 */

import { listJobsInternal, type ListJobsResult } from './kernel/listJobs';

import { COMMON_FLAGS, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

import { formatJobLine } from './_shared';

const HELP = `USAGE
  schedule list [options]

DESCRIPTION
  List registered schedules. Read-only.

  Output (human mode): one line per schedule, columns:
    <job_id>  <name>  [<type>/<enabled>/<status>]  <trigger>  <last_run>

OPTIONS
  --agent <id>   Only list schedules owned by this agent agent_id.
  --json         Output the schedule array as JSON.
  --help, -h     Show this help.

EXAMPLES
  schedule list
  schedule list --agent a_abc123
  schedule list --json
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'agent', type: 'string' },
];

export async function runList(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`schedule list: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }
  if (parsed.positional.length > 0) {
    ctx.printErr(
      `schedule list: unexpected positional args (${parsed.positional.length}). Use --agent <id> to filter.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const agent = typeof parsed.flags.agent === 'string' ? parsed.flags.agent.trim() || undefined : undefined;

  const result: ListJobsResult = await listJobsInternal({ agent_id: agent }, { signal: ctx.signal });

  if (!result.success) {
    if (isJson(parsed.flags)) {
      ctx.print(JSON.stringify(result, null, 2) + '\n');
      ctx.setExitCode(1);
      return;
    }
    ctx.printErr(`schedule list: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  if (result.schedules.length === 0) {
    ctx.print(agent ? `No schedules for agent "${agent}".\n` : 'No schedules registered.\n');
    return;
  }
  const header = `Found ${result.schedules.length} schedule(s):`;
  ctx.print([header, ...result.schedules.map(formatJobLine)].join('\n') + '\n');
}
