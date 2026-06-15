/**
 * `shell`:在工作目录执行 shell 命令。
 *
 * 命名史:LLM-visible name 从 `execute_command` 简化到 `shell`(Phase 8a),
 * 文件名 / 内部类型 / 变量名同步对齐到 `shell` / `ShellTool*` / `runShell`
 * (Phase 8b)—— 与 PI 范式 (`bash`) 对齐。
 *
 *
 * 关键设计:
 *   - **危险模式守门**:`DANGEROUS_PATTERNS` 命中即抛 —— 含凭据/cookie 删除、
 *     OAuth logout/revoke endpoint、Edge/Chrome User Data 目录、`rm -rf /`
 *     等。抛错信息显式告诉 LLM"不要 retry,改安全替代",防止 LLM 在 next
 *     turn 又把同样命令包一层换皮重发。
 *   - **流式 partial tool_result**:边收 stdout/stderr 边通过 `ctx.chunkStream`
 *     推 `isPartial: true` chunk。前端拿到 chunk 用与最终 tool_result 一致的
 *     `toolCallId` 进行更新替换。`ctx.chunkStream` null ⇒ 静默不推。
 *   - **后台任务用 shell 原生 job control**:Phase 8a 移除了 `manage_process`
 *     工具,LLM 想跑后台任务直接用 `nohup ... > log 2>&1 &` + `echo $!`
 *     拿 pid,后续轮次再用 `ps -p`/`tail`/`kill` 操作。
 *   - **interactive auth 检测**:`gh auth login` / `az login` 等命令在 stdout
 *     中带 device code → 通过 `humanLoopRequest('device-auth', ...)` 给 UI 推
 *     一张可视卡片(`ctx.eventSender` 提供)。取消由 `ctx.signal` 驱动。
 */
import { request as humanLoopRequest } from '@shared/ipc/human-loop';
import { log } from '@main/log';
import type Resolveable from '@shared/resolveable-promise';
import type {
  ShellAuthInterruptionReason,
  ShellInteractiveAuthHint,
  ShellToolArgs,
  ShellToolResult,
} from '@shared/types/toolCallArgs';
import type { StreamingChunk } from '@shared/types/streamingTypes';
import {
  DeviceAuthInteractionRequest,
  DeviceAuthInteractionResponse,
  getDeviceAuthTitle,
} from '@shared/types/interactiveRequestTypes';
import { buildCommandLine as buildCommandLineShared } from '@main/lib/backgroundProcessManager/commandLineUtils';
import { getTerminalManager } from '@main/lib/terminalManager';
import type { TerminalConfig } from '@main/lib/terminalManager/types';
import { CancellationError } from '@main/lib/utilities/errors';

import { jsonSchema } from './schema';
import type { LocalTool, ToolContext, ToolResult } from './types';

const MAX_OUTPUT_CHARS = 8_000;
const DEFAULT_TIMEOUT_MS = 60_000;
/** 交互式认证命令(gh/az/npm login)默认给 15 分钟。 */
const INTERACTIVE_AUTH_TIMEOUT_MS = 900_000;

/**
 * 危险模式 —— 命中即拒。分四类:
 *   1. 文件系统 / 系统级毁灭(rm -rf / shutdown / mkfs / format)。
 *   2. 凭据/token/cookie 删除(直接破坏其它应用 SSO 状态)。
 *   3. OAuth logout/revoke endpoint(摧毁系统级 SSO)。
 *   4. 直接操作 Edge/Chrome 用户配置目录(损坏浏览器登录)。
 *
 * `dangerousPatternReason` 在 hit 时把对应原因翻译成 LLM 可读的中文/英文
 * 解释,显式提示"don't retry"。
 */
const DANGEROUS_PATTERNS: readonly RegExp[] = [
  /rm\s+-rf\s+\/?/i,
  /shutdown/i,
  /poweroff/i,
  /format\s+/i,
  /mkfs/i,
  /del\s+\/?s\s+\/?q\s+[a-z]:/i,
  /Remove-Item.*(?:credential|token|cookie|auth.*cache)/i,
  /rm\s+.*(?:credential|token|cookie|auth.*cache)/i,
  /del\s+.*(?:credential|token|cookie|auth.*cache)/i,
  /login\.microsoftonline\.com\/.*\/logout/i,
  /login\.live\.com\/.*logout/i,
  /accounts\.google\.com\/Logout/i,
  /\/oauth2?\/(?:logout|revoke|signout)/i,
  /(?:Microsoft\\\\Edge|Google\\\\Chrome)\\\\User Data/i,
  /Application Support\/(?:Microsoft Edge|Google\/Chrome)/i,
];

/**
 * 交互式认证命令 family,用于在 stdout 里抓 device code + verification URL
 * 时给出准确 title;命中也会自动延长 timeout。
 */
const INTERACTIVE_AUTH_COMMAND_PATTERNS: ReadonlyArray<{
  family: ShellInteractiveAuthHint['commandFamily'];
  pattern: RegExp;
}> = [
  { family: 'gh-auth-login',    pattern: /^gh auth login(?:\s|$)/ },
  { family: 'gh-auth-refresh',  pattern: /^gh auth refresh(?:\s|$)/ },
  { family: 'az-login',         pattern: /^az login(?:\s|$)/ },
  { family: 'npm-login',        pattern: /^npm login(?:\s|$)/ },
  { family: 'npm-adduser',      pattern: /^npm adduser(?:\s|$)/ },
  { family: 'pnpm-login',       pattern: /^pnpm login(?:\s|$)/ },
  { family: 'yarn-npm-login',   pattern: /^yarn npm login(?:\s|$)/ },
];

const PARAMETERS = jsonSchema({
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: 'A brief one-sentence description of what this command execution does.',
    },
    command: {
      type: 'string',
      description: 'The command to run. May include arguments when args is not provided.',
    },
    args: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional argument list. Each entry is automatically quoted when required.',
    },
    cwd: {
      type: 'string',
      description: 'Working directory. Must be the workspace root path or a subdirectory within it.',
    },
    timeoutSeconds: {
      type: 'number',
      description:
        'Optional timeout in seconds (default 60, minimum 1, maximum 900).',
    },
    shell: {
      type: 'string',
      enum: ['powershell', 'cmd', 'bash', 'sh', 'zsh'],
      description: 'Preferred shell profile. Defaults to powershell on Windows and zsh on macOS.',
    },
  },
  required: ['description', 'command', 'cwd'],
});

/**
 * 平台条件的 background-task 段。`shell` 是高频工具,description 每次进 LLM
 * 视野的 token 都贵 —— 这里**只**展示当前 OS 的语法,不让 LLM 同时看到 POSIX
 * + PowerShell 两套 + 自己挑。`process.platform` 在模块加载期定型,prompt
 * cache 友好。
 */
function buildBackgroundSection(): string {
  const lines = [
    'Long-running / background tasks:',
    '- This tool ALWAYS blocks until the command exits (or hits its timeout).',
    '  There is no background mode flag — the tool only returns when the process is done.',
    '- For daemons (dev server, watchers, long-running jobs), spawn detached',
    '  via shell job control. Track the pid yourself across turns.',
    '',
  ];
  if (process.platform === 'win32') {
    lines.push(
      '  PowerShell (this machine):',
      '    $p = Start-Process -PassThru my-server -RedirectStandardOutput C:\\Temp\\srv.log -RedirectStandardError C:\\Temp\\srv.err',
      '    $p.Id                                                # prints the pid',
      '    Get-Process -Id <pid> -ErrorAction SilentlyContinue  # alive? (no output = dead)',
      '    Get-Content -Tail 200 C:\\Temp\\srv.log               # last 200 stdout lines',
      '    Stop-Process -Id <pid>                                # graceful stop',
      '    Stop-Process -Id <pid> -Force                         # force kill',
    );
  } else {
    lines.push(
      '  POSIX shell (this machine — bash/zsh):',
      '    nohup my-server > /tmp/srv.log 2>&1 & echo $!     # spawn, prints pid',
      '    ps -p <pid>                                        # alive? (exit 1 = dead)',
      '    tail -n 200 /tmp/srv.log                           # last 200 lines',
      '    kill <pid>                                         # SIGTERM',
      '    kill -9 <pid>                                      # SIGKILL',
    );
  }
  lines.push(
    '',
    '- IMPORTANT: backgrounded processes outlive this tool call AND outlive the',
    '  user turn. If the user cancels the turn, the harness will NOT clean them',
    '  up for you — you must record the pid in your reply and kill it when the',
    '  user is done. Orphaned dev servers are a real bug, not a harness problem.',
  );
  return lines.join('\n') + '\n\n';
}

const DESCRIPTION =
  'Execute a shell command in the selected workspace using the unified terminal manager. Output is truncated to 8000 characters, commands timeout after 60 seconds by default, interactive auth commands like gh auth login get a 15-minute minimum timeout, and high-risk patterns are blocked by safety checks.\n\n' +
  'Interactive auth commands such as gh auth login, gh auth refresh, az login, npm login, npm adduser, pnpm login, and yarn npm login surface verification hints in the message timeline so users can open links, copy device codes, and see the remaining timeout without digging through raw terminal output.\n\n' +
  buildBackgroundSection() +
  'Working Directory Guidelines:\n' +
  '- The cwd parameter specifies where the command runs\n' +
  '- Always use workspace-relative paths (e.g., "./src/config.json")\n' +
  '- Workspace root is the default and recommended working directory\n\n' +
  'Best Practices:\n' +
  '- Prefer relative paths over absolute paths for portability\n' +
  '- Use forward slashes (/) in paths for cross-platform compatibility\n' +
  '- Check command output (stdout/stderr) to verify execution results\n\n' +
  'System Info:\n' +
  `- Platform: ${process.platform}\n` +
  `- Default shell: ${process.platform === 'win32' ? 'powershell' : 'zsh'}\n` +
  '- Uses unified terminal instance manager for improved performance and resource management';

export const shell: LocalTool = {
  spec: {
    name: 'shell',
    description: DESCRIPTION,
    parameters: PARAMETERS,
  },
  async handler(args, ctx): Promise<ToolResult> {
    const typed = args as ShellToolArgs;
    const out = await runShell(typed, ctx);
    return { ok: true, content: JSON.stringify(out) };
  },
};

async function runShell(
  args: ShellToolArgs,
  ctx: ToolContext,
): Promise<ShellToolResult> {
  const executionId = `shell_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const startTime = Date.now();
  log.info({ msg: 'ShellTool execution started', mod: 'ShellTool', executionId, args: { command: args.command, cwd: args.cwd, shell: args.shell } });

  try {
    const validation = validateArgs(args);
    if (!validation.isValid) {
      log.error({ msg: `Arguments validation failed: ${validation.error}`, mod: 'ShellTool', executionId, validationError: validation.error, args });
      throw new Error(`Invalid shell arguments: ${validation.error}`);
    }

    const normalizedCommand = args.command.trim();
    const commandLine = buildCommandLineShared(normalizedCommand, args.args);

    const dangerousPattern = DANGEROUS_PATTERNS.find((pattern) => pattern.test(commandLine));
    if (dangerousPattern) {
      const reason = explainDangerousPattern(dangerousPattern);
      log.warn({ msg: 'Command blocked by safety policy', mod: 'ShellTool', executionId, command: commandLine, matchedPattern: dangerousPattern.toString(), reason });
      throw new Error(
        `Command blocked by safety policy: ${reason}. ` +
          'Do NOT retry this command. Choose a safer alternative that does not affect system-wide authentication state or credentials.',
      );
    }

    const timeoutMs = normalizeTimeout(args.timeoutSeconds, commandLine);

    log.info({ msg: 'Preparing to execute command', mod: 'ShellTool', executionId, commandLine, timeoutMs, cwd: args.cwd, shell: args.shell });
    return await runForeground(args, commandLine, timeoutMs, executionId, startTime, ctx);
  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({
      msg: 'Command execution failed', mod: 'ShellTool', executionId, err: error, executionTime,
      args: { command: args.command, cwd: args.cwd, shell: args.shell, timeoutSeconds: args.timeoutSeconds },
    });
    throw new Error(`command execution failed: ${errorMessage}`);
  }
}

async function runForeground(
  args: ShellToolArgs,
  commandLine: string,
  timeoutMs: number,
  executionId: string,
  startTime: number,
  ctx: ToolContext,
): Promise<ShellToolResult> {
  const terminalManager = getTerminalManager();
  const terminalConfig: TerminalConfig = {
    command: commandLine,
    args: [], // command 已含参数。
    cwd: args.cwd,
    type: 'command',
    shell: args.shell,
    timeoutMs,
    maxOutputLength: MAX_OUTPUT_CHARS,
    persistent: false,
  };

  const instance = await terminalManager.createInstance({
    ...terminalConfig,
    instanceId: `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
  });

  let liveStdout = '';
  let liveStderr = '';
  let liveTruncated = false;
  let cancelledByUser = false;
  let deviceAuthRequestEmitted = false;
  // deviceAuthTask 在 stdout/stderr 监听里赋值;TS 在闭包里无法收窄,
  // 用 mutable 容器避免被推断成 never。
  const deviceAuth: { task: Resolveable<DeviceAuthInteractionResponse> | null } = { task: null };
  const authCommandFamily = findInteractiveAuthFamily(commandLine);
  const maxOutputLength = terminalConfig.maxOutputLength || MAX_OUTPUT_CHARS;

  /**
   * stdout / stderr 增量追加(用 4 处:stdout 监听、stderr 监听、流末残段、
   * partial chunk 触发) —— 抽出共享 helper 保持长度截断逻辑唯一。
   */
  const appendOutput = (current: string, incoming: string): { next: string; truncated: boolean } => {
    if (!incoming) return { next: current, truncated: false };
    if (current.length + incoming.length > maxOutputLength) {
      const remaining = maxOutputLength - current.length;
      return { next: current + incoming.slice(0, Math.max(remaining, 0)), truncated: true };
    }
    return { next: current + incoming, truncated: false };
  };

  // device-auth 取消 watcher:用户在 UI 上按"取消" → terminalManager.stop。
  const watchDeviceAuthCancel = (): void => {
    if (!deviceAuth.task) return;
    deviceAuth.task
      .then((response: DeviceAuthInteractionResponse) => {
        if (response.action === 'cancel' && !cancelledByUser) {
          cancelledByUser = true;
          terminalManager.stopInstance(instance.id, true).catch(() => {});
        }
      })
      .catch(() => {});
  };

  /**
   * 在 stdout / stderr 中识别 device code + verification URL,首次出现时
   * 通过 `humanLoopRequest('device-auth', ...)` 给 UI 推一张 device-auth 卡。
   * 重复出现幂等(只推一次)。`ctx.eventSender` null ⇒ 不推(JobRun 路径)。
   */
  const tryEmitDeviceAuthRequest = (): void => {
    if (deviceAuthRequestEmitted || !authCommandFamily || !ctx.eventSender) return;
    const merged = `${liveStdout}\n${liveStderr}`;
    const deviceCode = extractDeviceCode(merged);
    const verificationUri = merged.match(/https?:\/\/[^\s)]+/i)?.[0];
    if (!deviceCode && !verificationUri) return;

    const id = `device-auth_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const request: DeviceAuthInteractionRequest = {
      chatSessionId: ctx.sessionId,
      title: getDeviceAuthTitle(authCommandFamily),
      commandFamily: authCommandFamily,
      command: commandLine,
      deviceCode,
      verificationUri,
      timeoutMs,
      startedAt: startTime,
    };

    deviceAuth.task = humanLoopRequest('device-auth', request, id).to(ctx.eventSender);
    const onAbort = (): void => {
      deviceAuth.task!.resolve({ action: 'cancel' });
    };
    ctx.signal.addEventListener('abort', onAbort);
    if (ctx.signal.aborted) deviceAuth.task.resolve({ action: 'cancel' });
    deviceAuth.task.finally(() => {
      ctx.signal.removeEventListener('abort', onAbort);
    });
    deviceAuthRequestEmitted = true;
    watchDeviceAuthCancel();

    log.info({ msg: 'Emitted device-auth human-loop request', mod: 'ShellTool', executionId, interactionId: id, commandFamily: authCommandFamily });
  };

  instance.on('stdout', (chunk) => {
    const update = appendOutput(liveStdout, chunk);
    liveStdout = update.next;
    liveTruncated = liveTruncated || update.truncated;
    emitPartial(ctx, executionId, args, commandLine, timeoutMs, liveStdout, liveStderr, liveTruncated, startTime);
    tryEmitDeviceAuthRequest();
  });

  instance.on('stderr', (chunk) => {
    // 末尾补 \n:stderr 多行时 buffer 拼接保留行边界。
    const normalized = chunk.endsWith('\n') ? chunk : `${chunk}\n`;
    const update = appendOutput(liveStderr, normalized);
    liveStderr = update.next;
    liveTruncated = liveTruncated || update.truncated;
    emitPartial(ctx, executionId, args, commandLine, timeoutMs, liveStdout, liveStderr, liveTruncated, startTime);
    tryEmitDeviceAuthRequest();
  });

  // Cancel:turn loop 整体 abort 时自动 kill 子进程,避免命令孤儿挂在后台。
  const cancelOnAbort = (): void => {
    cancelledByUser = true;
    terminalManager.stopInstance(instance.id, true).catch(() => {});
  };
  ctx.signal.addEventListener('abort', cancelOnAbort);

  // 起 instance 之前 signal 就已经 aborted ⇒ 立即拒,不让 spawn / start 浪费一次。
  if (ctx.signal.aborted) {
    ctx.signal.removeEventListener('abort', cancelOnAbort);
    await terminalManager.stopInstance(instance.id, true);
    throw new CancellationError('Command execution cancelled before completion');
  }

  let result;
  try {
    await instance.start();
    result = await instance.execute();
  } finally {
    ctx.signal.removeEventListener('abort', cancelOnAbort);
    await terminalManager.stopInstance(instance.id, true);
  }
  const executionTime = Date.now() - startTime;

  log.info({ msg: 'Command execution completed', mod: 'ShellTool', executionId, exitCode: result.exitCode, timedOut: result.timedOut, dur: result.durationMs, executionTime, stdoutLength: result.stdout.length, stderrLength: result.stderr.length, truncated: result.truncated });

  const finalResult: ShellToolResult = {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    cwd: args.cwd,
    shell: args.shell || 'default',
    truncated: result.truncated,
    interactiveAuth: buildInteractiveAuthHint(commandLine, result.stdout, result.stderr, timeoutMs, startTime),
  };

  const interruptionReason: ShellAuthInterruptionReason | null = cancelledByUser
    ? 'cancelled'
    : finalResult.timedOut
      ? 'timed_out'
      : null;

  const normalizedFinalResult = finalizeInteractiveAuth(finalResult, interruptionReason);

  if (deviceAuth.task?.isPending) {
    deviceAuth.task.resolve({
      action: cancelledByUser ? 'cancel' : finalResult.timedOut ? 'expire' : 'submit',
    });
  }

  if (normalizedFinalResult.stderr && normalizedFinalResult.stderr.trim()) {
    log.warn({ msg: 'Command produced stderr output', mod: 'ShellTool', executionId, stderr: normalizedFinalResult.stderr.substring(0, 500) });
  }

  return normalizedFinalResult;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function emitPartial(
  ctx: ToolContext,
  executionId: string,
  args: ShellToolArgs,
  commandLine: string,
  timeoutMs: number,
  stdout: string,
  stderr: string,
  truncated: boolean,
  startTime: number,
): void {
  if (!ctx.chunkStream) return;

  const partial: ShellToolResult = {
    stdout,
    stderr,
    exitCode: null,
    timedOut: false,
    durationMs: Date.now() - startTime,
    cwd: args.cwd,
    shell: args.shell || 'default',
    truncated: truncated || undefined,
    interactiveAuth: buildInteractiveAuthHint(commandLine, stdout, stderr, timeoutMs, startTime),
  };

  const now = Date.now();
  const chunk: StreamingChunk = {
    chunkId: `tool_result_partial_${now}_${Math.random().toString(36).slice(2, 11)}`,
    messageId: ctx.callId,
    agentId: ctx.agentId,
    chatSessionId: ctx.sessionId,
    timestamp: now,
    type: 'tool_result',
    toolCallId: ctx.callId,
    toolName: 'shell',
    // Partial 阶段当作 'success' 透出 —— 失败要等 final 才能定性。renderer
    // 拿到的就是覆盖式更新:每条 chunk 直接替换 ToolCall.response。
    result: JSON.stringify(partial, null, 2),
    status: 'success',
    time: now,
  };

  ctx.chunkStream.send(chunk);
  log.debug({ msg: 'Emitted partial shell output', mod: 'ShellTool', executionId, toolCallId: ctx.callId, stdoutLength: stdout.length, stderrLength: stderr.length, truncated });
}

function findInteractiveAuthFamily(
  command: string,
): ShellInteractiveAuthHint['commandFamily'] | null {
  const normalized = command.trim().replace(/\s+/g, ' ').toLowerCase();
  return INTERACTIVE_AUTH_COMMAND_PATTERNS.find(({ pattern }) => pattern.test(normalized))?.family ?? null;
}

function buildInteractiveAuthHint(
  command: string,
  stdout: string,
  stderr: string,
  timeoutMs: number,
  startedAt: number,
): ShellInteractiveAuthHint | undefined {
  const family = findInteractiveAuthFamily(command);
  if (!family) return undefined;
  const output = `${stdout}\n${stderr}`;
  return {
    commandFamily: family,
    verificationUri: output.match(/https?:\/\/[^\s)]+/i)?.[0],
    deviceCode: extractDeviceCode(output),
    timeoutMs,
    startedAt,
  };
}

function extractDeviceCode(output: string): string | undefined {
  const labeled = output.match(/(?:device code|user code|one-time code|code)\D{0,20}([A-Z0-9]{4}(?:-[A-Z0-9]{4})+)/i);
  if (labeled?.[1]) return labeled[1].toUpperCase();
  return output.match(/\b([A-Z0-9]{4}(?:-[A-Z0-9]{4})+)\b/)?.[1]?.toUpperCase();
}

function finalizeInteractiveAuth(
  result: ShellToolResult,
  reason: ShellAuthInterruptionReason | null,
): ShellToolResult {
  if (!result.interactiveAuth || reason === null) return result;
  // 用户取消 → exit 130 (POSIX SIGINT 约定);timeout 走原 exitCode。
  return {
    ...result,
    stdout: '',
    stderr:
      reason === 'cancelled'
        ? 'Authentication was canceled by the user. Start the sign-in flow again to continue.'
        : 'Authentication timed out before completion. Start the sign-in flow again to continue.',
    truncated: undefined,
    interactiveAuth: undefined,
    authInterruptedReason: reason,
    success: false,
    exitCode: reason === 'cancelled' ? 130 : result.exitCode,
    timedOut: reason === 'timed_out',
  };
}

function normalizeTimeout(timeoutSeconds: number | undefined, command: string): number {
  const interactive = findInteractiveAuthFamily(command) !== null;
  if (timeoutSeconds === undefined) {
    return interactive ? INTERACTIVE_AUTH_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  }
  if (!Number.isFinite(timeoutSeconds)) {
    throw new Error('timeoutSeconds must be a finite number');
  }
  // 1s ≤ explicit ≤ 900s;interactive 命令保底 15min。
  const clamped = Math.max(1, Math.min(900, Math.floor(timeoutSeconds))) * 1000;
  return interactive ? Math.max(INTERACTIVE_AUTH_TIMEOUT_MS, clamped) : clamped;
}

function explainDangerousPattern(pattern: RegExp): string {
  const src = pattern.source;
  if (/credential|token|cookie|auth.*cache/i.test(src)) {
    return 'this command would delete credential/token/cookie files, which destroys authentication state for the user and other applications';
  }
  if (/login\.microsoftonline|login\.live|accounts\.google|oauth2?.*logout|revoke|signout/i.test(src)) {
    return 'this command accesses an OAuth logout/revoke endpoint, which would destroy system-wide SSO login state across all Microsoft/Google services (Edge, Teams, Windows Widgets, etc.)';
  }
  if (/Edge|Chrome.*User Data|Application Support/i.test(src)) {
    return 'this command directly manipulates the system browser profile directory, which can corrupt or destroy browser login state';
  }
  return 'this command matches a destructive system operation pattern';
}

function validateArgs(args: ShellToolArgs): { isValid: boolean; error?: string } {
  if (!args || typeof args !== 'object') return { isValid: false, error: 'arguments object is required' };
  if (typeof args.description !== 'string' || !args.description.trim()) return { isValid: false, error: 'description must be a non-empty string' };
  if (typeof args.command !== 'string' || !args.command.trim()) return { isValid: false, error: 'command must be a non-empty string' };
  if (typeof args.cwd !== 'string' || !args.cwd.trim()) return { isValid: false, error: 'cwd must be provided and cannot be empty' };

  if (args.args !== undefined) {
    if (!Array.isArray(args.args)) return { isValid: false, error: 'args must be an array of strings when provided' };
    for (const entry of args.args) {
      if (typeof entry !== 'string') return { isValid: false, error: 'each arg entry must be a string' };
    }
  }

  if (args.timeoutSeconds !== undefined) {
    if (!Number.isFinite(args.timeoutSeconds)) return { isValid: false, error: 'timeoutSeconds must be a finite number' };
    if (args.timeoutSeconds <= 0) return { isValid: false, error: 'timeoutSeconds must be greater than zero' };
  }

  if (args.shell !== undefined) {
    const allowed: ReadonlyArray<ShellToolArgs['shell']> = ['powershell', 'cmd', 'bash', 'sh', 'zsh'];
    if (!allowed.includes(args.shell)) {
      return { isValid: false, error: 'shell must be one of powershell, cmd, bash, sh, zsh when provided' };
    }
  }

  return { isValid: true };
}
