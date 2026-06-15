/**
 * `schedule create <name> [options]`
 *
 * 登记一条 scheduler job —— cron 周期 / one-time reminder 二选一。
 *
 * 设计:
 *   - `<name>` 升为位置参数(`apt install foo` / `npm install pkg` 范式)。
 *   - `--cron <expr>` 与 `--at <ISO>` 互斥;**必须**给其一,kernel 会反查。
 *   - `--message <text>` 是触发时发给 agent 的 prompt,**必填**。
 *   - `--agent <id>` 缺省 → `ctx.agentId`(当前 chat 的 agent)。
 *   - `--description <text>` 是 LLM 的"调用动机记录",落到 persist 上。
 *     说"为什么 create",而非"做了什么";缺省给一个 stub。
 *   - `--dry-run` 演练:把将要 register 的 schedule 配置打印出来,不写盘。
 *   - `--json` 输出最终(或演练)结构化 envelope。
 *
 * **不**接 description 为必填 —— 老 `create_schedule` schema 把它做了
 * required,LLM 每次都得编一句话;实际只是 UI 显示。新设计降为 optional,
 * 缺省给一个从 name + scheduleType 推导的 sensible default。
 */

import { createJobInternal, type CreateJobResult } from './kernel/createJob';

import { COMMON_FLAGS, isDryRun, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

const HELP = `USAGE
  schedule create <name> --message <text> (--cron <expr> | --at <ISO>) [options]

DESCRIPTION
  Register a scheduled task. When triggered, a NEW chat session is started
  under the target agent and <message> is sent as the first user prompt.

  Provide exactly one of:
    --cron <expr>    recurring schedule (5-field or 6-field cron syntax)
    --at <ISO>       one-time, e.g. "2026-03-10T08:00:00+08:00"

OPTIONS
  --message <text>      Prompt sent to the agent when the schedule fires. REQUIRED.
  --cron <expr>         Recurring cron expression (5/6-field).
  --at <ISO>            One-time ISO 8601 timestamp.
  --agent <id>          Target agent agent_id. Default: current agent.
  --description <text>  Free-form description (UI label / persist record).
  --dry-run             Show the would-be schedule without writing it.
  --json                Output a JSON envelope instead of a summary.
  --help, -h            Show this help.

EXAMPLES
  schedule create "morning digest" --cron "0 6 * * *" --message "Summarize my unread emails."
  schedule create "remind me" --at "2026-03-10T08:00:00+08:00" --message "Time to rest."
  schedule create foo --cron "*/30 * * * *" --message "Check status" --dry-run --json
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'message', type: 'string' },
  { name: 'cron', type: 'string' },
  { name: 'at', type: 'string' },
  { name: 'agent', type: 'string' },
  { name: 'description', type: 'string' },
];

export async function runCreate(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`schedule create: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length === 0) {
    ctx.printErr('schedule create: missing required <name>.\nTry "schedule create --help".\n');
    ctx.setExitCode(2);
    return;
  }
  if (parsed.positional.length > 1) {
    ctx.printErr(
      `schedule create: too many positional args (${parsed.positional.length}); only <name> is accepted (use quotes for multi-word).\n`,
    );
    ctx.setExitCode(2);
    return;
  }
  const name = parsed.positional[0].trim();
  if (!name) {
    ctx.printErr('schedule create: <name> must be non-empty.\n');
    ctx.setExitCode(2);
    return;
  }

  const message = typeof parsed.flags.message === 'string' ? parsed.flags.message : '';
  if (!message.trim()) {
    ctx.printErr(
      'schedule create: --message <text> is required (this is what the agent receives when the schedule fires).\n',
    );
    ctx.setExitCode(2);
    return;
  }

  const cron = typeof parsed.flags.cron === 'string' ? parsed.flags.cron : undefined;
  const at = typeof parsed.flags.at === 'string' ? parsed.flags.at : undefined;
  const description =
    typeof parsed.flags.description === 'string' && parsed.flags.description.trim()
      ? parsed.flags.description
      : `Scheduled task: ${name}`;
  const agent = typeof parsed.flags.agent === 'string' ? parsed.flags.agent : undefined;

  // dry-run:不调 kernel,直接打印 would-be schedule
  if (isDryRun(parsed.flags)) {
    const wouldType: 'cron' | 'once' | 'invalid' =
      (cron && at) || (!cron && !at) ? 'invalid' : cron ? 'cron' : 'once';
    if (wouldType === 'invalid') {
      ctx.printErr(
        'schedule create: [dry-run] cannot proceed — provide exactly one of --cron or --at.\n',
      );
      ctx.setExitCode(2);
      return;
    }
    const preview = {
      name,
      schedule_type: wouldType,
      cron_expression: cron,
      run_at: at,
      message,
      agent_id: agent ?? ctx.agentId,
      description,
    };
    if (isJson(parsed.flags)) {
      ctx.print(JSON.stringify({ dryRun: true, action: 'create', schedule: preview }, null, 2) + '\n');
      return;
    }
    const lines: string[] = [];
    lines.push(`[dry-run] schedule create "${name}" (${wouldType})`);
    if (cron) lines.push(`  cron:    ${cron}`);
    if (at) lines.push(`  at:      ${at}`);
    lines.push(`  agent:   ${preview.agent_id}`);
    lines.push(`  message: ${truncateForPreview(message)}`);
    lines.push('Nothing was registered. Re-run without --dry-run to apply.');
    ctx.print(lines.join('\n') + '\n');
    return;
  }

  const result: CreateJobResult = await createJobInternal(
    {
      name,
      description,
      message,
      cron_expression: cron,
      run_at: at,
      agent_id: agent,
    },
    ctx.agentId,
    { signal: ctx.signal },
  );

  if (!result.success) {
    if (isJson(parsed.flags)) {
      ctx.print(JSON.stringify(result, null, 2) + '\n');
      ctx.setExitCode(1);
      return;
    }
    ctx.printErr(`schedule create: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify({ action: 'create', ...result }, null, 2) + '\n');
    return;
  }
  ctx.print(
    `${result.message}\n` +
      `  job_id: ${result.job_id}\n` +
      `Run "schedule list" to see all schedules.\n`,
  );
}

/** dry-run preview 里截断 message,避免 LLM context 被一条长 prompt 塞爆。 */
function truncateForPreview(text: string, max = 120): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}
