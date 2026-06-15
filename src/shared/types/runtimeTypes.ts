export type InternalToolType = 'bun' | 'uv';

export interface RuntimeCheckStatus {
  bun: boolean;
  uv: boolean;
  bunPath: string;
  uvPath: string;
}

export interface PythonVersionInfo {
  version: string;
  path: string;
  status: 'installed';
  impl: string;
  semver: string;
}

export interface GitVersionInfo {
  installed: boolean;
  version: string | null;
  path: string | null;
}

export interface SystemRuntimeProbe {
  /** Found on PATH and `--version` exited 0. */
  installed: boolean;
  /** Best-effort parsed version string (e.g. "20.10.0"); null if probe failed or output was unrecognised. */
  version: string | null;
  /** Absolute path resolved via `which` / `where.exe`; null if lookup failed. */
  path: string | null;
}

/**
 * Snapshot of the user's system PATH for runtime-related commands.
 * Surfaced in Settings → Runtime when mode is `system` so the user can see
 * what the app will actually invoke.
 */
export interface SystemRuntimeStatus {
  node: SystemRuntimeProbe;
  npm: SystemRuntimeProbe;
  python: SystemRuntimeProbe;
  pip: SystemRuntimeProbe;
  uv: SystemRuntimeProbe;
}
