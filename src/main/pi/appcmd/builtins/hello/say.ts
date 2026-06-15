/**
 * `hello say <name> [options]` —— 示范 subcommand。
 *
 * 故意覆盖每个"真实命令"会用到的角:
 *   - 数组型 flag(`--tag` 可重复)
 *   - 破坏性 op(`--shout`)守门 + `--yes` / `--dry-run` 双路
 *   - `--json` 输出结构化
 *   - 位置参数 missing / 多余 → exit 2
 *
 * 文件布局范式(详见 `ai.prompt/tool-system.md` §6 "AppCommand 文件布局"):
 *   一个 subcommand 一个文件,FLAGS / HELP / 实现**全在同一文件**。
 *   它们是强内聚的 —— 一起读、一起改、一起测。
 */

import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

const HELP = `USAGE
  hello say <name> [options]

DESCRIPTION
  Greet <name>. With no flags, emits "Hello, <name>!" to stdout.

OPTIONS
  --tag <label>    Attach a label. Repeatable: --tag formal --tag short.
  --shout          Uppercase the greeting. Treated as destructive — requires --yes.
  --json           Output structured JSON: { "greeting": "...", "tags": [...] }.
  --dry-run        With --shout, print the would-be greeting without "executing".
  --yes, -y        Confirm --shout.

EXAMPLES
  hello say world
  hello say world --tag formal --tag short
  hello say world --shout --yes
`;

const FLAGS: FlagSpec[] = [
  { name: 'tag', type: 'array' },
  { name: 'shout', type: 'boolean' },
  { name: 'json', type: 'boolean' },
  { name: 'dry-run', type: 'boolean' },
  { name: 'yes', alias: 'y', type: 'boolean' },
  { name: 'help', alias: 'h', type: 'boolean' },
];

export function runSay(argv: string[], ctx: AppCmdContext): void {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`hello say: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (parsed.flags.help === true) {
    ctx.print(HELP);
    return;
  }
  if (parsed.positional.length === 0) {
    ctx.printErr('hello say: missing required argument: <name>\n');
    ctx.printErr('Try "hello say --help" for usage.\n');
    ctx.setExitCode(2);
    return;
  }
  if (parsed.positional.length > 1) {
    ctx.printErr(`hello say: too many positional arguments (${parsed.positional.length}), expected 1\n`);
    ctx.setExitCode(2);
    return;
  }

  const name = parsed.positional[0];
  const shout = parsed.flags.shout === true;
  const tags = Array.isArray(parsed.flags.tag) ? parsed.flags.tag : [];
  const json = parsed.flags.json === true;
  const dryRun = parsed.flags['dry-run'] === true;
  const yes = parsed.flags.yes === true;

  // 破坏性 op 守门:--shout 视为破坏性。dry-run 优先于 --yes 检查 —— LLM
  // 可以在不带 --yes 的情况下 --dry-run 先看效果,这是设计意图。
  if (shout && !dryRun && !yes) {
    ctx.printErr('hello say: --shout is destructive. Re-run with --yes to confirm, or --dry-run to preview.\n');
    ctx.setExitCode(1);
    return;
  }

  let greeting = `Hello, ${name}!`;
  if (shout) greeting = greeting.toUpperCase();

  if (json) {
    ctx.print(
      JSON.stringify({
        greeting,
        tags,
        shout,
        dryRun,
      }) + '\n',
    );
    return;
  }

  // 人类可读路径
  if (dryRun && shout) {
    ctx.print(`(dry-run) Would shout: ${greeting}\n`);
    return;
  }
  ctx.print(greeting + '\n');
  if (tags.length > 0) {
    ctx.print(`Tags: ${tags.join(', ')}\n`);
  }
}
