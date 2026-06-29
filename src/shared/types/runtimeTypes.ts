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
