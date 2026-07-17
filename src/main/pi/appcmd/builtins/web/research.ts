import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCommand, AppCmdContext } from '../../types';
import { isDelegatedExecution } from '@main/lib/delegateExecutionScope';
import type { InteractiveSearchEngine, InteractiveSearchSource } from '@shared/types/interactiveRequestTypes';
import { parseNumberFlag } from './_shared';
import { runResearchSession } from './kernel/research';

const HELP = `USAGE
  web research <query> [options]

DESCRIPTION
  Hand a research task to the user. Opens a visible Deskmate Research window
  seeded with <query>; the user searches, browses, and confirms which pages
  to send back. Returns the FULL extracted text of every confirmed page (not
  snippets), ready to read or cite.

  This is human-in-the-loop and BLOCKING: it waits for the user to submit or
  cancel, driven by their attention (no timeout). It requires an active chat
  window and CANNOT run in scheduled or background sessions.

  When to use: prefer "web search" (automatic, fast) first. Reach for
  "web research" only as a fallback — when "web search" is unavailable,
  erroring, or returns nothing useful, when pages are behind anti-bot / login
  / paywall that automatic fetch cannot reach, or when the sources must be
  reviewed and authorized by the user.

OPTIONS
  --engine <bing|baidu>  Search engine to open in the window. Default: bing.
  --max-sources <n>      Max pages the user may confirm, 1-8. Default: 5.
  --json                 Output the confirmed sources as raw JSON context.
  --help, -h             Show this help.

EXAMPLES
  web research "latest electron WebContentsView API changes"
  web research "公司年报 2024 财务数据" --engine baidu --max-sources 3
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'engine', type: 'string' },
  { name: 'max-sources', type: 'string' },
];

const DEFAULT_ENGINE: InteractiveSearchEngine = 'bing';
const DEFAULT_MAX_SOURCES = 5;

export async function runResearch(argv: readonly string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`web research: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }
  if (isDelegatedExecution()) {
    ctx.printErr('web research requires user interaction and is unavailable in delegated runs.\n');
    ctx.setExitCode(1);
    return;
  }

  const query = parsed.positional.join(' ').trim();
  if (query.length === 0) {
    ctx.printErr('web research: query required.\n');
    ctx.setExitCode(2);
    return;
  }

  const engineRaw = typeof parsed.flags.engine === 'string' && parsed.flags.engine.trim() !== ''
    ? parsed.flags.engine.trim().toLowerCase()
    : DEFAULT_ENGINE;
  if (engineRaw !== 'bing' && engineRaw !== 'baidu') {
    ctx.printErr(`web research: --engine must be bing or baidu (got ${engineRaw}).\n`);
    ctx.setExitCode(2);
    return;
  }
  const engine: InteractiveSearchEngine = engineRaw;

  const maxSourcesRaw = parseNumberFlag(parsed.flags['max-sources']);
  if (Number.isNaN(maxSourcesRaw)) {
    ctx.printErr('web research: --max-sources must be a number (1-8).\n');
    ctx.setExitCode(2);
    return;
  }
  const maxSources = maxSourcesRaw ?? DEFAULT_MAX_SOURCES;
  if (!Number.isInteger(maxSources) || maxSources < 1 || maxSources > 8) {
    ctx.printErr(`web research: --max-sources must be an integer between 1 and 8 (got ${maxSources}).\n`);
    ctx.setExitCode(2);
    return;
  }


  const result = await runResearchSession({
    query,
    engine,
    maxSources,
    chatSessionId: ctx.sessionId,
    callId: ctx.callId,
    eventSender: ctx.eventSender,
    signal: ctx.signal,
  });

  if (!result.success) {
    ctx.printErr(`${result.error}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify({ success: true, query: result.query, sources: result.sources }, null, 2) + '\n');
    return;
  }

  ctx.print(formatSourcesForAgent(result.query, result.sources));
}

function formatSourcesForAgent(query: string, sources: InteractiveSearchSource[]): string {
  const lines = [`Collected ${sources.length} source(s) for query: ${query}`];
  sources.forEach((source, index) => {
    lines.push(
      '',
      `[Source ${index + 1}]`,
      `Title: ${source.title}`,
      `URL: ${source.url}`,
      `Captured At: ${source.capturedAt}`,
      `Extraction Method: ${source.method}`,
      `Chars: ${source.charCount}`,
      '',
      'Content:',
      source.markdown,
      '',
      '---',
    );
  });
  return `${lines.join('\n')}\n`;
}

export const researchCommand: AppCommand = {
  name: 'research',
  synopsis: 'Human-in-the-loop web research: open a window for the user to browse and confirm pages, then return their full text. Fallback for when "web search" is unavailable, blocked, or returns nothing, or when sources must be user-curated.',
  help: HELP,
  run: runResearch,
};
