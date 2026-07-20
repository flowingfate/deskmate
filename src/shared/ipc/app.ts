import { connectRenderToMain, connectMainToRender } from './base';
import type { AppConfig } from '../types/appConfig';

// ──────────────────────────────────────────────
// Shared types
// ──────────────────────────────────────────────

export interface PlatformInfo {
  platform: string;
  arch: string;
  isWindowsArm: boolean;
}



export interface CrashIncidentExportSummary {
  incidentId: string;
  kind: 'main_fatal' | 'renderer_crash' | 'child_process_crash' | 'resource_eviction' | 'abnormal_termination';
  severity: 'warning' | 'error' | 'fatal';
  summary: string;
  firstEventAt: number;
  artifactCount: number;
  artifactBytes: number;
}

export interface CrashIncidentExportOptions {
  includeMinidumps: boolean;
  confirmedSensitiveMinidumps: boolean;
  confirmedLargeExport: boolean;
}

export type CrashIncidentExportResult =
  | { success: true; filePath: string; fileName: string }
  | { success: false; error: string; requiresLargeExportConfirmation?: boolean };


// ──────────────────────────────────────────────
// Render → Main
// ──────────────────────────────────────────────

type RenderToMain = {
  getVersion: { call: []; return: string };
  getName: { call: []; return: string };
  isDev: { call: []; return: boolean };
  isReady: { call: []; return: { success: boolean; data: boolean } };
  getPlatformInfo: { call: []; return: PlatformInfo };
  getUserDataPath: { call: []; return: string };
  getInstallationDeviceId: { call: []; return: string };
  listCrashIncidentsForExport: { call: []; return: CrashIncidentExportSummary[] };
  exportCrashIncident: {
    call: [incidentId: string, options: CrashIncidentExportOptions];
    return: CrashIncidentExportResult;
  };
  getAppConfig: {
    call: [];
    return: { success: true; data: AppConfig } | { success: false; error: string };
  };
  updateAppConfig: {
    call: [updates: Partial<AppConfig>];
    return: { success: true } | { success: false; error: string };
  };
};

// ──────────────────────────────────────────────
// Main → Renderer
// ──────────────────────────────────────────────

export type MainToRender = {
  ready: boolean;
  configUpdated: { config: AppConfig; timestamp: number };
};

// ──────────────────────────────────────────────
// Export connectors
// ──────────────────────────────────────────────

export const renderToMain = connectRenderToMain<RenderToMain>('app');
export const mainToRender = connectMainToRender<MainToRender>('app');
