import { formatClientLocalTime } from '@main/pi/utils/localTime';
import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags } from '../../flags';
import type { AppCommand, AppCmdContext } from '../../types';

const HELP = `USAGE
  app time [--json]

Print the current local date, time, timezone, and UTC offset of this client.

OPTIONS
  --json      Print structured JSON output.
  -h, --help  Show this help text.`;


export async function runTime(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, COMMON_FLAGS);
  if (!parsed.ok) {
    ctx.printErr(parsed.error);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }
  if (parsed.positional.length > 0) {
    ctx.printErr('time takes no positional arguments; run "app time --help" for usage.');
    ctx.setExitCode(2);
    return;
  }

  const localTime = formatClientLocalTime(Date.now());
  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify({
      local_time: localTime.localTime,
      timezone: localTime.timeZone,
      utc_offset: localTime.utcOffset,
    }));
    return;
  }
  ctx.print(`Current local time: ${localTime.localTime} ${localTime.timeZone} (${localTime.utcOffset})`);
}

export const timeCommand: AppCommand = {
  name: 'time',
  synopsis: 'Print this client’s current local time',
  help: HELP,
  run: runTime,
};
