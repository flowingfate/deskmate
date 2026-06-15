/**
 * `hello list [--json]` —— 示范一个无副作用的只读 subcommand。
 *
 * 故意保持极简,展示"小 subcommand 不一定要堆 OPTIONS / EXAMPLES" ——
 * 一个 USAGE 行 + 一句说明就够了。
 */

import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

const HELP = `USAGE
  hello list [--json]

Lists greetings recorded this session. Always empty in this demo.
`;

const FLAGS: FlagSpec[] = [
  { name: 'json', type: 'boolean' },
  { name: 'help', alias: 'h', type: 'boolean' },
];

export function runList(argv: string[], ctx: AppCmdContext): void {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`hello list: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (parsed.flags.help === true) {
    ctx.print(HELP);
    return;
  }
  if (parsed.flags.json === true) {
    ctx.print(JSON.stringify({ greetings: [] }) + '\n');
    return;
  }
  ctx.print('(no greetings recorded)\n');
}
