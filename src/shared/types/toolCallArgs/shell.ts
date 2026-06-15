export interface ShellToolArgs {
  description: string;
  command: string;
  cwd: string;
  args?: string[];
  timeoutSeconds?: number;
  shell?: 'powershell' | 'cmd' | 'bash' | 'sh' | 'zsh';
}


export interface ShellInteractiveAuthHint {
  commandFamily: 'gh-auth-login' | 'gh-auth-refresh' | 'az-login' | 'npm-login' | 'npm-adduser' | 'pnpm-login' | 'yarn-npm-login';
  verificationUri?: string;
  deviceCode?: string;
  timeoutMs: number;
  startedAt: number;
}

export type ShellAuthInterruptionReason = 'cancelled' | 'timed_out';

export interface ShellToolResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  cwd: string;
  shell: string;
  truncated?: boolean;
  interactiveAuth?: ShellInteractiveAuthHint;
  authInterruptedReason?: ShellAuthInterruptionReason;
  success?: boolean;
}
