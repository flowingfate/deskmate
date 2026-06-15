import { connectRenderToMain } from './base';
import type {
  RuntimeMode,
  RuntimeEnvironment,
} from '../types/appConfig';
import type {
  InternalToolType,
  RuntimeCheckStatus,
  PythonVersionInfo,
  GitVersionInfo,
  SystemRuntimeStatus,
} from '../types/runtimeTypes';

type RenderToMain = {
  setMode: { call: [mode: RuntimeMode]; return: RuntimeEnvironment };
  installComponent: { call: [tool: InternalToolType, version: string]; return: { success: boolean } };
  checkStatus: { call: []; return: RuntimeCheckStatus };
  checkSystemStatus: { call: []; return: SystemRuntimeStatus };
  listPythonVersions: { call: []; return: PythonVersionInfo[] };
  listPythonVersionsFast: { call: []; return: PythonVersionInfo[] };
  installPythonVersion: { call: [version: string]; return: void };
  uninstallPythonVersion: { call: [version: string]; return: void };
  setPinnedPythonVersion: { call: [version: string | null]; return: void };
  cleanUvCache: { call: []; return: void };
  checkGitVersion: { call: []; return: GitVersionInfo };
};

export const renderToMain = connectRenderToMain<RenderToMain>('runtime');
